"""Tempo, beats, time signature and key of a recording.

`analyze_tempo_key(y, sr)` returns the part of a `song-analysis` document that this step can know:
duration_sec, tempo_bpm, tempo_confidence, beats, downbeats, key and time_signature. The caller adds
`version`, `song_id`, `source`, `parts` and the rest.

Needs the heavy audio group (`uv sync --group analysis`). Without it the module still imports, and
every function raises `AnalysisError` with a plain message.

How it works:
- Beats: librosa beat tracking on a log-spectral-flux envelope. The tracker's beats are then snapped to
  the sharpest attack within 55 ms using a finer envelope, so they land on the real note starts.
- Tempo octave: the result is nudged into 70-160 BPM when the beat grid supports it (see `_fix_octave`).
- Time signature: 3/4 versus 4/4 from the accent pattern of the beats; 6/8 only with a clear
  three-way split of every beat; otherwise 4/4. For 6/8 the beats are the two dotted-quarter pulses of
  each bar and `tempo_bpm` counts those pulses (not eighth notes). Note `onset_beat`s are still quarter
  notes (the melody step converts: one 6/8 pulse is 1.5 quarters).
- Key: Krumhansl-Schmuckler matching (Temperley profiles) on a pitch-class histogram of the harmonic part of the sound.
"""

from __future__ import annotations

import contextlib
import warnings
from pathlib import Path

try:
    import librosa
    import numpy as np
except ImportError:  # the heavy audio group is not installed
    librosa = None  # type: ignore[assignment]
    np = None  # type: ignore[assignment]

__all__ = ["AnalysisError", "analyze_file", "analyze_tempo_key", "load_audio"]

SAMPLE_RATE = 22050
MAX_SECONDS = 360  # analyze at most the first six minutes
MIN_SECONDS = 2.0
HOP = 512  # coarse envelope: 23 ms per frame, used for tracking and accents
FINE_N_FFT = 512  # fine envelope: 5.8 ms per frame, used to place each beat on its attack
FINE_HOP = 128
REFINE_WINDOW_SEC = 0.055
REFINE_BIAS_SEC = 0.006  # the fine envelope peaks about 6 ms before a sharp attack
EDGE_BEAT_MIN_STRENGTH = 0.2  # first/last beats weaker than this share of the median attack are dropped

TEMPO_LOW = 70.0
TEMPO_HIGH = 160.0
VERY_SLOW = 45.0
SLOW_PULSE_RATIO = 0.5  # in-between beats at least this share of a slow beat's strength: double the tempo
HALVE_RATIO = 0.45  # every other beat weaker than this share of its neighbours: halve the tempo
FAST_BPM = 140.0  # above this the slower pulse is the likelier one, so it needs less proof:
FAST_HALVE_RATIO = 0.6  # every other beat under 60 percent (Hotel California's eighth notes measure 0.47)
EVEN_STRONG_RATIO = 0.75  # ...but only when the remaining beats are this even with each other
MIN_BEATS = 4

# Temperley (Kostka-Payne) key profiles, starting at the tonic. They replaced the Krumhansl-Kessler ones, which
# named the key a fifth too high (the dominant) on 3 of 4 real band recordings; these got all 4 right.
MAJOR_PROFILE = (0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400)
MINOR_PROFILE = (0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330)

# Tonic spelling by semitone above C. Sharp keys use sharps, flat keys use flats; the two six-accidental
# keys (F#/Gb, D#/Eb) both use the sharp spelling so relative keys match (F# major with D# minor).
MAJOR_NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
MINOR_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "Bb", "B")


class AnalysisError(Exception):
    """The recording cannot be analyzed. The message is plain words that can be shown to the user."""


def _require_libs() -> None:
    if librosa is None or np is None:
        raise AnalysisError("Audio analysis is not installed on this server.")


def load_audio(path, sr: int = SAMPLE_RATE):
    """Read an audio file as mono at `sr` (first six minutes only). Returns `(samples, sr)`."""
    _require_libs()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            y, sr_out = librosa.load(str(path), sr=sr, mono=True, duration=MAX_SECONDS)
    except Exception as exc:
        raise AnalysisError("I couldn't read that audio file. Try a WAV, MP3, FLAC or OGG file.") from exc
    if y.size == 0:
        raise AnalysisError("That audio file has no sound in it.")
    return y, sr_out


# --- helpers -----------------------------------------------------------------------------------


def _flux(y, sr, n_fft, hop, n_mels):
    """Spectral flux in dB (how fast the sound is getting louder) per frame, plus a linear one.

    The log version is robust for tracking; the linear one follows loudness, so it is the better
    judge of which beats are accented. Frame `i` is centred on sample `i * hop`.
    """
    mel = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=n_fft, hop_length=hop, n_mels=n_mels)
    db = librosa.power_to_db(mel, ref=np.max)
    log_flux = np.maximum(0.0, np.diff(db, axis=1, prepend=db[:, :1])).mean(axis=0)
    amp = np.sqrt(mel)
    lin_flux = np.maximum(0.0, np.diff(amp, axis=1, prepend=amp[:, :1])).sum(axis=0)
    return log_flux, lin_flux


def _strength_at(env, times, sr, hop, width=1):
    """Largest envelope value within `width` frames of each time."""
    centre = np.rint(np.asarray(times) * sr / hop).astype(int)
    out = np.zeros(len(centre))
    for d in range(-width, width + 1):
        out = np.maximum(out, env[np.clip(centre + d, 0, len(env) - 1)])
    return out


def _bpm_of(times) -> float:
    return 60.0 / float(np.median(np.diff(times)))


def _steady_bpm(times) -> float:
    """Tempo of a beat list. A straight-line fit when the beats are steady (more exact than the
    median gap, which is stuck on the frame grid), the median gap otherwise."""
    gaps = np.diff(times)
    median_gap = float(np.median(gaps))
    index = np.arange(len(times))
    slope, intercept = np.polyfit(index, times, 1)
    worst = float(np.max(np.abs(times - (slope * index + intercept))))
    if slope > 0 and worst < 0.25 * median_gap:
        return 60.0 / float(slope)
    return 60.0 / median_gap


def _halve(times, strengths):
    """Keep every other beat, starting from whichever half is stronger."""
    even, odd = strengths[0::2].mean(), strengths[1::2].mean()
    return times[0::2] if even >= odd else times[1::2]


def _double(times):
    mids = (times[:-1] + times[1:]) / 2.0
    out = np.empty(len(times) + len(mids))
    out[0::2] = times
    out[1::2] = mids
    return out


def _subdivide(times, parts):
    """Split every gap between beats into `parts` equal steps."""
    steps = np.arange(parts) / parts
    inner = (times[:-1, None] + np.diff(times)[:, None] * steps).ravel()
    return np.append(inner, times[-1])


def _slow_pulse_is_clear(strengths, ratio: float = HALVE_RATIO) -> bool:
    """True when every second beat is clearly weak and the other beats are even with each other.

    A strong-weak-medium-weak bar is ordinary 4/4 and does not count: its strong beats differ.
    """
    a, b = strengths[0::2], strengths[1::2]
    strong, weak = (a, b) if a.mean() >= b.mean() else (b, a)
    if weak.mean() >= ratio * strong.mean():
        return False
    first, second = strong[0::2].mean(), strong[1::2].mean()
    return bool(min(first, second) >= EVEN_STRONG_RATIO * max(first, second))


def _fix_octave(times, aenv, sr):
    """Move a half- or double-tempo grid into the 70-160 BPM range when the beats support it.

    - Above 160: keep every other beat (the stronger half).
    - Below 70: add a beat between each pair only if those new beats are about as strong as the
      existing ones. A slow pulse with clearly weaker off-beats stays slow (60 stays 60).
    - Below 45 and not doubled: the tracker has found bars or chord changes rather than beats (for
      example sustained chords with no drums), so each gap is split into 4 (or 2 from 35 BPM up). The
      split beats are a guess, and the low tempo confidence says so.
    - 100 to 160: if every second beat is clearly weak (under 45 percent of the strength of the
      others, which are even with each other; 60 percent above 140 BPM), the slower pulse is the real
      one, so halve it.
    Everything between 70 and 100 is left alone.
    """
    for _ in range(3):
        if len(times) < 2 or _bpm_of(times) <= TEMPO_HIGH:
            break
        times = _halve(times, _strength_at(aenv, times, sr, HOP))
    if len(times) < 3:
        return times
    bpm = _bpm_of(times)
    strengths = _strength_at(aenv, times, sr, HOP)
    if bpm < TEMPO_LOW:
        mids = (times[:-1] + times[1:]) / 2.0
        gap_strength = _strength_at(aenv, mids, sr, HOP)
        if gap_strength.mean() >= SLOW_PULSE_RATIO * strengths.mean() and bpm * 2 <= TEMPO_HIGH:
            times = _double(times)
        elif bpm < VERY_SLOW:
            times = _subdivide(times, 4 if bpm < 35.0 else 2)
    elif bpm >= 100.0 and len(times) >= 16:
        if _slow_pulse_is_clear(strengths, HALVE_RATIO if bpm <= FAST_BPM else FAST_HALVE_RATIO):
            times = _halve(times, strengths)
    return times


def _phase_fit(strengths, n) -> float:
    """How much of the beat-strength variation a pattern repeating every `n` beats explains (0-1)."""
    s = np.asarray(strengths, dtype=float)
    s = s - s.mean()
    total = float((s**2).sum())
    if total <= 1e-12 or len(s) <= n + 1:
        return 0.0
    phase_means = np.array([s[p::n].mean() for p in range(n)])
    explained = float((phase_means[np.arange(len(s)) % n] ** 2).sum()) / total
    return 1.0 - (1.0 - explained) * (len(s) - 1) / (len(s) - n)  # adjusted for the extra freedom


def _ternary_feel(env, times, sr) -> bool:
    """True when every beat is clearly split in three (as in 6/8) and not in two."""
    if len(times) < 9:
        return False
    starts, gaps = times[:-1], np.diff(times)
    keep = gaps >= 0.4  # closer than this the thirds and the half cannot be told apart
    if keep.sum() < 8:
        return False
    starts, gaps = starts[keep], gaps[keep]
    beat = _strength_at(env, starts, sr, HOP).mean()
    third = np.minimum(
        _strength_at(env, starts + gaps / 3, sr, HOP), _strength_at(env, starts + 2 * gaps / 3, sr, HOP)
    ).mean()
    half = _strength_at(env, starts + gaps / 2, sr, HOP).mean()
    return bool(beat > 0 and third >= 0.3 * beat and third >= 2.0 * half)


def _time_signature(env, times, sr):
    """Returns `(numerator, denominator, beats_per_bar, strengths)`.

    3/4 when a three-beat accent pattern explains the beat strengths clearly better than a four-beat
    one. 6/8 (counted as two dotted-quarter beats per bar) only when each beat splits in three and
    there is no three-beat accent pattern. Otherwise 4/4.
    """
    strengths = _strength_at(env, times, sr, HOP)
    if len(times) < 12:
        return 4, 4, 4, strengths
    fit3, fit4 = _phase_fit(strengths, 3), _phase_fit(strengths, 4)
    if fit3 >= 0.3 and fit3 > fit4 + 0.15:
        return 3, 4, 3, strengths
    if _ternary_feel(env, times, sr) and fit3 < 0.3:
        return 6, 8, 2, strengths
    return 4, 4, 4, strengths


def _downbeat_phase(strengths, per_bar) -> int:
    """Which beat of each group of `per_bar` is on average the strongest (0 if none stands out)."""
    means = np.array([strengths[p::per_bar].mean() for p in range(per_bar)])
    return int(np.argmax(means)) if means.max() >= 1.1 * strengths.mean() else 0


def _place_beats(fine_env, times, sr, per_bar, phase):
    """Snap each beat to the sharpest attack within 55 ms and return `(beats, downbeats)`.

    Beats at the very start or end that have no real attack near them (the tracker sometimes adds
    one) are dropped, and the list is kept strictly increasing. Downbeats are a subset of the beats.
    """
    snapped, peaks = [], []
    for t in times:
        lo = max(0, int((t - REFINE_WINDOW_SEC) * sr / FINE_HOP))
        hi = min(len(fine_env), int((t + REFINE_WINDOW_SEC) * sr / FINE_HOP) + 1)
        if hi <= lo:
            snapped.append(float(t))
            peaks.append(0.0)
            continue
        k = lo + int(np.argmax(fine_env[lo:hi]))
        snapped.append(k * FINE_HOP / sr + REFINE_BIAS_SEC)
        peaks.append(float(fine_env[k]))
    snapped, peaks = np.array(snapped), np.array(peaks)
    solid = np.flatnonzero(peaks >= EDGE_BEAT_MIN_STRENGTH * np.median(peaks))
    if solid.size == 0:
        return np.array([]), np.array([])
    keep = np.zeros(len(times), dtype=bool)
    keep[solid[0] : solid[-1] + 1] = True
    keep &= snapped >= 0
    index = np.flatnonzero(keep)
    index = index[np.concatenate([[True], np.diff(snapped[index]) > 1e-3])]
    is_downbeat = (index - phase) % per_bar == 0
    return snapped[index], snapped[index][is_downbeat]


def _tempo_confidence(env, beats, bpm, sr) -> float:
    """0-1: how evenly spaced the beats are, times how strongly the sound repeats at the beat period."""
    gaps = np.diff(beats)
    if len(gaps) < 3:
        return 0.0
    median_gap = float(np.median(gaps))
    spread = 1.4826 * float(np.median(np.abs(gaps - median_gap))) / median_gap
    regular = float(np.clip(1.0 - spread / 0.1, 0.0, 1.0))
    x = env - env.mean()
    size = 1 << int(np.ceil(np.log2(2 * len(x))))
    power = np.abs(np.fft.rfft(x, size)) ** 2
    acf = np.fft.irfft(power, size)[: len(x)]
    if acf[0] <= 0:
        return 0.0
    acf = acf / acf[0]
    lag = 60.0 / bpm * sr / HOP
    lo, hi = max(1, int(lag) - 1), min(len(acf) - 1, int(lag) + 2)
    if hi <= lo:
        return 0.0
    pulse = float(np.clip(acf[lo : hi + 1].max() / 0.5, 0.0, 1.0))
    return float(regular * pulse)


# --- key ---------------------------------------------------------------------------------------


def _profile_matrix():
    """24 x 12: the major and minor profiles rotated so row `mode * 12 + tonic` starts at that tonic."""
    rows = []
    for profile in (MAJOR_PROFILE, MINOR_PROFILE):
        base = np.array(profile, dtype=float)
        for tonic in range(12):
            rows.append(np.roll(base, tonic))
    return np.array(rows)


def _pitch_class_histogram(y, sr):
    """Duration-weighted 12-bin histogram of the harmonic part of the sound (bin 0 = C)."""
    spec = np.abs(librosa.stft(y, n_fft=4096, hop_length=2048))
    harmonic, _ = librosa.decompose.hpss(spec)
    sample = np.linspace(0, spec.shape[1] - 1, min(spec.shape[1], 300)).astype(int)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # "no pitches found" for clicks and noise
        tuning = float(librosa.estimate_tuning(S=harmonic[:, sample], sr=sr, n_fft=4096))
    if not np.isfinite(tuning):
        tuning = 0.0
    chroma = librosa.feature.chroma_stft(S=harmonic, sr=sr, n_fft=4096, tuning=tuning, norm=None)
    loudness = chroma.sum(axis=0)
    if loudness.max() <= 0:
        return np.zeros(12)
    sounding = loudness > 0.05 * np.percentile(loudness, 95)  # skip near-silent frames
    if not sounding.any():
        return np.zeros(12)
    frames = chroma[:, sounding]
    frames = frames / frames.sum(axis=0, keepdims=True)  # each sounding frame counts the same: duration
    return frames.sum(axis=1)


def _estimate_key(y, sr) -> dict:
    hist = _pitch_class_histogram(y, sr)
    names = {0: MAJOR_NAMES, 1: MINOR_NAMES}
    if float(np.std(hist)) < 1e-9 or float(np.mean(hist)) <= 0:  # flat: no pitch to speak of
        return {
            "tonic": "C",
            "mode": "major",
            "confidence": 0.0,
            "runner_up": {"tonic": "C", "mode": "minor", "correlation": 0.0},
        }
    profiles = _profile_matrix()
    h = (hist - hist.mean()) / hist.std()
    p = (profiles - profiles.mean(axis=1, keepdims=True)) / profiles.std(axis=1, keepdims=True)
    corr = p @ h / 12.0
    order = np.argsort(corr)[::-1]
    best, second = int(order[0]), int(order[1])

    def describe(i):
        mode_index, tonic = divmod(i, 12)
        return names[mode_index][tonic], ("major", "minor")[mode_index]

    # Sure when the best key beats the runner-up by 0.2 or more in correlation; discounted when the
    # best match is weak or the histogram is nearly flat (noise, drums, clicks: spread below 0.1).
    gap = float(corr[best] - corr[second])
    spread = float(np.std(hist) / np.mean(hist))
    confidence = float(
        np.clip(gap / 0.2, 0.0, 1.0)
        * min(1.0, max(0.0, float(corr[best])) / 0.5)
        * np.clip((spread - 0.1) / 0.2, 0.0, 1.0)
    )
    tonic, mode = describe(best)
    run_tonic, run_mode = describe(second)
    return {
        "tonic": tonic,
        "mode": mode,
        "confidence": round(confidence, 3),
        "runner_up": {"tonic": run_tonic, "mode": run_mode, "correlation": round(float(corr[second]), 3)},
    }


# --- public ------------------------------------------------------------------------------------


def _prepare(y, sr):
    """Mono float32 samples at SAMPLE_RATE, first MAX_SECONDS only: `(y, sr)`."""
    _require_libs()
    y = np.nan_to_num(np.asarray(y, dtype=np.float32))
    if y.ndim > 1:
        y = np.asarray(librosa.to_mono(y), dtype=np.float32)
    y = y[: int(MAX_SECONDS * sr)]
    if sr != SAMPLE_RATE and y.size:
        y = librosa.resample(y, orig_sr=sr, target_sr=SAMPLE_RATE)
        sr = SAMPLE_RATE
    return y, sr


def estimate_key(y, sr) -> dict:
    """The `key` entry of `analyze_tempo_key`, on its own. Most of its time is spent outside Python's lock,
    so the server runs it in a thread next to the melody step (`analyze_tempo_key(..., with_key=False)`)."""
    return _estimate_key(*_prepare(y, sr))


def analyze_tempo_key(y, sr, *, with_key: bool = True) -> dict:
    """Tempo, beats, downbeats, time signature and key of the samples `y` (mono, rate `sr`).

    `with_key=False` leaves `key` out (see `estimate_key`)."""
    y, sr = _prepare(y, sr)
    if y.size < MIN_SECONDS * sr:
        raise AnalysisError("This recording is too short to analyze. Try one that is a few seconds long.")
    if float(np.max(np.abs(y))) < 1e-3 or float(np.sqrt(np.mean(y.astype(np.float64) ** 2))) < 1e-4:
        raise AnalysisError("This recording is silent, so there is nothing to analyze.")

    env, aenv = _flux(y, sr, 2048, HOP, 128)
    fine_env, _ = _flux(y, sr, FINE_N_FFT, FINE_HOP, 64)
    if not np.any(env > 0):
        raise AnalysisError("I couldn't find any notes or beats in this recording.")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _, frames = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=HOP, start_bpm=120.0)
    times = frames * HOP / sr
    if len(times) < MIN_BEATS:
        raise AnalysisError("I couldn't find a steady beat in this recording.")

    times = _fix_octave(times, aenv, sr)
    numerator, denominator, per_bar, strengths = _time_signature(aenv, times, sr)
    if len(strengths) != len(times):
        strengths = _strength_at(aenv, times, sr, HOP)
    beats, downbeats = _place_beats(fine_env, times, sr, per_bar, _downbeat_phase(strengths, per_bar))
    if len(beats) < MIN_BEATS:
        raise AnalysisError("I couldn't find a steady beat in this recording.")
    bpm = _steady_bpm(beats)

    result = {
        "duration_sec": round(float(len(y)) / sr, 3),
        "tempo_bpm": round(bpm, 2),
        "tempo_confidence": round(_tempo_confidence(env, beats, bpm, sr), 3),
        "beats": [round(float(t), 3) for t in beats],
        "downbeats": [round(float(t), 3) for t in downbeats],
        "key": _estimate_key(y, sr) if with_key else None,
        "time_signature": {"numerator": numerator, "denominator": denominator},
    }
    if not with_key:
        del result["key"]
    return result


def analyze_file(path) -> dict:
    """Load the audio file at `path` and analyze it. Reports the full length even for long files."""
    y, sr = load_audio(path)
    result = analyze_tempo_key(y, sr)
    if len(y) >= MAX_SECONDS * sr:
        with contextlib.suppress(Exception), warnings.catch_warnings():  # else keep the analyzed length
            warnings.simplefilter("ignore")
            result["duration_sec"] = round(float(librosa.get_duration(path=str(Path(path)))), 3)
    return result
