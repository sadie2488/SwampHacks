"""Melody to notes: turn a monophonic recording into note events for sheet music.

One instrument or voice playing one note at a time, ideally already isolated. The pipeline:
pitch track (pYIN) -> clean-up (octave glitches, smoothing) -> cut into notes (silence, loudness
dips, pitch steps) -> tuning offset -> integer concert-pitch MIDI -> beat grid.

The heavy libraries (numpy, scipy, librosa) are an optional install (`uv sync --group analysis`) and
load on the first `extract_melody` call. Importing this module is cheap and works without them, so
`melody_to_part` and `transposition_hint` always work; `extract_melody` says so in plain words when
the libraries are missing.
"""
from __future__ import annotations

import itertools
import math
from collections.abc import Sequence

librosa = np = ndimage = signal = None  # the heavy libraries are loaded on first use

SR = 22050  # analysis sample rate
HOP = 256  # samples between pitch frames (about 11.6 ms)
FRAME = 2048  # pYIN window (about 93 ms)
RMS_FRAME = 512  # loudness window (about 23 ms): short enough to see a re-attack
FMIN_HZ = 65.406  # C2
FMAX_HZ = 2093.005  # C7
MAX_SECONDS = 360.0

MIN_NOTE_SEC = 0.09  # a note needs about 100 ms of stable pitch
SPLIT_MIN_FRAMES = 7  # shortest stretch the pitch-step search may create
SPLIT_PENALTY = 3.0  # cost of starting a new note (semitone^2 x frames); high enough to ignore vibrato
DIP_DB = 5.0  # a loudness dip this deep that comes back is a new attack...
DIP_MAX_FRAMES = 6  # ...if it is narrow (a slow tremolo is not)
EDGE_DB = 20.0  # note edges sit where loudness is within this many dB of the note's peak
FLOOR_DB = 40.0  # frames this far under the loudest voiced frames are silence
SCOOP_FRAMES = 10  # a note's first or last stretch this short, near its neighbour, is a scoop or droop
GLIDE_FRAMES = 24  # a stretch shorter than this that is just the pitch sliding belongs to its neighbours
TUNING_SIGMA_SEC = 4.0  # how slowly the tuning offset may move
MIN_CONFIDENCE = 0.1  # pYIN voicing probability: noise sits near 0.01, real melodies well above

_GRIDS = {"auto", "sixteenth", "triplet"}
_STRAIGHT_UNIT = 0.25  # beats
_TRIPLET_UNIT = 1.0 / 3.0

# Concert-pitch MIDI ranges from docs/music-notes.md section 5. "easy" is the beginner range.
_INSTRUMENT_RANGES = {
    "clarinet": {"easy": (50, 82), "full": (50, 94)},  # written E3..C6 / E3..C7, sounding 2 semitones lower
    "trombone": {"easy": (40, 65), "full": (40, 77)},  # E2..F4 / E2..F5
    "guitar": {"easy": None, "full": (40, 83)},  # open low E up to B5, sounding
}


class AnalysisError(Exception):
    """The recording could not be turned into notes. The message is plain words for the user."""


def _load_libraries() -> None:
    global librosa, np, ndimage, signal
    if np is not None:
        return
    try:
        import librosa as _librosa
        import numpy as _numpy
        from scipy import ndimage as _ndimage
        from scipy import signal as _signal
    except ImportError as err:
        raise AnalysisError("The music analysis tools are not installed on this server.") from err
    librosa, np, ndimage, signal = _librosa, _numpy, _ndimage, _signal


# ---------------------------------------------------------------------------------------------
# Public API


def extract_melody(
    y,
    sr: int,
    tempo_bpm: float,
    beats: Sequence[float] | None = None,
    *,
    grid: str = "auto",
    part_id: str = "melody",
    max_seconds: float = MAX_SECONDS,
) -> list[dict]:
    """Note events (contract `note-event` Note) for the single melody line in `y`.

    `y` is mono audio (or channels x samples). Pitches are integer concert-pitch MIDI. `onset_sec` and
    `duration_sec` are the measured times; `onset_beat` and `duration_beat` are snapped to the grid.
    The beat origin is `beats[0]` when `beats` is given, otherwise the first note. Notes before the
    origin move the origin back by whole beats, so beats are never negative. Only the first
    `max_seconds` of audio are used. Raises `AnalysisError` when no pitched melody is found.
    """
    if grid not in _GRIDS:
        raise ValueError(f"grid must be one of {sorted(_GRIDS)}")
    if not tempo_bpm or tempo_bpm <= 0:
        raise ValueError("tempo_bpm must be a positive number")
    _load_libraries()

    audio = _prepare(y, sr, max_seconds)
    midi, prob, env = _track(audio)
    segments = _segments(midi, prob, env)
    if not segments:
        raise _no_melody()
    notes = _absorb_short(_join(_fix_octaves(_to_notes(segments))))
    if not notes:
        raise _no_melody()
    return _quantize(notes, tempo_bpm, beats, grid, part_id)


def melody_to_part(
    notes: Sequence[dict],
    *,
    part_id: str = "melody",
    name: str = "Melody",
    instrument: str | None = None,
) -> dict:
    """A `parts[]` entry for the song-analysis document. The notes are copied and tagged with `part_id`."""
    out_notes = []
    for i, note in enumerate(notes, start=1):
        item = dict(note)
        item["part"] = part_id
        item.setdefault("id", f"m{i}")
        out_notes.append(item)
    part = {"id": part_id, "name": name, "kind": "melody", "notes": out_notes}
    suggestion = instrument or transposition_hint(out_notes)
    if suggestion:
        part["instrument"] = suggestion
    return part


def transposition_hint(notes: Sequence[dict]) -> str | None:
    """An instrument ('clarinet', 'trombone', 'guitar') whose range holds every note, else None.

    Beginner ranges win over full ranges; among those that fit, the one whose range is centred closest
    to the typical note wins. Informational only.
    """
    pitches = [n["pitch"] for n in notes if "pitch" in n]
    if not pitches:
        return None
    low, high = min(pitches), max(pitches)
    typical = sorted(pitches)[len(pitches) // 2]
    for level in ("easy", "full"):
        fits = []
        for name, ranges in _INSTRUMENT_RANGES.items():
            span = ranges[level]
            if span and span[0] <= low and high <= span[1]:
                fits.append((abs(typical - (span[0] + span[1]) / 2), name))
        if fits:
            return min(fits)[1]
    return None


# ---------------------------------------------------------------------------------------------
# Audio and pitch frames


def _no_melody() -> AnalysisError:
    return AnalysisError(
        "I could not find a clear melody in this recording. Try a recording where one instrument "
        "or voice plays one note at a time."
    )


def _prepare(y, sr: int, max_seconds: float):
    audio = np.nan_to_num(np.asarray(y, dtype=np.float32))
    if audio.ndim > 1:
        if audio.shape[0] > audio.shape[1]:
            audio = audio.T
        audio = audio.mean(axis=0)
    audio = audio[: int(max_seconds * sr)]
    if audio.size < sr // 4:
        raise AnalysisError("The recording is too short to find a melody.")
    peak = float(np.max(np.abs(audio)))
    if peak < 1e-4:
        raise AnalysisError("The recording is silent, so there is no melody to find.")
    if sr != SR:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=SR)
    return audio / peak * 0.9


def _track(audio):
    """Per frame: pitch in float MIDI (NaN where unvoiced), voicing probability, loudness in dB."""
    f0, voiced, prob = librosa.pyin(
        audio, fmin=FMIN_HZ, fmax=FMAX_HZ, sr=SR, frame_length=FRAME, hop_length=HOP
    )
    rms = librosa.feature.rms(y=audio, frame_length=RMS_FRAME, hop_length=HOP)[0]
    n = min(len(f0), len(rms))
    midi = np.full(n, np.nan)
    ok = voiced[:n] & np.isfinite(f0[:n])
    midi[ok] = librosa.hz_to_midi(f0[:n][ok])
    return midi, np.nan_to_num(prob[:n]), 20.0 * np.log10(rms[:n] + 1e-6)


def _runs(mask) -> list[tuple[int, int]]:
    """(start, end) index pairs of the True stretches in `mask`; end is exclusive."""
    padded = np.concatenate(([0], mask.astype(np.int8), [0]))
    step = np.diff(padded)
    return [(int(a), int(b)) for a, b in zip(np.flatnonzero(step == 1), np.flatnonzero(step == -1))]


def _clean_pitch(midi):
    """Bridge one-off dropouts, undo short octave jumps, and median-filter each voiced stretch."""
    out = midi.copy()
    known = np.flatnonzero(np.isfinite(out))
    for k in np.flatnonzero((np.diff(known) > 1) & (np.diff(known) <= 4)):
        a, b = known[k], known[k + 1]
        if abs(out[a] - out[b]) <= 1.0:
            out[a + 1 : b] = np.linspace(out[a], out[b], b - a + 1)[1:-1]
    for a, b in _runs(np.isfinite(out)):
        part = out[a:b]
        if len(part) < 5:
            continue
        size = min(25, len(part) // 2 * 2 + 1)
        dev = part - ndimage.median_filter(part, size=size, mode="nearest")
        octaves = np.round(dev / 12.0)
        glitch = (octaves != 0) & (np.abs(dev - 12.0 * octaves) < 2.0)
        part = ndimage.median_filter(part - 12.0 * octaves * glitch, size=5, mode="nearest")
        out[a:b] = part
    return out


# ---------------------------------------------------------------------------------------------
# Cutting the pitch track into notes


def _split_at_dips(env, a: int, b: int) -> list[tuple[int, int]]:
    """Cut [a, b) where the loudness dips and comes back: the same note struck again."""
    if b - a < 2 * SPLIT_MIN_FRAMES:
        return [(a, b)]
    level = env[a:b]
    dips, _ = signal.find_peaks(-level, prominence=DIP_DB, width=(None, DIP_MAX_FRAMES), wlen=41)
    pieces = []
    start = 0
    for p in dips:
        lo, hi = p, p
        while lo > start and p - lo < 4 and level[lo - 1] <= level[p] + 3:
            lo -= 1
        while hi < len(level) - 1 and hi - p < 4 and level[hi + 1] <= level[p] + 3:
            hi += 1
        pieces.append((a + start, a + lo))
        start = max(start, hi + 1)
    pieces.append((a + start, b))
    return [(s, e) for s, e in pieces if e > s]


def _split_at_steps(x) -> list[tuple[int, int]]:
    """Cut a stretch of pitch values into flat pieces: least squares with a cost per extra piece."""
    n = len(x)
    if n < 2 * SPLIT_MIN_FRAMES:
        return [(0, n)]
    x = x - x.mean()
    s1 = np.concatenate(([0.0], np.cumsum(x)))
    s2 = np.concatenate(([0.0], np.cumsum(x * x)))
    best = np.full(n + 1, np.inf)
    best[0] = -SPLIT_PENALTY
    back = np.zeros(n + 1, dtype=int)
    for j in range(SPLIT_MIN_FRAMES, n + 1):
        start = np.arange(max(0, j - 400), j - SPLIT_MIN_FRAMES + 1)
        cost = (s2[j] - s2[start]) - (s1[j] - s1[start]) ** 2 / (j - start)
        total = best[start] + cost + SPLIT_PENALTY
        k = int(np.argmin(total))
        best[j], back[j] = total[k], start[k]
    cuts = [n]
    while cuts[-1] > 0:
        cuts.append(int(back[cuts[-1]]))
    cuts.reverse()
    return list(itertools.pairwise(cuts))


def _is_sliding(x) -> bool:
    """Is the pitch in this short stretch moving (a slide), rather than sitting still with some vibrato?"""
    n = len(x)
    if n < 5:
        return True
    third = max(n * 2 // 5, 1)
    if abs(np.median(x[n - third :]) - np.median(x[:third])) >= 1.5:
        return True
    core = x[n // 5 : n - n // 5]
    slope = abs(np.polyfit(np.arange(len(core)), core, 1)[0])
    return slope >= 0.15 and slope * (len(core) - 1) >= 0.7


def _drop_slides(x, steps: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Give a short stretch that is just the pitch sliding (a scoop, a droop, a glide) to its neighbours."""
    steps = list(steps)
    changed = True
    while changed and len(steps) > 1:
        changed = False
        for i, (s, e) in enumerate(steps):
            n = e - s
            if n >= GLIDE_FRAMES:
                continue
            edge = i in (0, len(steps) - 1)
            beside = steps[1] if i == 0 else steps[i - 1]
            close = abs(np.median(x[s:e]) - np.median(x[beside[0] : beside[1]])) <= 2.5
            scoop = edge and n <= SCOOP_FRAMES and close
            if not (scoop or _is_sliding(x[s:e])):
                continue
            if i == 0:
                steps[1] = (s, steps[1][1])
            elif i == len(steps) - 1:
                steps[i - 1] = (steps[i - 1][0], e)
            else:
                middle = (s + e) // 2
                steps[i - 1] = (steps[i - 1][0], middle)
                steps[i + 1] = (middle, steps[i + 1][1])
            del steps[i]
            changed = True
            break
    return steps


def _place_cuts(x, steps: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Move each big pitch step to where the pitch first leaves the old note, not the middle of a slide."""
    if len(steps) < 2:
        return steps
    cuts = [e for _, e in steps[:-1]]
    levels = [float(np.median(x[s:e])) for s, e in steps]
    for i, c in enumerate(cuts):
        jump = levels[i + 1] - levels[i]
        if abs(jump) < 2.0:  # small steps hide in vibrato
            continue
        low = (cuts[i - 1] if i else 0) + 3
        high = (cuts[i + 1] if i + 1 < len(cuts) else len(x)) - 3
        progress = (x - levels[i]) / jump
        while c > low and progress[c - 1] >= 0.25:
            c -= 1
        while c < high and progress[c] < 0.25:
            c += 1
        cuts[i] = c
    edges = [0, *cuts, len(x)]
    return list(itertools.pairwise(edges))


def _segments(midi, prob, env) -> list[dict]:
    """Cut the frames into pieces of steady pitch: dicts with frame range, float pitch, confidence, dB."""
    pitch = _clean_pitch(midi)
    finite = np.isfinite(pitch)
    if not finite.any():
        return []
    loud = float(np.percentile(env[finite], 95))
    active = finite & (env >= loud - FLOOR_DB)

    pieces = []
    for a, b in _runs(active):
        pieces.extend(_split_at_dips(env, a, b))

    out = []
    for k, (a, b) in enumerate(pieces):
        floor = out[-1]["end"] if out else 0
        ceiling = pieces[k + 1][0] if k + 1 < len(pieces) else len(env)
        gate = float(np.percentile(env[a:b], 90)) - EDGE_DB
        while a < b and env[a] < gate:
            a += 1
        while b > a and env[b - 1] < gate:
            b -= 1
        if b <= a:
            continue
        first, last = a, b  # frames that carry usable pitch
        for _ in range(8):
            if a > floor and env[a - 1] >= gate:
                a -= 1
        for _ in range(8):
            if b < ceiling and env[b] >= gate:
                b += 1
        steps = _split_at_steps(pitch[first:last])
        steps = _place_cuts(pitch[first:last], _drop_slides(pitch[first:last], steps))
        for i, (s, e) in enumerate(steps):
            s, e = first + s, first + e
            seg = _describe(pitch, prob, env, s, e, a if i == 0 else s, b if i == len(steps) - 1 else e)
            seg["piece"] = k  # pieces are separated by silence or a loudness dip
            out.append(seg)
    return out


def _describe(pitch, prob, env, s: int, e: int, start: int, end: int) -> dict:
    margin = int(0.2 * (e - s)) if e - s >= 10 else 0
    core = slice(s + margin, e - margin)
    return {
        "start": start,
        "end": end,
        "pitch": float(np.median(pitch[core])),
        "conf": float(np.mean(prob[s:e])),
        "db": float(np.median(env[s:e])),
    }


# ---------------------------------------------------------------------------------------------
# Pitch to integer notes


def _tuning_offsets(centers, pitches, weights):
    """A slowly moving tuning offset in semitones for each note, from how far notes sit off the semitone."""
    step = 0.25  # seconds per bin
    bins = (np.asarray(centers) / step).astype(int)
    vec = weights * np.exp(2j * np.pi * np.asarray(pitches))
    total = np.zeros(bins.max() + 1, dtype=complex)
    mass = np.zeros(total.shape)
    np.add.at(total, bins, vec)
    np.add.at(mass, bins, weights)
    sigma = TUNING_SIGMA_SEC / step
    smooth = ndimage.gaussian_filter1d(total.real, sigma) + 1j * ndimage.gaussian_filter1d(total.imag, sigma)
    weight = ndimage.gaussian_filter1d(mass, sigma)
    at = smooth[bins]
    strength = np.abs(at) / np.maximum(weight[bins], 1e-12)
    angle = np.where(strength >= 0.2, np.angle(at), np.nan)  # too scattered to tell: no estimate here
    known = np.isfinite(angle)
    if not known.any():
        return np.zeros(len(angle))
    order = np.arange(len(angle))
    # unwrap along time so the offset never flips by a whole semitone in the middle of a piece
    return np.interp(order, order[known], np.unwrap(angle[known])) / (2 * np.pi)


def _to_notes(segs: list[dict]) -> list[dict]:
    """Round to integer MIDI after removing the tuning offset; join pieces the pitch search cut apart."""
    frame_sec = HOP / SR
    centers = np.array([(s["start"] + s["end"]) / 2 * frame_sec for s in segs])
    pitches = np.array([s["pitch"] for s in segs])
    weights = np.array([max(s["end"] - s["start"], 1) * max(s["conf"], 0.05) for s in segs], dtype=float)
    rounded = np.round(pitches - _tuning_offsets(centers, pitches, weights)).astype(int)
    return _join(
        [
            {
                "start": (seg["start"] - 0.5) * frame_sec,
                "end": (seg["end"] - 0.5) * frame_sec,
                "pitch": int(pitch),
                "conf": seg["conf"],
                "db": seg["db"],
                "frames": seg["end"] - seg["start"],
                "piece": seg["piece"],
            }
            for seg, pitch in zip(segs, rounded)
        ]
    )


def _join(notes: list[dict]) -> list[dict]:
    """Merge neighbours with the same pitch that were only cut apart by the pitch search (no new attack)."""
    out: list[dict] = []
    for note in notes:
        last = out[-1] if out else None
        if last and last["piece"] == note["piece"] and last["pitch"] == note["pitch"]:
            total = last["frames"] + note["frames"]
            last["end"] = note["end"]
            last["conf"] = (last["conf"] * last["frames"] + note["conf"] * note["frames"]) / total
            last["db"] = (last["db"] * last["frames"] + note["db"] * note["frames"]) / total
            last["frames"] = total
        else:
            out.append(dict(note))
    return out


def _absorb_short(notes: list[dict]) -> list[dict]:
    """Drop notes that are too short or too unsure. If one sat inside a sound that goes on (a scoop
    into a note, a droop at the end), its time goes to the note beside it instead of leaving a hole."""
    weak = [n["end"] - n["start"] < MIN_NOTE_SEC or n["conf"] < MIN_CONFIDENCE for n in notes]
    i = 0
    while i < len(notes):
        if not weak[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(notes) and weak[j + 1]:
            j += 1
        pieces = {n["piece"] for n in notes[i : j + 1] if "piece" in n}
        left = notes[i - 1] if i > 0 and notes[i - 1].get("piece") in pieces else None
        right = notes[j + 1] if j + 1 < len(notes) and notes[j + 1].get("piece") in pieces else None
        start, end = notes[i]["start"], notes[j]["end"]
        if left and right:
            left["end"] = right["start"] = (start + end) / 2
        elif left:
            left["end"] = end
        elif right:
            right["start"] = start
        i = j + 1
    return [n for n, gone in zip(notes, weak) if not gone]


def _fix_octaves(notes: list[dict]) -> list[dict]:
    """Undo pitch-tracker slips of whole octaves, using the notes next to them.

    A note or pair of notes an octave away from both neighbours (which agree with each other) moves
    back. A short note glued to a longer one an octave away (no new attack between) joins its octave.
    """
    i = 1
    while i < len(notes) - 1:
        for size in (1, 2):
            if i + size >= len(notes):
                break
            before, after = notes[i - 1], notes[i + size]
            group = notes[i : i + size]
            near = (
                group[0]["start"] - before["end"] <= 1.0
                and after["start"] - group[-1]["end"] <= 1.0
                and abs(before["pitch"] - after["pitch"]) <= 5
            )
            if not near:
                continue
            ref = (before["pitch"] + after["pitch"]) / 2
            shifts = {round((n["pitch"] - ref) / 12) for n in group}
            if len(shifts) == 1 and shifts != {0}:
                k = shifts.pop()
                if all(abs(n["pitch"] - ref - 12 * k) <= 4 for n in group):
                    for n in group:
                        n["pitch"] -= 12 * k
                    i += size - 1
                    break
        i += 1
    for a, b in itertools.pairwise(notes):
        glued = a.get("piece") is not None and a.get("piece") == b.get("piece")
        octaves = (a["pitch"] - b["pitch"]) / 12
        if glued and octaves == round(octaves) and octaves != 0:
            short, long_ = sorted((a, b), key=lambda n: n["end"] - n["start"])
            length = short["end"] - short["start"]
            if length < 0.35 and length < 0.6 * (long_["end"] - long_["start"]):
                short["pitch"] = long_["pitch"]
    return notes


# ---------------------------------------------------------------------------------------------
# Beat grid


def _snap_error(beats_at, unit: float) -> float:
    return float(np.sum(np.abs(beats_at - np.round(beats_at / unit) * unit)))


def _quantize(notes, tempo_bpm: float, beats, grid: str, part_id: str) -> list[dict]:
    seconds_per_beat = 60.0 / float(tempo_bpm)
    origin = float(beats[0]) if beats is not None and len(beats) > 0 else notes[0]["start"]
    onset_beats = np.array([(n["start"] - origin) / seconds_per_beat for n in notes])
    end_beats = np.array([(n["end"] - origin) / seconds_per_beat for n in notes])

    if grid == "triplet":
        unit = _TRIPLET_UNIT
    elif grid == "sixteenth" or len(notes) < 3:
        unit = _STRAIGHT_UNIT
    else:
        straight = _snap_error(onset_beats, _STRAIGHT_UNIT)
        triplet = _snap_error(onset_beats, _TRIPLET_UNIT)
        unit = _TRIPLET_UNIT if triplet < 0.85 * straight else _STRAIGHT_UNIT

    first = np.round(onset_beats / unit)
    last = np.round(end_beats / unit)
    rows = []
    for n, a, b, raw_len in zip(notes, first, last, end_beats - onset_beats):
        length = b - a
        if length < 1:
            if raw_len < 0.6 * unit:
                continue  # shorter than a sixteenth: drop
            length = 1
        rows.append({"note": n, "on": int(a), "len": int(length)})
    rows.sort(key=lambda r: r["on"])

    kept = []
    for row in rows:
        if kept and row["on"] == kept[-1]["on"]:  # two notes landed on the same grid point: keep the longer
            if row["len"] > kept[-1]["len"]:
                kept[-1] = row
            continue
        kept.append(row)
    for row, nxt in itertools.pairwise(kept):
        room = nxt["on"] - row["on"]
        if row["len"] > room:
            row["len"] = room  # never overlap
        elif room - row["len"] == 1:
            row["len"] = room  # a one-step gap is rest clutter: hold the note through it
    if not kept:
        raise _no_melody()

    shift = max(0, -min(r["on"] for r in kept))
    shift = math.ceil(shift * unit - 1e-9) / unit  # move the origin back by whole beats
    ref_loud = float(np.percentile([r["note"]["db"] for r in kept], 95))

    starts_ms = [max(0, round(float(r["note"]["start"]) * 1000)) for r in kept]
    result = []
    for i, row in enumerate(kept):
        n = row["note"]
        end_ms = math.floor(float(n["end"]) * 1000)
        if i + 1 < len(kept):
            end_ms = min(end_ms, starts_ms[i + 1])  # never overlap the next note
        first_beat = round((row["on"] + shift) * unit, 6)
        last_beat = round((row["on"] + shift + row["len"]) * unit, 6)  # ends exactly where the next starts
        result.append(
            {
                "id": f"m{i + 1}",
                "pitch": int(n["pitch"]),
                "onset_sec": starts_ms[i] / 1000,
                "duration_sec": max(end_ms - starts_ms[i], 1) / 1000,
                "onset_beat": first_beat,
                "duration_beat": round(last_beat - first_beat, 6),
                "velocity": round(min(1.0, max(0.1, 1.0 + (n["db"] - ref_loud) / 30.0)), 2),
                "part": part_id,
                "confidence": round(min(1.0, max(0.0, n["conf"])), 2),
            }
        )
    return result
