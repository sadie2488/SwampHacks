"""Sort the notes of a whole band (from `polyphonic.transcribe`) into parts: melody, bass and chords.

- Clean-up: overtones the model reports as notes of their own (an octave, an octave and a fifth, or two
  octaves over a note that is already sounding, and quieter) go, and so do very short or very faint notes.
- Bass: the lowest voice, at or under B3 (about 250 Hz), one note at a time.
- Melody: the top voice of what is left, one note at a time, without lonely jumps far from its neighbours.
- Chords: the remaining held notes, grouped by the half beat they start on; two or more pitches make a chord.
Melody and bass go through the same beat grid as the pYIN melody (`melody._quantize`); all parts share
one beat 0. A part with too few notes, or too little of the song covered, is left out and named in
`omitted` so the caller can say so. Pure Python on lists of dicts, so it is cheap (well under a second).
"""
from __future__ import annotations

import itertools
import math
from statistics import median

from . import melody

GHOST_INTERVALS = (12, 19, 24)  # overtones 2, 3 and 4 of a note, in semitones
GHOST_MAX_AMP_SHARE = 0.9  # an overtone note is at most this loud compared with the note under it...
GHOST_MIN_OVERLAP = 0.7  # ...and sounds inside it for at least this share of its own length
LOW_GHOST_PITCH = 48  # under C3 an octave starting with the note is its overtone, however loud...
LOW_GHOST_LAG_SEC = 0.3  # ...even when the model hears the low note this much later
MIN_AMP = 0.25  # the model's note strength (0 to 1); fainter notes are mostly bleed and noise
MIN_NOTE_SEC = 0.12
CLUSTER_SEC = 0.06  # notes starting this close together start "at the same time"
HOLD_LEFT_SEC = 0.15  # a voice keeps its note while this much of it is left, unless the new note is beyond it
BASS_MAX_PITCH = 59  # B3, about 247 Hz
MELODY_MIN_PITCH = 55  # G3: lower than this is accompaniment in nearly every song
JUMP_MAX = 12  # a melody note more than an octave from both neighbours is an outlier
CHORD_MIN_SEC = 0.2
CHORD_MAX_NOTES = 4
CHORD_UNIT = 0.5  # chords start on half (counted) beats
EARLY_OK_BEATS = 0.125  # a note this little before the first beat still snaps onto it
MIN_PART_NOTES = 8  # fewer notes than this is not a part
MIN_CHORDS = 4
MIN_COVER_SHARE = 0.15  # a part must sound for at least this share of the song
MAX_NOTES_PER_SEC = 9.0  # busier than this is the model flickering, not a line someone plays

NAMES = {"melody": "Melody", "bass": "Bass", "harmony": "Chords"}


def drop_ghosts(notes: list[dict]) -> list[dict]:
    """Remove overtone notes and notes that are too short or too faint.

    Lowest notes first, and only notes already kept count as the note under an overtone, so the overtone of an
    overtone cannot take a real note with it.
    """
    kept = [n for n in notes if n["end"] - n["start"] >= MIN_NOTE_SEC and n["amp"] >= MIN_AMP]
    by_pitch: dict[int, list[dict]] = {}
    out = []
    for g in sorted(kept, key=lambda n: (n["pitch"], n["start"])):
        if not _is_ghost(g, by_pitch):
            by_pitch.setdefault(g["pitch"], []).append(g)
            out.append(g)
    return sorted(out, key=lambda n: (n["start"], n["pitch"]))


def _is_ghost(g: dict, by_pitch: dict[int, list[dict]]) -> bool:
    length = g["end"] - g["start"]
    for step in GHOST_INTERVALS:
        for f in by_pitch.get(g["pitch"] - step, ()):
            # Under a very low note the model often hears the octave louder, and sooner, than the note itself.
            low_octave = step == 12 and f["pitch"] < LOW_GHOST_PITCH and abs(f["start"] - g["start"]) <= LOW_GHOST_LAG_SEC
            if (f["start"] > g["start"] + CLUSTER_SEC and not low_octave) or f["end"] <= g["start"]:
                continue
            overlap = min(f["end"], g["end"]) - max(f["start"], g["start"])
            if overlap < GHOST_MIN_OVERLAP * length:
                continue
            if low_octave or g["amp"] <= GHOST_MAX_AMP_SHARE * f["amp"] + 0.05:
                return True
    return False


def _clusters(notes: list[dict]) -> list[list[dict]]:
    groups: list[list[dict]] = []
    for n in sorted(notes, key=lambda n: n["start"]):
        if groups and n["start"] - groups[-1][0]["start"] <= CLUSTER_SEC:
            groups[-1].append(n)
        else:
            groups.append([n])
    return groups


def voice(notes: list[dict], *, top: bool) -> list[dict]:
    """One note at a time: the highest (top=True) or lowest note of each onset, as a line.

    A new note cuts the one before short. While the note before still has more than HOLD_LEFT_SEC to go,
    only a note further out (higher for the top voice, lower for the bass) may cut it; others are skipped.
    """
    line: list[dict] = []
    for group in _clusters(notes):
        pick = max(group, key=lambda n: n["pitch"]) if top else min(group, key=lambda n: n["pitch"])
        if line:
            last = line[-1]
            beyond = pick["pitch"] > last["pitch"] if top else pick["pitch"] < last["pitch"]
            if last["end"] - pick["start"] > HOLD_LEFT_SEC and not beyond:
                continue
            last["end"] = min(last["end"], pick["start"])
            if last["end"] - last["start"] < MIN_NOTE_SEC:
                line.pop()
        line.append(dict(pick))
    return line


def drop_jumps(line: list[dict]) -> list[dict]:
    """Remove notes more than an octave away from the notes on both sides (stray chord tones, overtones)."""
    out = []
    for i, n in enumerate(line):
        around = [m["pitch"] for m in line[max(0, i - 3) : i] + line[i + 1 : i + 4]]
        if len(around) >= 2 and abs(n["pitch"] - median(around)) > JUMP_MAX:
            continue
        out.append(n)
    return out


def _too_weak(line: list[dict], analyzed_sec: float, *, min_notes: int = MIN_PART_NOTES) -> str | None:
    """Why this line is not worth showing as a part, or None when it is."""
    if len(line) < min_notes:
        return f"only {len(line)} notes"
    sounding = sum(n["end"] - n["start"] for n in line)
    if analyzed_sec > 0 and sounding < MIN_COVER_SHARE * analyzed_sec:
        return f"covers {sounding:.1f} s of {analyzed_sec:.1f} s"
    span = max(n["end"] for n in line) - min(n["start"] for n in line)
    if span > 0 and len(line) / span > MAX_NOTES_PER_SEC:
        return f"{len(line) / span:.1f} notes a second, too busy"
    return None


def _for_grid(line: list[dict]) -> list[dict]:
    """Notes in the shape `melody._quantize` expects (loudness in dB, the model's strength as confidence)."""
    return [
        {"start": n["start"], "end": n["end"], "pitch": n["pitch"], "conf": n["amp"],
         "db": 20 * math.log10(max(n["amp"], 1e-3))}
        for n in line
    ]  # fmt: skip


def _line_part(line, kind: str, prefix: str, tempo_bpm: float, origin: float, beat_quarters: float) -> dict:
    melody._load_libraries()
    notes = melody._quantize(_for_grid(line), tempo_bpm, [origin], "auto", kind, beat_quarters)
    for i, n in enumerate(notes, start=1):
        n["id"] = f"{prefix}{i}"
    return {"id": kind, "name": NAMES[kind], "kind": kind, "notes": notes}


def chords(notes: list[dict], tempo_bpm: float, origin: float) -> list[list[dict]]:
    """Held notes grouped by the half beat they start on: one list of note dicts per chord, in time order.
    Each note gets `on` and `len` in grid steps; the notes of a chord share both."""
    step = 60.0 / tempo_bpm * CHORD_UNIT
    groups: dict[int, list[dict]] = {}
    for n in notes:
        if n["end"] - n["start"] >= CHORD_MIN_SEC:
            groups.setdefault(round((n["start"] - origin) / step), []).append(n)
    out = []
    for on in sorted(groups):
        loudest: dict[int, dict] = {}
        for n in sorted(groups[on], key=lambda n: -n["amp"]):
            loudest.setdefault(n["pitch"], n)
        picked = sorted(list(loudest.values())[:CHORD_MAX_NOTES], key=lambda n: n["pitch"])
        if len(picked) < 2:
            continue
        end = round((median(n["end"] for n in picked) - origin) / step)
        out.append([{**n, "on": on, "len": max(1, end - on)} for n in picked])
    for chord, nxt in itertools.pairwise(out):
        room = nxt[0]["on"] - chord[0]["on"]
        for n in chord:
            n["len"] = min(n["len"], room)  # a chord ends where the next one starts
    return out


def _chord_part(groups: list[list[dict]], tempo_bpm: float, origin: float, beat_quarters: float) -> dict:
    step_sec = 60.0 / tempo_bpm * CHORD_UNIT
    step_q = CHORD_UNIT * beat_quarters  # one grid step in quarter notes
    notes = []
    for chord in groups:
        for n in chord:
            end = min(n["end"], origin + (n["on"] + n["len"]) * step_sec)
            notes.append({
                "id": f"c{len(notes) + 1}",
                "pitch": int(n["pitch"]),
                "onset_sec": round(max(0.0, n["start"]), 3),
                "duration_sec": round(max(0.001, end - n["start"]), 3),
                "onset_beat": round(n["on"] * step_q, 6),
                "duration_beat": round(n["len"] * step_q, 6),
                "velocity": round(min(1.0, max(0.1, n["amp"])), 2),
                "part": "harmony",
                "confidence": round(min(1.0, max(0.0, n["amp"])), 2),
            })  # fmt: skip
    return {"id": "harmony", "name": NAMES["harmony"], "kind": "harmony", "notes": notes}


def split_parts(
    notes: list[dict], tempo_bpm: float, beats=None, *, beat_quarters: float = 1.0, analyzed_sec: float = 0.0
) -> tuple[dict[str, dict], dict[str, str]]:
    """`({kind: part}, {kind: why it was left out})` for kinds "melody", "bass" and "harmony".

    `notes` come from `polyphonic.transcribe`; `tempo_bpm` and `beats` from the tempo step (felt beats, see
    `melody.quarters_per_beat`). Parts follow the song-analysis contract (quarter-note beats).
    """
    if not tempo_bpm or tempo_bpm <= 0:
        raise ValueError("tempo_bpm must be a positive number")
    clean = drop_ghosts(notes)
    for i, n in enumerate(clean):
        n["_i"] = i
    bass = voice([n for n in clean if n["pitch"] <= BASS_MAX_PITCH], top=False)
    used = {n["_i"] for n in bass}
    tune = drop_jumps(voice([n for n in clean if n["_i"] not in used and n["pitch"] >= MELODY_MIN_PITCH], top=True))
    used |= {n["_i"] for n in tune}
    rest = [n for n in clean if n["_i"] not in used]
    origin = _origin(bass + tune + rest, tempo_bpm, beats)
    held = chords(rest, tempo_bpm, origin)
    found: dict[str, dict] = {}
    omitted: dict[str, str] = {}
    for kind, prefix, line in (("melody", "m", tune), ("bass", "b", bass)):
        why = _too_weak(line, analyzed_sec)
        if why is None:
            try:
                found[kind] = _line_part(line, kind, prefix, tempo_bpm, origin, beat_quarters)
            except melody.AnalysisError:
                why = "nothing left on the beat grid"
        if why:
            omitted[kind] = why
    flat = [n for c in held for n in c]
    why = _too_weak(flat, analyzed_sec, min_notes=2 * MIN_CHORDS) if len(held) >= MIN_CHORDS else f"only {len(held)} chords"
    if why:
        omitted["harmony"] = why
    else:
        found["harmony"] = _chord_part(held, tempo_bpm, origin, beat_quarters)
    return found, omitted


def _origin(notes: list[dict], tempo_bpm: float, beats) -> float:
    """Beat 0 in seconds: the first beat, moved back by whole beats when notes start before it."""
    spb = 60.0 / tempo_bpm
    first = min((n["start"] for n in notes), default=0.0)
    origin = float(beats[0]) if beats is not None and len(beats) > 0 else first
    if first < origin - EARLY_OK_BEATS * spb:
        origin -= math.ceil((origin - first) / spb - 1e-9) * spb
    return origin


def align_parts(parts: list[dict], tempo_bpm: float, beat_quarters: float = 1.0) -> list[dict]:
    """Shift whole parts by whole beats so that beat 0 is the same moment in all of them (in place).

    Each quantizer moves its own beat 0 back when a note starts before the first beat; this undoes the
    difference. A part's beat 0 is read back from its notes (seconds minus beats), which is exact to well
    under a beat.
    """
    spb = 60.0 / tempo_bpm
    zeros = {}
    for part in parts:
        if part["notes"]:
            zeros[id(part)] = median(n["onset_sec"] - n["onset_beat"] / beat_quarters * spb for n in part["notes"])
    if len(zeros) < 2:
        return parts
    earliest = min(zeros.values())
    for part in parts:
        k = round((zeros.get(id(part), earliest) - earliest) / spb)
        if k > 0:
            for n in part["notes"]:
                n["onset_beat"] = round(n["onset_beat"] + k * beat_quarters, 6)
    return parts
