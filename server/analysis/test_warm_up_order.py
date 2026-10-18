"""Server warm-up order (cache check, then this process compiles, then the read-only workers) and what happens
when pitch tracking breaks: the upload still answers and the next one works."""
import threading
from concurrent.futures.process import BrokenProcessPool

import numpy as np
import pytest

from analysis import numba_cache, pitch_pool
from app import analyzer


@pytest.fixture
def steps(monkeypatch):
    done = []
    monkeypatch.setattr(numba_cache, "check", lambda probe: done.append(("check", probe)))
    monkeypatch.setattr(analyzer, "warm_up", lambda: done.append("warm"))
    monkeypatch.setattr(pitch_pool, "start", lambda: done.append("workers"))
    return done


def test_the_cache_is_checked_then_compiled_here_then_the_workers_start(steps):
    analyzer._warm_up_everything()
    assert steps == [("check", analyzer.warm_up), "warm", "workers"]


def test_uploads_wait_for_the_cache_check_and_only_for_it(monkeypatch, steps):
    release = threading.Event()
    seen = []
    monkeypatch.setattr(numba_cache, "check", lambda probe: release.wait(10))
    monkeypatch.setattr(analyzer, "warm_up", lambda: seen.append(analyzer._compiled_code_checked.is_set()))
    thread = analyzer.start_warm_up()
    assert not analyzer._compiled_code_checked.wait(0.2)  # the check is still running: uploads wait
    release.set()
    thread.join(10)
    assert seen == [True] and analyzer._compiled_code_checked.is_set()


def test_a_failing_cache_check_never_blocks_uploads(monkeypatch, steps):
    def broken(probe):
        raise RuntimeError("no")

    monkeypatch.setattr(numba_cache, "check", broken)
    analyzer.start_warm_up().join(10)
    assert analyzer._compiled_code_checked.is_set() and steps == ["warm", "workers"]


def test_the_workers_never_save_compiled_code(monkeypatch):
    made = {}
    monkeypatch.setattr(pitch_pool, "WORKERS", 3)
    monkeypatch.setattr(pitch_pool, "_pool", None)
    monkeypatch.setattr(pitch_pool, "_failures", 0)
    monkeypatch.setattr(pitch_pool, "_retry_at", 0.0)
    monkeypatch.setattr(pitch_pool, "ProcessPoolExecutor", lambda **kwargs: made.update(kwargs) or object())
    pitch_pool._get_pool()
    assert made["initializer"] is numba_cache.read_only


class _CrashedPool:
    def map(self, *args, **kwargs):
        raise BrokenProcessPool("a worker died")

    def shutdown(self, **kwargs):
        pass


def test_a_crashed_worker_clears_the_cache_and_the_notes_come_from_this_process(monkeypatch):
    cleared = []
    sr, hop = 22050, 512
    audio = np.zeros(int(40 * sr), dtype=np.float32)
    monkeypatch.setattr(pitch_pool, "WORKERS", 3)
    monkeypatch.setattr(pitch_pool, "_pool", _CrashedPool())
    monkeypatch.setattr(pitch_pool, "_failures", 0)
    monkeypatch.setattr(pitch_pool, "_retry_at", 0.0)
    monkeypatch.setattr(numba_cache, "clear", lambda: cleared.append(True) or 0)
    monkeypatch.setattr(pitch_pool, "_pyin", lambda a, options: ("f0", "voiced", "prob"))
    assert pitch_pool.pyin(audio, sr=sr, hop_length=hop) == ("f0", "voiced", "prob")
    assert cleared == [True]
    assert pitch_pool._get_pool() is None  # the pool rests a while before a fresh one is tried


def test_other_pool_trouble_keeps_the_cache(monkeypatch):
    class StuckPool(_CrashedPool):
        def map(self, *args, **kwargs):
            raise TimeoutError

    cleared = []
    monkeypatch.setattr(pitch_pool, "WORKERS", 3)
    monkeypatch.setattr(pitch_pool, "_pool", StuckPool())
    monkeypatch.setattr(pitch_pool, "_failures", 0)
    monkeypatch.setattr(pitch_pool, "_retry_at", 0.0)
    monkeypatch.setattr(numba_cache, "clear", lambda: cleared.append(True) or 0)
    monkeypatch.setattr(pitch_pool, "_pyin", lambda a, options: ("f0", "voiced", "prob"))
    assert pitch_pool.pyin(np.zeros(40 * 22050, dtype=np.float32), sr=22050, hop_length=512)[0] == "f0"
    assert cleared == []
