"""Many notes at once: the basic-pitch model (Spotify, pretrained) turns a recording into note events.

Used for songs with several instruments, after the drums are taken out (`separation.harmonic_part`);
`parts.split_parts` then sorts the notes into melody, bass and chords. The model runs on onnxruntime
(its model file ships inside the basic-pitch package; nothing is downloaded). A 3 minute song takes a few
seconds on a laptop. The libraries load on first use (several seconds), so the server warms them up.
"""
from __future__ import annotations

import logging
import threading

MAX_SECONDS = 360.0  # same limit as the other steps
BATCH = 16  # two-second windows per model call
ONSET_THRESHOLD = 0.5  # the package's defaults
FRAME_THRESHOLD = 0.3
MIN_NOTE_SEC = 0.12

_lock = threading.Lock()
_state: dict = {}


class TranscriptionError(Exception):
    """The polyphonic step could not run (missing library, bad input). The message is for the log."""


def _load():
    """(numpy, onnx session, basic_pitch.inference, basic_pitch.note_creation), loaded once."""
    with _lock:
        if _state:
            return _state["np"], _state["session"], _state["inference"], _state["notes"]
        root = logging.getLogger()
        quiet = logging.NullHandler()
        root.addHandler(quiet)  # the package logs on the root logger at import; keep it from adding its own handler
        try:
            import numpy as np
            import onnxruntime as ort
            from basic_pitch import FilenameSuffix, build_icassp_2022_model_path, inference, note_creation
        except ImportError as err:
            raise TranscriptionError(f"basic-pitch is not installed ({err})") from err
        finally:
            root.removeHandler(quiet)
        path = build_icassp_2022_model_path(FilenameSuffix.onnx)
        options = ort.SessionOptions()
        options.log_severity_level = 3
        session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
        _state.update(np=np, session=session, inference=inference, notes=note_creation)
        return np, session, inference, note_creation


def available() -> bool:
    """True when the model can be loaded. Never raises."""
    try:
        _load()
        return True
    except Exception:
        logging.getLogger(__name__).info("Polyphonic transcription is not available.", exc_info=True)
        return False


def transcribe(y, sr: int, *, max_seconds: float = MAX_SECONDS) -> list[dict]:
    """Note events in mono audio `y` at 22050 Hz: dicts with `start`, `end` (seconds), `pitch` (MIDI), `amp` (0-1).

    Sorted by start, then pitch. Raises `TranscriptionError` when the model cannot run.
    """
    np, session, inference, note_creation = _load()
    c = inference  # constants are re-exported by the inference module
    if sr != c.AUDIO_SAMPLE_RATE:
        raise TranscriptionError(f"expected {c.AUDIO_SAMPLE_RATE} Hz audio, got {sr}")
    audio = np.asarray(y, dtype=np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=0)
    audio = audio[: int(max_seconds * sr)]
    if len(audio) < sr // 2:
        return []

    overlap_frames = 30  # as in the package's own run_inference
    overlap = overlap_frames * c.FFT_HOP
    hop = c.AUDIO_N_SAMPLES - overlap
    padded = np.concatenate([np.zeros(overlap // 2, dtype=np.float32), audio])
    windows = [w for w, _ in inference.window_audio_file(padded, hop)]
    out: dict[str, list] = {"note": [], "onset": []}
    names = ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2"]  # note, onset
    for i in range(0, len(windows), BATCH):
        batch = np.stack(windows[i : i + BATCH]).astype(np.float32)
        note, onset = session.run(names, {"serving_default_input_2:0": batch})
        out["note"].append(note)
        out["onset"].append(onset)
    frames = inference.unwrap_output(np.concatenate(out["note"]), len(audio), overlap_frames)
    onsets = inference.unwrap_output(np.concatenate(out["onset"]), len(audio), overlap_frames)

    min_len = round(MIN_NOTE_SEC * c.AUDIO_SAMPLE_RATE / c.FFT_HOP)
    events = note_creation.output_to_notes_polyphonic(
        frames, onsets, ONSET_THRESHOLD, FRAME_THRESHOLD, min_len, True, None, None, True
    )
    times = note_creation.model_frames_to_time(frames.shape[0] + 1)
    notes = [
        {
            "start": float(times[a]),
            "end": float(times[min(b, len(times) - 1)]),
            "pitch": int(p),
            "amp": float(min(1.0, max(0.0, amp))),
        }
        for a, b, p, amp in events
        if b > a
    ]
    notes.sort(key=lambda n: (n["start"], n["pitch"]))
    return notes
