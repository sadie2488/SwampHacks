"""pYIN pitch tracking on a long recording, spread over several worker processes.

pYIN spends most of its time in per-frame Python code, so threads do not help (measured: slower), but
separate processes do. The frames are cut into one chunk per worker; each chunk is tracked with a few
seconds of extra sound on both sides and keeps only its own frames, so the result matches one pass over
the whole recording (measured on a 3 minute full mix: every frame's voicing and pitch the same).

Short recordings, a machine with few cores, or any trouble with the workers: one pass in this process,
so the notes never depend on the pool. `start()` launches the workers early (server start) so the first
upload does not pay for them; `stop()` lets them go.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from itertools import repeat

log = logging.getLogger("music.server.pitch_pool")

PAD_SEC = 3.0  # extra sound on each side of a chunk; the pitch path settles well within this
MIN_PARALLEL_SEC = 30.0  # shorter recordings take about a second in one pass: not worth the hand-off
WORKERS = max(1, min(6, (os.cpu_count() or 2) - 2))  # leave cores for the server and the drum removal

_pool: ProcessPoolExecutor | None = None
_broken = False
_lock = threading.Lock()


def _pyin(audio, options: dict):
    import librosa

    return librosa.pyin(audio, **options)


def _warm(seconds: float) -> bool:
    """Run inside a worker: load the libraries and compile pYIN once, then hold the worker a moment."""
    import numpy as np

    sr = 22050
    t = np.arange(int(seconds * sr)) / sr
    _pyin((0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), {"fmin": 65.0, "fmax": 2000.0, "sr": sr})
    time.sleep(0.5)  # so each warm-up job lands on its own worker
    return True


def _get_pool() -> ProcessPoolExecutor | None:
    global _pool
    with _lock:
        if _pool is None and not _broken and WORKERS > 1:
            _pool = ProcessPoolExecutor(max_workers=WORKERS)
        return _pool


def _give_up(reason: str) -> None:
    global _pool, _broken
    log.warning("Pitch tracking falls back to one process: %s", reason)
    with _lock:
        _broken = True
        pool, _pool = _pool, None
    if pool is not None:
        pool.shutdown(wait=False, cancel_futures=True)


def start() -> None:
    """Launch the workers and warm them up in the background. Never blocks for long, never raises."""
    try:
        pool = _get_pool()
        if pool is not None:
            for _ in range(WORKERS):
                pool.submit(_warm, 1.0)
    except Exception as err:  # noqa: BLE001 - the pool is only a speed-up
        _give_up(type(err).__name__)


def stop() -> None:
    """Let the workers go (server shutdown). Never raises."""
    global _pool
    with _lock:
        pool, _pool = _pool, None
    if pool is not None:
        pool.shutdown(wait=False, cancel_futures=True)


def pyin(audio, *, sr: int, hop_length: int, **options):
    """`librosa.pyin(audio, sr=sr, hop_length=hop_length, **options)`: `(f0, voiced, probability)` per frame."""
    options = {"sr": sr, "hop_length": hop_length, **options}
    pool = _get_pool() if len(audio) >= MIN_PARALLEL_SEC * sr else None
    if pool is None:
        return _pyin(audio, options)
    import numpy as np

    n_frames = 1 + len(audio) // hop_length  # frames of one centered pass over the whole recording
    step = -(-n_frames // WORKERS)
    pad = int(PAD_SEC * sr / hop_length)
    spans, chunks = [], []
    for first in range(0, n_frames, step):
        last = min(n_frames, first + step)
        lo, hi = max(0, first - pad), min(n_frames, last + pad)
        spans.append((first - lo, last - lo))
        chunks.append(audio[lo * hop_length : (hi - 1) * hop_length + 1])  # exactly frames lo..hi-1
    try:
        outs = list(pool.map(_pyin, chunks, repeat(options), timeout=120))
    except Exception as err:  # noqa: BLE001 - a broken or stuck pool must not fail the upload
        _give_up(type(err).__name__)
        return _pyin(audio, options)
    return tuple(np.concatenate([out[k][a:b] for out, (a, b) in zip(outs, spans)]) for k in range(3))
