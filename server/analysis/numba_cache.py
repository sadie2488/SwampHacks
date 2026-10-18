"""Keep librosa's saved compiled code (numba's cache) safe when several processes use it.

librosa compiles its number-crunching code the first time it runs and saves the result next to its own
files (or under NUMBA_CACHE_DIR). numba does not lock that cache: two processes saving different
versions of the same function at the same moment can leave it pointing at the wrong code, and the next
process that loads it crashes outright (no Python error: the server just dies). Measured on a fresh
install with the six pitch workers compiling next to the server: 2 of 4 starts crashed on the first upload.

The rules that prevent it:
- Only the server process saves to the cache. Worker processes call `read_only()` first: they use what
  is saved and compile anything missing in memory only.
- `check(probe)` runs a probe in a fresh read-only process before the server process loads anything from
  the cache. If that process dies, the cache is broken (left from an older version of this code, or
  damaged some other way): it is deleted, and the server process then builds a clean one.
"""
from __future__ import annotations

import importlib.util
import logging
import os
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path

log = logging.getLogger("music.server.numba_cache")

PROBE_TIMEOUT_SEC = 180.0  # a probe on a slow disk with nothing cached yet takes well under a minute


def read_only() -> bool:
    """Stop this process from saving compiled code (it still loads what is saved). True when that worked.

    Used as the pitch workers' start-up step. Never raises: without it the workers still run, only less safely.
    """
    try:
        from numba.core import caching

        caching.Cache.save_overload = lambda self, sig, data: None
        return True
    except Exception:  # numba missing or changed: the workers still run, only less safely
        log.info("Could not make the compiled-code cache read-only in this process.", exc_info=True)
        return False


def _cache_roots() -> list[Path]:
    roots = []
    spec = importlib.util.find_spec("librosa")
    if spec is not None and spec.submodule_search_locations:
        roots += [Path(p) for p in spec.submodule_search_locations]
    if os.environ.get("NUMBA_CACHE_DIR"):
        roots.append(Path(os.environ["NUMBA_CACHE_DIR"]))
    return roots


def cache_files() -> list[Path]:
    """librosa's saved compiled code: the `.nbi` index and `.nbc` data files numba wrote for it."""
    found = []
    for root in _cache_roots():
        for pattern in ("*.nbi", "*.nbc"):
            found += [p for p in root.rglob(pattern) if "librosa" in str(p).lower()]
    return found


def clear() -> int:
    """Delete librosa's saved compiled code; it is rebuilt on next use. Returns how many files went. Never raises."""
    removed = 0
    try:
        for path in cache_files():
            try:
                path.unlink()
                removed += 1
            except OSError:
                pass
    except Exception:  # a cleanup must not take the server down
        log.info("Could not clear the compiled-code cache.", exc_info=True)
    return removed


def check(probe, timeout: float = PROBE_TIMEOUT_SEC) -> bool:
    """Run `probe()` in a fresh read-only process. If that process dies, clear the cache and return False.

    True when the probe finished, raised a normal error, timed out, or could not start (none of those say the
    cache is broken). Nothing to check (no cache yet) is True straight away. Never raises.
    """
    try:
        if not cache_files():
            return True
        pool = ProcessPoolExecutor(max_workers=1, initializer=read_only)
    except Exception:
        log.info("Could not check the compiled-code cache.", exc_info=True)
        return True
    try:
        pool.submit(probe).result(timeout=timeout)
        return True
    except BrokenProcessPool:
        removed = clear()
        log.warning("The saved compiled code crashed a test process; deleted it (%d files) to rebuild it.", removed)
        return False
    except Exception:  # the probe's own errors, or a timeout
        log.info("The compiled-code check did not finish.", exc_info=True)
        return True
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
