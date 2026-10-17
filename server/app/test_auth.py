"""Tests for the optional login. Keys are made here, tokens are signed here, and the Auth0 key list is a fake."""
import base64
import json
import time
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from . import auth
from .sessions_api import router

DOMAIN = "tenant-marker.invalid"
ISSUER = f"https://{DOMAIN}/"
JWKS_URL = f"https://{DOMAIN}/.well-known/jwks.json"
AUDIENCE = "https://music-api.invalid"


@pytest.fixture(scope="module")
def keys():
    def make():
        return rsa.generate_private_key(public_exponent=65537, key_size=2048)

    return SimpleNamespace(good=make(), other=make(), rotated=make())


def jwk(private, kid):
    document = RSAAlgorithm.to_jwk(private.public_key(), as_dict=True)
    return {**document, "kid": kid, "use": "sig", "alg": "RS256"}


class FakeJwks:
    """The Auth0 key list. Records every request; can be told to fail."""

    def __init__(self, *documents):
        self.documents = list(documents)
        self.requests = []
        self.failure = None
        self.status = 200
        self.body = None

    def __call__(self, request):
        self.requests.append(str(request.url))
        if self.failure is not None:
            raise self.failure
        if self.body is not None:
            return httpx.Response(self.status, content=self.body)
        return httpx.Response(self.status, json={"keys": self.documents})

    def client(self):
        return httpx.Client(transport=httpx.MockTransport(self))


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def token(private, kid="key-1", *, sub="auth0|alice", iss=ISSUER, aud=None, lifetime=3600, **claims):
    now = int(time.time())
    payload = {"sub": sub, "iss": iss, "iat": now, "exp": now + lifetime, **claims}
    if aud is not None:
        payload["aud"] = aud
    payload = {key: value for key, value in payload.items() if value is not None}
    return jwt.encode(payload, private, algorithm="RS256", headers={"kid": kid})


def verifier(jwks, *, audience=None, clock=None):
    return auth.Verifier(DOMAIN, audience, client=jwks.client(), clock=clock or Clock())


@pytest.fixture
def jwks(keys):
    return FakeJwks(jwk(keys.good, "key-1"))


# --- checking a token -------------------------------------------------------------------------------------

def test_a_good_token_gives_the_user(keys, jwks):
    assert verifier(jwks).verify(token(keys.good)) == "auth0|alice"
    assert jwks.requests == [JWKS_URL]


def test_an_expired_token_is_refused(keys, jwks):
    with pytest.raises(auth.InvalidToken, match="ExpiredSignatureError"):
        verifier(jwks).verify(token(keys.good, lifetime=-3600))


def test_a_token_that_just_expired_gets_a_few_seconds_of_slack(keys, jwks):
    assert verifier(jwks).verify(token(keys.good, lifetime=-3)) == "auth0|alice"


def test_a_token_without_an_expiry_is_refused(keys, jwks):
    now = int(time.time())
    no_expiry = jwt.encode({"sub": "auth0|alice", "iss": ISSUER, "iat": now}, keys.good, "RS256", {"kid": "key-1"})
    with pytest.raises(auth.InvalidToken):
        verifier(jwks).verify(no_expiry)


def test_a_token_that_is_not_valid_yet_is_refused(keys, jwks):
    with pytest.raises(auth.InvalidToken):
        verifier(jwks).verify(token(keys.good, nbf=int(time.time()) + 3600))


def test_the_audience_is_checked_when_one_is_configured(keys, jwks):
    check = verifier(jwks, audience=AUDIENCE)
    assert check.verify(token(keys.good, aud=AUDIENCE)) == "auth0|alice"
    assert check.verify(token(keys.good, aud=["https://other.invalid", AUDIENCE])) == "auth0|alice"
    with pytest.raises(auth.InvalidToken, match="InvalidAudienceError"):
        check.verify(token(keys.good, aud="https://someone-else.invalid"))
    with pytest.raises(auth.InvalidToken):
        check.verify(token(keys.good))  # no audience at all


def test_the_audience_is_ignored_when_none_is_configured(keys, jwks):
    assert verifier(jwks).verify(token(keys.good, aud="https://anything.invalid")) == "auth0|alice"


def test_the_wrong_issuer_is_refused(keys, jwks):
    for issuer in ("https://evil.invalid/", ISSUER.rstrip("/"), f"http://{DOMAIN}/", None):
        with pytest.raises(auth.InvalidToken):
            verifier(jwks).verify(token(keys.good, iss=issuer))


def test_a_token_without_a_subject_is_refused(keys, jwks):
    with pytest.raises(auth.InvalidToken):
        verifier(jwks).verify(token(keys.good, sub=None))
    with pytest.raises(auth.InvalidToken, match="bad subject"):
        verifier(jwks).verify(token(keys.good, sub="x" * 300))


def test_a_changed_token_is_refused(keys, jwks):
    original = token(keys.good)
    header, payload, signature = original.split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    claims["sub"] = "auth0|mallory"
    forged = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    with pytest.raises(auth.InvalidToken, match="InvalidSignatureError"):
        verifier(jwks).verify(f"{header}.{forged}.{signature}")


def test_a_token_signed_with_someone_elses_key_is_refused(keys, jwks):
    with pytest.raises(auth.InvalidToken, match="InvalidSignatureError"):
        verifier(jwks).verify(token(keys.other, kid="key-1"))


def test_an_unknown_key_id_is_refused_without_hammering_the_key_list(keys, jwks):
    check = verifier(jwks)
    for _ in range(5):
        with pytest.raises(auth.InvalidToken, match="unknown key"):
            check.verify(token(keys.other, kid="not-listed"))
    assert len(jwks.requests) == 1


def test_a_rotated_key_is_picked_up_after_a_minute(keys, jwks):
    clock = Clock()
    check = verifier(jwks, clock=clock)
    assert check.verify(token(keys.good)) == "auth0|alice"
    jwks.documents.append(jwk(keys.rotated, "key-2"))
    with pytest.raises(auth.InvalidToken):
        check.verify(token(keys.rotated, kid="key-2"))  # too soon to look again
    clock.now += auth.JWKS_RETRY_SEC + 1
    assert check.verify(token(keys.rotated, kid="key-2")) == "auth0|alice"
    assert len(jwks.requests) == 2


def test_keys_are_cached_for_an_hour(keys, jwks):
    clock = Clock()
    check = verifier(jwks, clock=clock)
    check.verify(token(keys.good))
    clock.now += auth.JWKS_TTL_SEC - 1
    check.verify(token(keys.good))
    assert len(jwks.requests) == 1
    clock.now += 2
    check.verify(token(keys.good))
    assert len(jwks.requests) == 2


def test_tokens_with_another_algorithm_are_refused_before_any_key_is_fetched(keys, jwks):
    now = int(time.time())
    payload = {"sub": "auth0|alice", "iss": ISSUER, "exp": now + 600}
    unsigned = jwt.encode(payload, None, algorithm="none", headers={"kid": "key-1"})
    symmetric = jwt.encode(payload, "hmac-test-value-0123456789abcdef", "HS256", {"kid": "key-1"})
    for bad in (unsigned, symmetric):
        with pytest.raises(auth.InvalidToken, match="unsupported header"):
            verifier(jwks).verify(bad)
    no_kid = jwt.encode(payload, keys.good, algorithm="RS256")
    with pytest.raises(auth.InvalidToken, match="unsupported header"):
        verifier(jwks).verify(no_kid)
    assert jwks.requests == []


@pytest.mark.parametrize(
    "junk",
    ["", "abc", "a.b.c", "not a token at all", pytest.param("x" * 9000, id="very-long"), "....", "a.b"],
)
def test_junk_is_refused(junk, jwks):
    with pytest.raises(auth.InvalidToken):
        verifier(jwks).verify(junk)


# --- the key list ---------------------------------------------------------------------------------------

def test_failing_to_fetch_the_key_list_is_reported_without_the_address(keys, jwks, caplog):
    jwks.failure = httpx.ConnectError(f"cannot reach {JWKS_URL}")
    check = verifier(jwks)
    with pytest.raises(auth.KeysUnavailable):
        check.verify(token(keys.good))
    assert DOMAIN not in caplog.text and "ConnectError" in caplog.text


def test_a_failed_fetch_is_not_retried_on_every_request(keys, jwks):
    jwks.failure = httpx.ConnectError("down")
    clock = Clock()
    check = verifier(jwks, clock=clock)
    for _ in range(4):
        with pytest.raises(auth.KeysUnavailable):
            check.verify(token(keys.good))
    assert len(jwks.requests) == 1
    clock.now += auth.JWKS_RETRY_SEC + 1
    jwks.failure = None
    assert check.verify(token(keys.good)) == "auth0|alice"


@pytest.mark.parametrize(
    ("status", "body"),
    [
        pytest.param(500, None, id="server-error"),
        pytest.param(404, None, id="not-found"),
        pytest.param(200, b"not json", id="not-json"),
        pytest.param(200, b'["a", "list"]', id="wrong-shape"),
        pytest.param(200, b"x" * (auth.MAX_JWKS_BYTES + 1), id="too-large"),
    ],
)
def test_a_bad_answer_from_the_key_list_is_reported_as_unavailable(keys, jwks, status, body):
    jwks.status, jwks.body = status, body
    with pytest.raises(auth.KeysUnavailable):
        verifier(jwks).verify(token(keys.good))


def test_old_keys_keep_working_if_a_refresh_fails(keys, jwks):
    clock = Clock()
    check = verifier(jwks, clock=clock)
    assert check.verify(token(keys.good)) == "auth0|alice"
    jwks.failure = httpx.ReadTimeout("slow")
    clock.now += auth.JWKS_TTL_SEC + 5
    assert check.verify(token(keys.good)) == "auth0|alice"
    assert len(jwks.requests) == 2


def test_unusable_entries_in_the_key_list_are_skipped(keys):
    odd = [
        "not even an object",
        {"kty": "oct", "kid": "k-oct", "k": "AAAA"},
        {**jwk(keys.good, "k-sig"), "use": "enc"},
        {**jwk(keys.good, "k-alg"), "alg": "RS512"},
        {"kty": "RSA", "kid": "k-broken", "n": "!!", "e": "AQAB"},
        {**jwk(keys.good, "k-nokid"), "kid": 5},
        jwk(keys.good, "key-1"),
    ]
    check = verifier(FakeJwks(*odd))
    assert check.verify(token(keys.good)) == "auth0|alice"
    for kid in ("k-oct", "k-sig", "k-alg", "k-broken"):
        with pytest.raises(auth.InvalidToken):
            check.verify(token(keys.good, kid=kid))


# --- settings ---------------------------------------------------------------------------------------------

def test_login_is_off_by_default():
    assert auth.settings() == auth.AuthSettings(enabled=False)


@pytest.mark.parametrize("value", ["true", "TRUE", " True ", "1", "yes", "on"])
def test_login_turns_on_only_with_a_domain(monkeypatch, value):
    monkeypatch.setenv("AUTH_ENABLED", value)
    assert auth.settings().enabled is False  # no domain yet
    monkeypatch.setenv("AUTH0_DOMAIN", DOMAIN)
    assert auth.settings() == auth.AuthSettings(enabled=True, domain=DOMAIN, audience=None)


@pytest.mark.parametrize("value", ["", "false", "0", "no", "off", "maybe"])
def test_other_values_leave_login_off(monkeypatch, value):
    monkeypatch.setenv("AUTH0_DOMAIN", DOMAIN)
    monkeypatch.setenv("AUTH_ENABLED", value)
    assert auth.settings().enabled is False


def test_the_domain_is_tidied_and_the_audience_is_read(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("AUTH0_DOMAIN", f"  https://{DOMAIN}/ ")
    monkeypatch.setenv("AUTH0_AUDIENCE", f" {AUDIENCE} ")
    assert auth.settings() == auth.AuthSettings(enabled=True, domain=DOMAIN, audience=AUDIENCE)


@pytest.mark.parametrize("domain", ["evil.invalid/path", "a b", "host?x=1", "user@host.invalid", "-bad.invalid", ""])
def test_a_domain_that_is_not_a_plain_host_name_keeps_login_off(monkeypatch, domain):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("AUTH0_DOMAIN", domain)
    assert auth.settings().enabled is False


def test_a_missing_domain_is_warned_about_only_once(monkeypatch, caplog):
    monkeypatch.setattr(auth, "_warned_about_domain", False)
    monkeypatch.setenv("AUTH_ENABLED", "true")
    for _ in range(3):
        assert auth.settings().enabled is False
    assert caplog.text.count("AUTH0_DOMAIN is missing") == 1


# --- the dependencies ---------------------------------------------------------------------------------------

@pytest.fixture
def login_on(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("AUTH0_DOMAIN", DOMAIN)


def small_app():
    app = FastAPI()

    @app.get("/optional")
    def optional(user: str | None = Depends(auth.optional_user)):
        return {"user": user}

    @app.get("/required")
    def required(user: str | None = Depends(auth.required_user)):
        return {"user": user}

    return TestClient(app)


def bearer(value):
    return {"Authorization": f"Bearer {value}"}


def test_with_login_off_everyone_is_anonymous_and_nothing_is_fetched(keys, jwks):
    auth.use_http_client(jwks.client())
    client = small_app()
    for path in ("/optional", "/required"):
        assert client.get(path).json() == {"user": None}
        assert client.get(path, headers=bearer(token(keys.good))).json() == {"user": None}
    assert jwks.requests == []


def test_a_signed_in_visitor_is_recognised(login_on, keys, jwks):
    auth.use_http_client(jwks.client())
    client = small_app()
    for path in ("/optional", "/required"):
        assert client.get(path, headers=bearer(token(keys.good))).json() == {"user": "auth0|alice"}
    assert len(jwks.requests) == 1  # the keys are fetched once and cached


def test_the_bearer_word_is_not_case_sensitive(login_on, keys, jwks):
    auth.use_http_client(jwks.client())
    client = small_app()
    assert client.get("/optional", headers={"Authorization": f"bearer {token(keys.good)}"}).json()["user"]
    assert client.get("/optional", headers={"Authorization": f"Basic {token(keys.good)}"}).json()["user"] is None
    assert client.get("/optional", headers={"Authorization": token(keys.good)}).json()["user"] is None
    assert client.get("/optional", headers={"Authorization": "Bearer "}).json()["user"] is None


def test_without_a_good_token_the_optional_variant_gives_anonymous(login_on, keys, jwks):
    auth.use_http_client(jwks.client())
    client = small_app()
    bad_tokens = [
        None, "garbage", token(keys.good, lifetime=-3600), token(keys.other), token(keys.good, iss="https://x.invalid/"),
        token(keys.good, kid="unlisted"),
    ]
    for bad in bad_tokens:
        response = client.get("/optional", headers=bearer(bad) if bad else {})
        assert response.status_code == 200 and response.json() == {"user": None}


def test_the_required_variant_answers_401_with_friendly_words(login_on, keys, jwks):
    auth.use_http_client(jwks.client())
    client = small_app()
    missing = client.get("/required")
    assert missing.status_code == 401
    assert missing.json() == {"detail": "Please sign in to do that."}
    assert missing.headers["www-authenticate"] == "Bearer"
    for bad in ("garbage", token(keys.good, lifetime=-3600), token(keys.other), token(keys.good, iss="https://x.invalid/")):
        response = client.get("/required", headers=bearer(bad))
        assert response.status_code == 401 and "sign in again" in response.json()["detail"], bad
        assert response.headers["www-authenticate"] == "Bearer"


def test_when_the_keys_cannot_be_fetched_optional_is_anonymous_and_required_says_try_again(login_on, keys, jwks):
    jwks.failure = httpx.ConnectError(f"cannot reach {JWKS_URL}")
    auth.use_http_client(jwks.client())
    client = small_app()
    assert client.get("/optional", headers=bearer(token(keys.good))).json() == {"user": None}
    response = client.get("/required", headers=bearer(token(keys.good)))
    assert response.status_code == 503 and "try again" in response.json()["detail"]
    assert "www-authenticate" not in response.headers
    assert DOMAIN not in response.text


def test_the_audience_setting_is_enforced_by_the_dependencies(login_on, monkeypatch, keys, jwks):
    monkeypatch.setenv("AUTH0_AUDIENCE", AUDIENCE)
    auth.use_http_client(jwks.client())
    client = small_app()
    assert client.get("/required", headers=bearer(token(keys.good, aud=AUDIENCE))).json() == {"user": "auth0|alice"}
    assert client.get("/required", headers=bearer(token(keys.good, aud="https://other.invalid"))).status_code == 401
    assert client.get("/optional", headers=bearer(token(keys.good))).json() == {"user": None}


def test_the_keys_are_asked_for_on_the_tenants_address(login_on, monkeypatch, keys):
    monkeypatch.setenv("AUTH0_DOMAIN", f"https://{DOMAIN}/")
    jwks = FakeJwks(jwk(keys.good, "key-1"))
    auth.use_http_client(jwks.client())
    assert small_app().get("/optional", headers=bearer(token(keys.good))).json() == {"user": "auth0|alice"}
    assert jwks.requests == [JWKS_URL]


# --- login together with the saving endpoints ------------------------------------------------------------------

def test_what_people_save_belongs_to_them(login_on, keys, jwks):
    auth.use_http_client(jwks.client())
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    alice = bearer(token(keys.good, sub="auth0|alice"))
    bob = bearer(token(keys.good, sub="auth0|bob"))

    session = client.post("/api/sessions", json={"song_id": "demo-twinkle", "tempo_ratio": 1.0}, headers=alice).json()["id"]
    anonymous_session = client.post("/api/sessions", json={"song_id": "demo-twinkle", "tempo_ratio": 1.0}).json()["id"]
    creation = client.post(
        "/api/creations", json={"name": "Mine", "tempo_bpm": 90, "layers": []}, headers=alice
    ).json()["id"]
    sample = {"samples": [{"metric": "played_bpm", "value": 90}]}

    # Alice can use her own things.
    assert client.post(f"/api/sessions/{session}/samples", json=sample, headers=alice).status_code == 200
    assert client.get(f"/api/creations/{creation}", headers=alice).json()["name"] == "Mine"
    assert [s["id"] for s in client.get("/api/sessions", headers=alice).json()] == [session]
    assert [c["id"] for c in client.get("/api/creations", headers=alice).json()] == [creation]

    # Bob and anonymous visitors cannot see or touch them (the answer is the same as "not found").
    for headers in (bob, {}):
        assert client.post(f"/api/sessions/{session}/samples", json=sample, headers=headers).status_code == 404
        assert client.post(f"/api/sessions/{session}/end", json={}, headers=headers).status_code == 404
        assert client.post(
            "/api/feedback-items", json={"session_id": session, "source": "rules", "feedback": {}}, headers=headers
        ).status_code == 404
        assert client.get(f"/api/creations/{creation}", headers=headers).status_code == 404
        assert creation not in [c["id"] for c in client.get("/api/creations", headers=headers).json()]
        assert session not in [s["id"] for s in client.get("/api/sessions", headers=headers).json()]

    # Things saved without signing in are open to everyone who has the id; owners never leak.
    assert client.post(f"/api/sessions/{anonymous_session}/samples", json=sample, headers=bob).status_code == 200
    assert [s["id"] for s in client.get("/api/sessions", headers=bob).json()] == []
    assert [s["id"] for s in client.get("/api/sessions").json()] == [anonymous_session]
    assert "user_id" not in client.get("/api/sessions", headers=alice).json()[0]
    assert "user_id" not in client.get(f"/api/creations/{creation}", headers=alice).json()
