"""pYIN pitch tracking on a long recording, spread over several worker processes.

pYIN spends most of its time in per-frame Python code, so threads do not help (measured: slower), but
separate processes do. The frames are cut into one chunk per worker; each chunk is tracked with a few
seconds of extra sound on both sides and keeps only its own frames, so the result matches one pass over
the whole recording (measured on a 3 minute full mix: every frame's voicing and pitch the same).

Short recordings, a machine with few cores, or any trouble with the workers: one pass in this process,
so the notes never depend on the pool. `start()` launches the workers early (server start) so the first
upload does not pay for them; `stop()` lets them go.

The workers never save compiled code (`numba_cache.read_only`): six processes compiling pYIN at once next to
the server used to damage librosa's compiled-code cache and crash the server. Start them after this process
has compiled pYIN (the server's warm-up does that), so they only load it. A worker that dies abruptly is
taken as a sign of a damaged cache: the cache is deleted (rebuilt on next use) and this process carries on.

One upload uses the pool at a time (a second one waits its turn), so an upload's time limit only counts
its own work. The limit grows with the length of the recording. When the workers fail or run out of time,
they are stopped (not left running) and the upload finishes in one pass; a fresh pool is tried again on a
later upload, after a pause, and not at all after a few failures in a row.
"""
from __future__ import annotations

import contextlib
import logging
import os
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from itertools import repeat

from . import numba_cache

log = logging.getLogger("music.server.pitch_pool")

PAD_SEC = 3.0  # extra sound on each side of a chunk; the pitch path settles well within this
MIN_PARALLEL_SEC = 30.0  # shorter recordings take about a second in one pass: not worth the hand-off
WORKERS = max(1, min(6, (os.cpu_count() or 2) - 2))  # leave cores for the server and the drum removal
# One pass takes about a second per 30 s of sound; the limit leaves room for a cold start and a busy machine.
TIMEOUT_BASE_SEC = 60.0
TIMEOUT_PER_AUDIO_SEC = 0.5
RETRY_AFTER_SEC = 60.0  # after a failure, uploads use one pass for this long before a fresh pool is tried
MAX_FAILURES = 3  # failures in a row before the pool stays off until the server restarts

_pool: ProcessPoolExecutor | None = None
_failures = 0
_retry_at = 0.0
_lock = threading.Lock()
_turn = threading.Lock()  # one upload uses the pool at a time


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


def timeout_for(seconds_of_audio: float) -> float:
    """How long an upload's pitch tracking may take in the pool before it is done in one pass instead."""
    return TIMEOUT_BASE_SEC + TIMEOUT_PER_AUDIO_SEC * max(0.0, seconds_of_audio)


def _get_pool() -> ProcessPoolExecutor | None:
    global _pool
    with _lock:
        usable = _failures < MAX_FAILURES and time.monotonic() >= _retry_at
        if _pool is None and usable and WORKERS > 1:
            _pool = ProcessPoolExecutor(max_workers=WORKERS, initializer=numba_cache.read_only)
        return _pool


def _terminate(pool: ProcessPoolExecutor) -> None:
    """Stop the pool's worker processes now, even mid-job, so a stuck job stops using the CPU."""
    processes = list((getattr(pool, "_processes", None) or {}).values())  # no public way before Python 3.14
    for process in processes:
        with contextlib.suppress(Exception):
            process.terminate()
    with contextlib.suppress(Exception):
        pool.shutdown(wait=False, cancel_futures=True)


def _give_up(reason: str) -> None:
    global _pool, _failures, _retry_at
    with _lock:
        _failures += 1
        _retry_at = time.monotonic() + RETRY_AFTER_SEC
        pool, _pool = _pool, None
        failures = _failures
    later = "for now" if failures < MAX_FAILURES else "until the server restarts"
    log.warning("Pitch tracking falls back to one process %s: %s", later, reason)
    if pool is not None:
        _terminate(pool)


def _worked() -> None:
    global _failures
    with _lock:
        _failures = 0


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
        _terminate(pool)


def pyin(audio, *, sr: int, hop_length: int, **options):
    """`librosa.pyin(audio, sr=sr, hop_length=hop_length, **options)`: `(f0, voiced, probability)` per frame."""
    options = {"sr": sr, "hop_length": hop_length, **options}
    if len(audio) < MIN_PARALLEL_SEC * sr or _get_pool() is None:
        return _pyin(audio, options)
    with _turn:  # waiting for another upload does not count against this one's time limit
        pool = _get_pool()  # may have been stopped while waiting
        result = _pyin_in_pool(pool, audio, options, timeout_for(len(audio) / sr)) if pool is not None else None
    return result if result is not None else _pyin(audio, options)


def _pyin_in_pool(pool: ProcessPoolExecutor, audio, options: dict, timeout: float):
    """The pool's answer, or None (after stopping the workers) when it failed or ran out of time."""
    import numpy as np

    hop_length = options["hop_length"]
    sr = options["sr"]

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
        outs = list(pool.map(_pyin, chunks, repeat(options), timeout=timeout))
    except Exception as err:  # noqa: BLE001 - a broken or stuck pool must not fail the upload
        _give_up(type(err).__name__)
        if isinstance(err, BrokenProcessPool):  # a worker died: most likely damaged compiled code
            numba_cache.clear()
        return None
    _worked()
    return tuple(np.concatenate([out[k][a:b] for out, (a, b) in zip(outs, spans)]) for k in range(3))
