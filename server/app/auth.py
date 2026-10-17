"""Optional login with Auth0. Off unless AUTH_ENABLED=true and AUTH0_DOMAIN is set.

When it is on, a request may carry `Authorization: Bearer <token>`. The token is checked
(RS256 signature against the tenant's public keys, issuer, expiry and, when AUTH0_AUDIENCE is set,
the audience) and the user is the token's subject. Without a good token the visitor is anonymous.

`optional_user` never blocks anyone. `required_user` answers 401 when nobody is signed in.
Nothing here logs or returns the domain, the keys or the token.
"""
import json
import logging
import os
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import Header, HTTPException

from . import config  # noqa: F401  (loads server/.env, which can set AUTH_ENABLED, AUTH0_DOMAIN and AUTH0_AUDIENCE)

log = logging.getLogger("music.server.auth")

# httpx writes every request line, address included, at INFO. Keep the tenant's address out of the logs.
for _noisy in ("httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

JWKS_TTL_SEC = 3600
JWKS_RETRY_SEC = 60  # an unknown key id may trigger a re-fetch, but never more often than this
HTTP_TIMEOUT_SEC = 5.0
MAX_TOKEN_CHARS = 8192
MAX_JWKS_BYTES = 256 * 1024
LEEWAY_SEC = 10
MAX_SUBJECT_CHARS = 255

_warned_about_domain = False
_DOMAIN = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$")


class InvalidToken(Exception):
    """The token is missing a piece, expired, for someone else, or not signed by the tenant."""


class KeysUnavailable(Exception):
    """The tenant's public keys could not be fetched and none are cached."""


@dataclass(frozen=True)
class AuthSettings:
    enabled: bool
    domain: str | None = None
    audience: str | None = None


def _clean_domain(raw: str) -> str | None:
    value = re.sub(r"^https?://", "", raw.strip(), flags=re.IGNORECASE).rstrip("/")
    return value if value and _DOMAIN.match(value) else None


def settings() -> AuthSettings:
    """Read on every call, so a changed environment (or a test) takes effect at once."""
    wanted = os.environ.get("AUTH_ENABLED", "").strip().lower() in ("true", "1", "yes", "on")
    if not wanted:
        return AuthSettings(enabled=False)
    domain = _clean_domain(os.environ.get("AUTH0_DOMAIN", ""))
    if domain is None:
        global _warned_about_domain
        if not _warned_about_domain:
            _warned_about_domain = True
            log.warning("AUTH_ENABLED is on but AUTH0_DOMAIN is missing or not a plain host name: login stays off.")
        return AuthSettings(enabled=False)
    return AuthSettings(enabled=True, domain=domain, audience=os.environ.get("AUTH0_AUDIENCE", "").strip() or None)


class Verifier:
    """Checks Auth0 tokens for one tenant, caching its public keys for an hour."""

    def __init__(
        self,
        domain: str,
        audience: str | None = None,
        *,
        client: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.issuer = f"https://{domain}/"
        self.audience = audience
        self._jwks_url = f"https://{domain}/.well-known/jwks.json"
        self._client = client
        self._clock = clock
        self._lock = threading.Lock()
        self._keys: dict[str, Any] = {}
        self._fetched_at: float | None = None
        self._attempted_at: float | None = None

    # -- keys -----------------------------------------------------------------------------------

    def _download(self) -> dict[str, Any]:
        if self._client is not None:
            response = self._client.get(self._jwks_url)
        else:
            with httpx.Client(timeout=HTTP_TIMEOUT_SEC) as client:
                response = client.get(self._jwks_url)
        response.raise_for_status()
        if len(response.content) > MAX_JWKS_BYTES:
            raise ValueError("The key list is too large.")
        keys: dict[str, Any] = {}
        for jwk in response.json().get("keys", []):
            if not isinstance(jwk, dict) or jwk.get("kty") != "RSA" or not isinstance(jwk.get("kid"), str):
                continue
            if jwk.get("use") not in (None, "sig") or jwk.get("alg") not in (None, "RS256"):
                continue
            try:
                keys[jwk["kid"]] = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
            except (jwt.PyJWTError, ValueError, TypeError):
                continue
        return keys

    def _refresh(self) -> None:
        self._attempted_at = self._clock()
        try:
            keys = self._download()
        except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
            # Only the kind of failure is logged: a message could carry the address.
            log.warning("Could not fetch the login signing keys (%s).", type(exc).__name__)
            return  # keep any older keys; the next try comes after JWKS_RETRY_SEC
        self._keys = keys
        self._fetched_at = self._attempted_at

    def _key_for(self, kid: str) -> Any:
        with self._lock:
            now = self._clock()
            expired = self._fetched_at is None or now - self._fetched_at >= JWKS_TTL_SEC
            may_try = self._attempted_at is None or now - self._attempted_at >= JWKS_RETRY_SEC
            # Fetch when the keys are old, or when the id is unknown (the tenant may have rotated its keys).
            if (expired or kid not in self._keys) and may_try:
                self._refresh()
            if not self._keys:
                raise KeysUnavailable
            key = self._keys.get(kid)
        if key is None:
            raise InvalidToken("unknown key")
        return key

    # -- tokens ---------------------------------------------------------------------------------

    def verify(self, token: str) -> str:
        """The user (the token's subject) if the token is good. Raises InvalidToken or KeysUnavailable."""
        if not token or len(token) > MAX_TOKEN_CHARS:
            raise InvalidToken("bad size")
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise InvalidToken("malformed") from None
        kid = header.get("kid")
        if header.get("alg") != "RS256" or not isinstance(kid, str):
            raise InvalidToken("unsupported header")
        key = self._key_for(kid)
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                issuer=self.issuer,
                audience=self.audience,
                leeway=LEEWAY_SEC,
                options={"require": ["exp", "iss", "sub"], "verify_aud": self.audience is not None},
            )
        except jwt.PyJWTError as exc:
            raise InvalidToken(type(exc).__name__) from None
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject or len(subject) > MAX_SUBJECT_CHARS:
            raise InvalidToken("bad subject")
        return subject


_verifiers: dict[tuple[str, str | None], Verifier] = {}
_verifiers_lock = threading.Lock()
_http_client: httpx.Client | None = None


def use_http_client(client: httpx.Client | None) -> None:
    """Fetch the signing keys through this client (tests), or None to go back to a plain one. Clears cached keys."""
    global _http_client
    with _verifiers_lock:
        _http_client = client
        _verifiers.clear()


def _verifier(active: AuthSettings) -> Verifier:
    with _verifiers_lock:
        key = (active.domain or "", active.audience)
        if key not in _verifiers:
            _verifiers[key] = Verifier(active.domain or "", active.audience, client=_http_client)
        return _verifiers[key]


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.strip().partition(" ")
    token = token.strip()
    return token if scheme.lower() == "bearer" and token else None


def _sign_in_needed(message: str, status: int = 401) -> HTTPException:
    return HTTPException(status, message, headers={"WWW-Authenticate": "Bearer"} if status == 401 else None)


def optional_user(authorization: str | None = Header(default=None)) -> str | None:
    """The signed-in user's id, or None for an anonymous visitor (also when login is off or the token is bad)."""
    active = settings()
    token = _bearer(authorization)
    if not active.enabled or token is None:
        return None
    try:
        return _verifier(active).verify(token)
    except InvalidToken as exc:
        log.info("Ignoring a sign-in token: %s.", exc)
    except KeysUnavailable:
        log.warning("Treating a visitor as anonymous because the login keys could not be fetched.")
    return None


def required_user(authorization: str | None = Header(default=None)) -> str | None:
    """Like `optional_user`, but answers 401 when login is on and nobody valid is signed in.

    With login switched off everyone is anonymous and this returns None.
    """
    active = settings()
    if not active.enabled:
        return None
    token = _bearer(authorization)
    if token is None:
        raise _sign_in_needed("Please sign in to do that.")
    try:
        return _verifier(active).verify(token)
    except InvalidToken:
        raise _sign_in_needed("Your sign-in did not work or has run out. Please sign in again.") from None
    except KeysUnavailable:
        raise _sign_in_needed("Sign-in is not available right now. Please try again in a moment.", 503) from None
