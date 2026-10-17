"""Choose between Gemini and canned coaching, and protect the Gemini quota.

One `CoachService` lives for the whole server process. It remembers recent answers (so repeating the
same practice run costs nothing) and caps how many calls go out per minute. Nothing here raises: any
problem ends in canned coaching, and the only thing logged is a short reason code.
"""
import logging
import os
import time
from collections import OrderedDict, deque
from dataclasses import dataclass

import httpx

from .canned import canned_coaching
from .facts import cache_key
from .gemini import TOTAL_TIMEOUT_SECONDS, GeminiFailure, ask_gemini

log = logging.getLogger("music.feedback")

CACHE_ENTRIES = 200
CACHE_SECONDS = 10 * 60
CALLS_PER_MINUTE = 30


@dataclass(frozen=True)
class Coaching:
    text: str
    source: str  # "gemini" or "canned"


class CoachService:
    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock=time.monotonic,
        timeout: float = TOTAL_TIMEOUT_SECONDS,
        cache_entries: int = CACHE_ENTRIES,
        cache_seconds: float = CACHE_SECONDS,
        calls_per_minute: int = CALLS_PER_MINUTE,
    ):
        self.transport = transport
        self.timeout = timeout
        self._clock = clock
        self._cache: OrderedDict[str, tuple[float, str]] = OrderedDict()
        self._cache_entries = cache_entries
        self._cache_seconds = cache_seconds
        self._calls: deque[float] = deque()
        self._calls_per_minute = calls_per_minute

    async def coach(self, facts: dict) -> Coaching:
        try:
            return await self._coach(facts)
        except Exception as error:  # noqa: BLE001  (last resort: coaching trouble is never a server error)
            log.warning("Coaching fell back to canned text (error_%s)", type(error).__name__)
            return Coaching(canned_coaching(facts), "canned")

    async def _coach(self, facts: dict) -> Coaching:
        key = cache_key(facts)
        cached = self._cache_get(key)
        if cached is not None:
            return Coaching(cached, "gemini")
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            log.info("Coaching used canned text (no_key)")
            return Coaching(canned_coaching(facts), "canned")
        if not self._take_call_slot():
            log.warning("Coaching fell back to canned text (rate_limited)")
            return Coaching(canned_coaching(facts), "canned")
        try:
            text = await ask_gemini(facts, api_key, transport=self.transport, timeout=self.timeout)
        except GeminiFailure as failure:
            log.warning("Coaching fell back to canned text (%s)", failure.reason)
            return Coaching(canned_coaching(facts), "canned")
        self._cache_put(key, text)
        return Coaching(text, "gemini")

    def _cache_get(self, key: str) -> str | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        expires, text = entry
        if self._clock() >= expires:
            del self._cache[key]
            return None
        self._cache.move_to_end(key)
        return text

    def _cache_put(self, key: str, text: str) -> None:
        self._cache[key] = (self._clock() + self._cache_seconds, text)
        self._cache.move_to_end(key)
        while len(self._cache) > self._cache_entries:
            self._cache.popitem(last=False)

    def _take_call_slot(self) -> bool:
        """Count one outgoing call against the per-minute limit; False when the minute is used up."""
        now = self._clock()
        while self._calls and now - self._calls[0] >= 60:
            self._calls.popleft()
        if len(self._calls) >= self._calls_per_minute:
            return False
        self._calls.append(now)
        return True
