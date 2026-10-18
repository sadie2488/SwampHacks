"""The pitch worker pool: time limits that fit the upload, stopped workers on failure, and a fresh pool later."""
import threading
import time
from concurrent.futures import ProcessPoolExecutor

import pytest

from analysis import pitch_pool

np = pytest.importorskip("numpy")
SR = 22050
HOP = 256


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    monkeypatch.setattr(pitch_pool, "_pool", None)
    monkeypatch.setattr(pitch_pool, "_failures", 0)
    monkeypatch.setattr(pitch_pool, "_retry_at", 0.0)
    monkeypatch.setattr(pitch_pool, "WORKERS", 2)
    yield
    pitch_pool.stop()


class FakeProcess:
    def __init__(self):
        self.terminated = False

    def terminate(self):
        self.terminated = True


class FakePool:
    """Stands in for ProcessPoolExecutor: `map` sleeps `delay` seconds, then fails or answers."""

    def __init__(self, fail=None, delay=0.0, log=None):
        self.fail, self.delay, self.log = fail, delay, log if log is not None else []
        self._processes = {1: FakeProcess(), 2: FakeProcess()}
        self.timeouts = []

    def map(self, fn, chunks, options, timeout=None):
        self.timeouts.append(timeout)
        self.log.append(("start", time.monotonic()))
        time.sleep(self.delay)
        self.log.append(("end", time.monotonic()))
        if self.fail:
            raise self.fail
        frames = [1 + (len(c) - 1) // HOP for c in chunks]
        return [(np.zeros(n), np.zeros(n, dtype=bool), np.zeros(n)) for n in frames]

    def shutdown(self, wait=True, cancel_futures=False):
        pass


def one_pass(monkeypatch):
    calls = []

    def fake(audio, options):
        calls.append(len(audio))
        n = 1 + len(audio) // HOP
        return np.ones(n), np.ones(n, dtype=bool), np.ones(n)

    monkeypatch.setattr(pitch_pool, "_pyin", fake)
    return calls


def test_the_time_limit_grows_with_the_length_of_the_recording():
    short, long_ = pitch_pool.timeout_for(30), pitch_pool.timeout_for(360)
    assert pitch_pool.TIMEOUT_BASE_SEC < short < long_
    assert long_ - short == pytest.approx(330 * pitch_pool.TIMEOUT_PER_AUDIO_SEC)


def test_a_stuck_pool_falls_back_to_one_pass_and_stops_its_workers(monkeypatch):
    calls = one_pass(monkeypatch)
    fake = FakePool(fail=TimeoutError())
    monkeypatch.setattr(pitch_pool, "_pool", fake)
    audio = np.zeros(int(40 * SR), dtype=np.float32)
    f0, _, _ = pitch_pool.pyin(audio, sr=SR, hop_length=HOP)
    assert fake.timeouts == [pitch_pool.timeout_for(40)]
    assert calls == [len(audio)] and f0[0] == 1  # the one-pass answer
    assert all(p.terminated for p in fake._processes.values())
    assert pitch_pool._pool is None and pitch_pool._get_pool() is None  # resting for now


def test_a_later_upload_gets_a_fresh_pool(monkeypatch):
    monkeypatch.setattr(pitch_pool, "_pool", FakePool())
    pitch_pool._give_up("test")
    assert pitch_pool._get_pool() is None
    monkeypatch.setattr(pitch_pool, "_retry_at", time.monotonic() - 1)  # the pause is over
    fresh = pitch_pool._get_pool()
    assert isinstance(fresh, ProcessPoolExecutor)


def test_after_several_failures_in_a_row_the_pool_stays_off(monkeypatch):
    for _ in range(pitch_pool.MAX_FAILURES):
        pitch_pool._give_up("test")
    monkeypatch.setattr(pitch_pool, "_retry_at", 0.0)
    assert pitch_pool._get_pool() is None


def test_a_success_resets_the_failure_count(monkeypatch):
    one_pass(monkeypatch)
    pitch_pool._give_up("test")
    monkeypatch.setattr(pitch_pool, "_retry_at", 0.0)
    monkeypatch.setattr(pitch_pool, "_pool", FakePool())
    f0, _, _ = pitch_pool.pyin(np.zeros(int(40 * SR), dtype=np.float32), sr=SR, hop_length=HOP)
    assert f0[0] == 0 and pitch_pool._failures == 0  # the pool's answer


def test_uploads_take_turns_so_waiting_does_not_eat_into_the_time_limit(monkeypatch):
    one_pass(monkeypatch)
    log = []
    monkeypatch.setattr(pitch_pool, "_pool", FakePool(delay=0.3, log=log))
    audio = np.zeros(int(40 * SR), dtype=np.float32)
    threads = [threading.Thread(target=pitch_pool.pyin, args=(audio,), kwargs={"sr": SR, "hop_length": HOP}) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert [kind for kind, _ in log] == ["start", "end", "start", "end"]  # never both in the pool at once


def test_stopping_the_pool_ends_a_running_worker_process():
    pool = ProcessPoolExecutor(max_workers=1)
    pool.submit(time.sleep, 60)
    deadline = time.monotonic() + 30
    while not pool._processes and time.monotonic() < deadline:
        time.sleep(0.05)
    processes = list(pool._processes.values())
    assert processes
    pitch_pool._terminate(pool)
    for p in processes:
        p.join(timeout=10)
        assert not p.is_alive()
