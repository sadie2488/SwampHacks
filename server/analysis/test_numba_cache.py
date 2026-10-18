"""The compiled-code cache guard: read-only workers, clearing, and the crash check run in a separate process."""
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from analysis import numba_cache

SERVER_DIR = Path(__file__).resolve().parents[1]


def _die():
    os._exit(3)  # what a crash inside compiled code looks like from outside: the process just ends


def _fail():
    raise RuntimeError("a normal error")


def _compile_cached_function(folder: Path, read_only: bool) -> list[str]:
    """Run a cache=True numba function in a fresh process; return the cache files it left behind."""
    (folder / "tiny.py").write_text("import numba\n\n@numba.njit(cache=True)\ndef f(x):\n    return x + 1\n")
    code = textwrap.dedent(f"""
        import sys
        sys.path.insert(0, {str(folder)!r})
        from analysis import numba_cache
        if {read_only!r}:
            assert numba_cache.read_only()
        import tiny
        assert tiny.f(1) == 2
    """)
    env = {k: v for k, v in os.environ.items() if k != "NUMBA_CACHE_DIR"}
    subprocess.run([sys.executable, "-c", code], cwd=SERVER_DIR, env=env, check=True, timeout=120)
    return sorted(p.suffix for p in folder.rglob("*.nb?"))


def test_a_read_only_process_compiles_but_never_saves(tmp_path):
    assert _compile_cached_function(tmp_path, read_only=True) == []


def test_a_normal_process_saves_what_it_compiled(tmp_path):  # proves the test above can see a save
    assert _compile_cached_function(tmp_path, read_only=False) == [".nbc", ".nbi"]


@pytest.fixture
def fake_cache(tmp_path, monkeypatch):
    root = tmp_path / "librosa"
    (root / "core" / "__pycache__").mkdir(parents=True)
    for name in ("pitch.f-1.py312.nbi", "pitch.f-1.py312.1.nbc", "pitch.cpython-312.pyc"):
        (root / "core" / "__pycache__" / name).write_bytes(b"x")
    (root / "pitch.py").write_text("")
    monkeypatch.setattr(numba_cache, "_cache_roots", lambda: [root])
    return root


def test_clearing_removes_only_the_compiled_code(fake_cache):
    assert len(numba_cache.cache_files()) == 2
    assert numba_cache.clear() == 2
    left = sorted(p.name for p in fake_cache.rglob("*") if p.is_file())
    assert left == ["pitch.cpython-312.pyc", "pitch.py"]


def test_the_check_clears_the_cache_when_the_probe_process_dies(fake_cache):
    assert numba_cache.check(_die, timeout=60) is False
    assert numba_cache.cache_files() == []


def test_a_normal_error_in_the_probe_keeps_the_cache(fake_cache):
    assert numba_cache.check(_fail, timeout=60) is True
    assert len(numba_cache.cache_files()) == 2


def test_with_nothing_saved_there_is_nothing_to_check(monkeypatch):
    monkeypatch.setattr(numba_cache, "cache_files", list)

    def no_process(*args, **kwargs):
        raise AssertionError("must not start a process")

    monkeypatch.setattr(numba_cache, "ProcessPoolExecutor", no_process)
    assert numba_cache.check(_die) is True


def test_the_check_never_raises(monkeypatch):
    def broken():
        raise OSError("disk trouble")

    monkeypatch.setattr(numba_cache, "cache_files", broken)
    assert numba_cache.check(_die) is True
