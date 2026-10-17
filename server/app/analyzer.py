"""Audio analysis for uploads: tempo, beats, key, time signature and the melody as notes.

`analyze_audio(path)` returns the musical content of a `song-analysis` document. The caller
(`store.save_upload`) adds `song_id`, `title`, `source` and `analyzed_at`.

The steps, using the building blocks in `server/analysis/`:
1. Load the audio once (mono, 22050 Hz, first six minutes).
2. `tempo_key.analyze_tempo_key`: duration, tempo, beats, downbeats, key, time signature.
3. `melody.extract_melody` with that tempo and those beats, wrapped into one `melody` part. When the
   result looks like many instruments at once, the step runs a second time on the sound with the
   drums taken out (`separation.harmonic_part`), and keeps that result only if it is clearly better.
`sections` is left out: nothing cheap and trustworthy produces it yet.

Honest failures, all in plain words:
- Step 2 cannot work (silence, too short, unreadable file), or it only invents a tempo for noise (no
  melody and a tempo confidence near zero): `AnalysisFailed`, which the API answers with HTTP 422 and
  the same message. The caller deletes the saved upload.
- Only step 3 fails: the analysis is still returned with `parts: []` and a warning.
- The analysis tools are not installed: the example (Twinkle) analysis comes back with a warning
  saying so, so a machine without the audio libraries still runs.

`warnings` is an extra property of the document (the contract allows extra properties): a list of
plain sentences for the person who uploaded the song. It is left out when there is nothing to say.
"""
import importlib
import json
import logging
import shutil
import threading
import time
from contextlib import suppress
from pathlib import Path

from . import config

log = logging.getLogger("music.server.analyzer")

WARNING_NO_MELODY = (
    "I couldn't find a single melody line in this song, so there is no sheet music, "
    "but the tempo and key are real."
)
WARNING_FULL_MIX = (
    "This song has many instruments playing at once, so the notes may not be right. "
    "For the best sheet music, use a recording of one instrument playing alone."
)
WARNING_TOO_LONG = "This song is longer than 6 minutes, so only the first 6 minutes were analyzed."
WARNING_UNAVAILABLE = (
    "Real song analysis is not available on this server right now, so the tempo, key and notes "
    "shown are an example, not your song."
)
ERROR_NO_MUSIC = (
    "I couldn't find a steady beat or a melody in this recording, so there is nothing to show. "
    "Please try a recording of a song or a tune."
)
ERROR_NEEDS_TOOL = (
    "That file type needs a tool this computer doesn't have. Please upload an MP3, WAV, FLAC or OGG file."
)

# File types the audio libraries can only read through the ffmpeg program.
NEEDS_FFMPEG = {".m4a", ".aac"}

# Noise: the tempo step still returns beats, but its confidence is at or near zero (white noise, brown
# noise and slowly pulsing noise measured 0.00 to 0.02; a steady tune over a click track 0.9 or more).
# A hummed tune with no beat also scores near zero, but it has a melody, so it is kept. With no melody
# either there is no music to describe, so the upload is turned down instead of showing an invented tempo.
NO_MUSIC_MAX_TEMPO_CONFIDENCE = 0.05

# "Many instruments at once" check, run on the melody that was found. A single instrument or voice
# gives notes that pitch tracking is sure about; a full mix does not. Measured on generated audio:
# a lone melody scores 0.8 to 0.9 (0.65 with drums over it); the same tune inside chords, bass and
# drums scores 0.2 to 0.45. The line sits at 0.5. A very high note rate is the other sign: the pitch
# tracker flickers between the instruments. Nine notes a second is a sustained run of sixteenth notes
# at about 135 BPM, which is rare for a tune a beginner plays.
FULL_MIX_MAX_CONFIDENCE = 0.5  # length-weighted average of the notes' pitch confidence (0 to 1)
FULL_MIX_MAX_NOTES_PER_SEC = 9.0
FULL_MIX_MIN_NOTES = 4  # too few notes to judge

# Second try for a full mix: the melody step runs again on the sound with the drums taken out
# (`analysis/separation.py`). It replaces the first result only when it is clearly better, so a song
# the drum removal cannot help keeps its first result and its warning. Measured on generated drum
# mixes (quiet chord underneath): the confidence of mixes that were flagged went from 0.2 to 0.3 up to
# 0.5 to 0.9, and the note rate dropped by half or more where drum hits had been read as notes.
DRUMS_OUT_MIN_GAIN = 0.1  # to count as better it needs this much more pitch confidence...
DRUMS_OUT_MAX_RATE_SHARE = 0.9  # ...with at most this share of the first try's notes a second...
DRUMS_OUT_KEEP_SOUND_SHARE = 0.5  # ...and it must still cover this share of the first try's note time
DRUMS_OUT_CLEAR_CONFIDENCE = FULL_MIX_MAX_CONFIDENCE + 0.1  # the warning goes only above this, not just past the line


class AnalysisFailed(Exception):
    """The upload cannot be analyzed. `str(error)` is plain words that are safe to show."""


def load_demo_analysis() -> dict:
    """The built-in Twinkle analysis, straight from the shared fixtures (a fresh copy each call)."""
    return json.loads(config.DEMO_ANALYSIS_FILE.read_text(encoding="utf-8"))


def _engine():
    """The `(tempo_key, melody)` modules when the audio libraries are installed, otherwise None.

    Imported on first use so that starting the server stays quick.
    """
    try:
        tempo_key = importlib.import_module("analysis.tempo_key")
        melody = importlib.import_module("analysis.melody")
    except ImportError:
        log.warning("The audio analysis tools could not be loaded.")
        return None
    if tempo_key.librosa is None or tempo_key.np is None:
        log.warning("The audio analysis libraries are not installed.")
        return None
    return tempo_key, melody


def _melody_stats(notes: list[dict]) -> tuple[float, float, float] | None:
    """(length-weighted pitch confidence, notes a second, seconds of sound), or None with too few notes to judge."""
    if len(notes) < FULL_MIX_MIN_NOTES:
        return None
    total = sum(n["duration_sec"] for n in notes)
    if total <= 0:
        return None
    confidence = sum(n.get("confidence", 1.0) * n["duration_sec"] for n in notes) / total
    span = max(n["onset_sec"] + n["duration_sec"] for n in notes) - min(n["onset_sec"] for n in notes)
    return confidence, len(notes) / span if span > 0 else 0.0, total


def looks_like_full_mix(notes: list[dict]) -> bool:
    """True when the melody found looks like it came from many instruments at once (see the thresholds above)."""
    stats = _melody_stats(notes)
    if stats is None:
        return False
    confidence, rate, _ = stats
    return confidence < FULL_MIX_MAX_CONFIDENCE or rate > FULL_MIX_MAX_NOTES_PER_SEC


def _load(path: Path, tempo_key):
    try:
        return tempo_key.load_audio(path)
    except tempo_key.AnalysisError as err:
        # A read failure (as opposed to an empty file) on a type that needs ffmpeg, with no ffmpeg here.
        if err.__cause__ is not None and path.suffix.lower() in NEEDS_FFMPEG and shutil.which("ffmpeg") is None:
            raise AnalysisFailed(ERROR_NEEDS_TOOL) from err
        raise AnalysisFailed(str(err)) from err


def _full_duration(tempo_key, path: Path, analyzed_sec: float) -> float:
    """Length of the whole file when only its first minutes were analyzed (else the analyzed length)."""
    with suppress(Exception):
        return float(tempo_key.librosa.get_duration(path=str(path)))
    return analyzed_sec


def _melody_part(melody, y, sr: int, result: dict) -> tuple[list[dict], list[str]]:
    """The `parts` list and any warnings from the melody step. This step never fails the upload."""
    try:
        notes = melody.extract_melody(y, sr, result["tempo_bpm"], result["beats"])
    except melody.AnalysisError as err:
        log.info("No melody found: %s", err)
        return [], [WARNING_NO_MELODY]
    except Exception:
        log.exception("Melody extraction failed")
        return [], [WARNING_NO_MELODY]
    mixed = looks_like_full_mix(notes)
    if mixed:
        notes, mixed = _without_drums(melody, y, sr, result, notes)
    part = melody.melody_to_part(notes)  # also suggests an instrument when the range fits one
    return [part], [WARNING_FULL_MIX] if mixed else []


def _clearly_better(first: list[dict], second: list[dict]) -> bool:
    """Is the second try's melody clearly better than the first's? See the DRUMS_OUT_* notes above."""
    before, after = _melody_stats(first), _melody_stats(second)
    if before is None or after is None:
        return False
    if after[2] < DRUMS_OUT_KEEP_SOUND_SHARE * before[2] or after[0] < before[0]:
        return False  # most of the melody went missing, or the pitch tracker got less sure
    if not looks_like_full_mix(second):
        return True
    return after[0] >= before[0] + DRUMS_OUT_MIN_GAIN and after[1] <= DRUMS_OUT_MAX_RATE_SHARE * before[1]


def _without_drums(melody, y, sr: int, result: dict, notes: list[dict]) -> tuple[list[dict], bool]:
    """`(notes, still looks like a full mix)` after a second try on the sound with the drums taken out.

    The second result is used only when it is clearly better; any failure keeps the first result.
    The outcome goes to the log only, never to the person's warnings.
    """
    try:
        started = time.monotonic()
        separation = importlib.import_module("analysis.separation")
        again = melody.extract_melody(separation.harmonic_part(y, sr), sr, result["tempo_bpm"], result["beats"])
        seconds = time.monotonic() - started
    except melody.AnalysisError as err:
        log.info("Full-mix second try without drums found no melody (%s); the first result stays.", err)
        return notes, True
    except Exception:
        log.info("Full-mix second try without drums failed; the first result stays.", exc_info=True)
        return notes, True
    before, after = _melody_stats(notes), _melody_stats(again)
    better = _clearly_better(notes, again)
    log.info(
        "Full-mix second try without drums took %.1f s: %s (confidence %.2f -> %s, notes a second %.1f -> %s).",
        seconds,
        "used" if better else "not used, the first result stays",
        before[0],
        f"{after[0]:.2f}" if after else "n/a",
        before[1],
        f"{after[1]:.1f}" if after else "n/a",
    )
    if not better:
        return notes, True
    return again, looks_like_full_mix(again) or after[0] < DRUMS_OUT_CLEAR_CONFIDENCE


def analyze_audio(path: Path) -> dict:
    """Analyze the audio file at `path` and return a song-analysis dict (see the module notes).

    Raises `AnalysisFailed` (plain-words message) when the tempo and key cannot be found.
    """
    engine = _engine()
    if engine is None:
        analysis = load_demo_analysis()
        analysis["warnings"] = [WARNING_UNAVAILABLE]
        return analysis
    tempo_key, melody = engine
    path = Path(path)

    y, sr = _load(path, tempo_key)
    try:
        result = tempo_key.analyze_tempo_key(y, sr)
    except tempo_key.AnalysisError as err:
        raise AnalysisFailed(str(err)) from err

    warnings: list[str] = []
    if len(y) >= tempo_key.MAX_SECONDS * sr:  # the building blocks only look at the first six minutes
        full = _full_duration(tempo_key, path, result["duration_sec"])
        if full > tempo_key.MAX_SECONDS + 1:
            result["duration_sec"] = round(full, 3)
            warnings.append(WARNING_TOO_LONG)

    parts, melody_warnings = _melody_part(melody, y, sr, result)
    if not parts and result["tempo_confidence"] < NO_MUSIC_MAX_TEMPO_CONFIDENCE:
        raise AnalysisFailed(ERROR_NO_MUSIC)
    warnings += melody_warnings

    analysis = {"version": 1, **result, "parts": parts}
    if warnings:
        analysis["warnings"] = warnings
    return analysis


# --- warm-up -------------------------------------------------------------------------------------
# The first analysis in a fresh process spends several seconds (up to about twenty on a cold disk)
# compiling numerical code. A background thread does that once at server start, on a few seconds of
# generated sound, so the first real upload is not the slow one.

WARM_UP_SECONDS = 5.0  # the tempo step needs 2 seconds and 4 beats


def _warm_up_audio(np, sr: int):
    """A click track at 120 BPM with a four-note tune on top."""
    y = np.zeros(int(WARM_UP_SECONDS * sr), dtype=np.float32)
    t = np.arange(len(y)) / sr
    rng = np.random.default_rng(0)
    burst = rng.normal(0, 0.4, int(0.02 * sr)) * np.exp(-np.arange(int(0.02 * sr)) / (0.004 * sr))
    for start in np.arange(0.25, WARM_UP_SECONDS - 0.1, 0.5):
        i = int(start * sr)
        y[i : i + len(burst)] += burst[: len(y) - i]
    for k, midi in enumerate((60, 64, 67, 72)):
        a, b = int((0.25 + k * 1.0) * sr), int((0.25 + k * 1.0 + 0.9) * sr)
        freq = 440.0 * 2 ** ((midi - 69) / 12)
        y[a:b] += 0.3 * (np.sin(2 * np.pi * freq * t[a:b]) + 0.5 * np.sin(4 * np.pi * freq * t[a:b])) / 1.5
    return y


def warm_up() -> bool:
    """Run both analysis steps once on generated sound. Never raises. True when both ran."""
    try:
        engine = _engine()
        if engine is None:
            return False
        tempo_key, melody = engine
        sr = tempo_key.SAMPLE_RATE
        y = _warm_up_audio(tempo_key.np, sr)
        ok = True
        beats, bpm = None, 120.0
        try:
            result = tempo_key.analyze_tempo_key(y, sr)
            beats, bpm = result["beats"], result["tempo_bpm"]
        except Exception:
            ok = False
            log.info("Warm-up of the tempo step did not finish.", exc_info=True)
        try:
            melody.extract_melody(y, sr, bpm, beats)
        except Exception:
            ok = False
            log.info("Warm-up of the melody step did not finish.", exc_info=True)
        return ok
    except Exception:
        log.info("Analysis warm-up skipped.", exc_info=True)
        return False


def start_warm_up() -> threading.Thread | None:
    """Start `warm_up` in a background thread that does not keep the server alive. Never blocks or raises."""
    try:
        thread = threading.Thread(target=warm_up, name="analysis-warm-up", daemon=True)
        thread.start()
        return thread
    except Exception:
        log.info("Could not start the analysis warm-up.", exc_info=True)
        return None
