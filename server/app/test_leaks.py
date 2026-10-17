"""Nothing private may come out: not in a response body, a header, a log line, or what the commands print.

The markers below are made-up words. The address is assembled from pieces so no address-shaped text sits in
this file. Every scenario forces failures whose own error messages are full of the markers.
"""
import io
import logging
import os
import subprocess
import sys

import httpx
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from . import auth, config, db, repository
from .repository import MemoryRepository
from .sessions_api import router
from .test_auth import FakeJwks, jwk, token
from .test_sessions_api import DOWN_CALLS, make_creation, new_session, start

USER, PASSWORD, HOST, DBNAME = "leakuser7", "leakpass7", "leakhost7.invalid", "leakdb7"
DB_URL = "postgresql://" + USER + ":" + PASSWORD + "@" + HOST + ":5432/" + DBNAME
DOMAIN = "leakdomain7.invalid"
GEMINI = "leakgemini7value"
MARKERS = [DB_URL, USER, PASSWORD, HOST, DBNAME, DOMAIN, GEMINI]
ISSUER = f"https://{DOMAIN}/"
JWKS_URL = f"https://{DOMAIN}/.well-known/jwks.json"

NASTY = (
    f'connection to server at "{HOST}" (10.9.9.9), port 5432 failed: FATAL: password authentication failed for '
    f'user "{USER}" database "{DBNAME}" -- {DB_URL} -- host={HOST} password={PASSWORD} -- {GEMINI} -- {DOMAIN}'
)

ERRORS = {
    "refused": lambda: psycopg.OperationalError(NASTY),
    "missing-table": lambda: psycopg.errors.UndefinedTable(f'relation "songs" does not exist {NASTY}'),
    "bad-password": lambda: psycopg.errors.InvalidPassword(NASTY),
    "bad-data": lambda: psycopg.errors.DataError(NASTY),
    "bad-address": lambda: psycopg.ProgrammingError(f'invalid connection option "{DB_URL}"'),
    "socket": lambda: OSError(f"[Errno 111] Connection refused {NASTY}"),
}


@pytest.fixture(scope="module")
def private_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def leaky_environment(monkeypatch, caplog):
    monkeypatch.setenv("DATABASE_URL", DB_URL)
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("AUTH0_DOMAIN", DOMAIN)
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI)
    caplog.set_level(logging.DEBUG)


def fail_with(monkeypatch, make_error):
    def connect(*args, **kwargs):
        raise make_error()

    monkeypatch.setattr(psycopg, "connect", connect)


def everything_said(responses, caplog, capsys):
    shown = "\n".join(f"{r.status_code} {dict(r.headers)} {r.text}" for r in responses)
    printed = capsys.readouterr()
    return shown + "\n" + caplog.text + "\n" + printed.out + "\n" + printed.err


def assert_clean(text):
    for marker in MARKERS:
        assert marker not in text, f"{marker!r} leaked"


def app_client(headers=None):
    app = FastAPI()
    app.include_router(router)
    return TestClient(app, headers=headers)


def test_the_markers_really_are_in_the_raw_errors():
    """A control: the fake failures do contain every marker, so a clean result means something was removed."""
    raw = NASTY
    for marker in MARKERS:
        assert marker in raw


@pytest.mark.parametrize("kind", sorted(ERRORS))
def test_a_database_failure_never_shows_the_address_or_other_private_values(
    kind, leaky_environment, monkeypatch, caplog, capsys, private_key
):
    fail_with(monkeypatch, ERRORS[kind])
    jwks = FakeJwks(jwk(private_key, "key-1"))
    jwks.failure = httpx.ConnectError(f"cannot reach {JWKS_URL} ({DOMAIN})")
    auth.use_http_client(jwks.client())
    signed_in = {"Authorization": "Bearer " + token(private_key, iss=ISSUER)}
    responses = []
    for headers in ({}, signed_in, {"Authorization": "Bearer junk"}):
        client = app_client(headers)
        responses += [call(client) for call in DOWN_CALLS.values()]
    assert {r.status_code for r in responses} == {503}
    assert all(r.json() == {"detail": "We could not reach the place where practice history is saved. "
                                      "Please try again in a moment."} for r in responses)
    text = everything_said(responses, caplog, capsys)
    assert "Database call failed" in text and "Could not fetch the login signing keys" in text  # not a vacuous check
    assert_clean(text)


def test_a_working_sign_in_with_a_failing_database_leaks_nothing(
    leaky_environment, monkeypatch, caplog, capsys, private_key
):
    jwks = FakeJwks(jwk(private_key, "key-1"))
    auth.use_http_client(jwks.client())
    fail_with(monkeypatch, ERRORS["refused"])
    client = app_client({"Authorization": "Bearer " + token(private_key, iss=ISSUER)})
    responses = [call(client) for call in DOWN_CALLS.values()]
    assert {r.status_code for r in responses} == {503}
    assert jwks.requests == [JWKS_URL]  # the sign-in itself worked
    assert_clean(everything_said(responses, caplog, capsys))


def test_login_failures_leak_nothing(leaky_environment, caplog, capsys, private_key):
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwks = FakeJwks(jwk(private_key, "key-1"))
    auth.use_http_client(jwks.client())
    repository.set_repository(MemoryRepository())
    client = app_client()
    responses = []
    for bad in (
        "junk", token(private_key, iss="https://elsewhere.invalid/"), token(private_key, iss=ISSUER, lifetime=-3600),
        token(other_key, iss=ISSUER), token(private_key, kid="not-listed", iss=ISSUER),
    ):
        responses.append(client.get("/api/sessions", headers={"Authorization": f"Bearer {bad}"}))
    assert {r.status_code for r in responses} == {200}
    jwks.failure = httpx.ReadTimeout(f"timed out talking to {DOMAIN}")
    auth.use_http_client(jwks.client())
    responses.append(client.get("/api/sessions", headers={"Authorization": "Bearer " + token(private_key, iss=ISSUER)}))

    guarded = FastAPI()

    @guarded.get("/must")
    def must(user: str | None = Depends(auth.required_user)):
        return {"user": user}

    protected = TestClient(guarded)
    for headers in ({}, {"Authorization": "Bearer junk"}, {"Authorization": "Bearer " + token(private_key, iss=ISSUER)}):
        responses.append(protected.get("/must", headers=headers))
    assert [r.status_code for r in responses[-3:]] == [401, 401, 503]
    text = everything_said(responses, caplog, capsys)
    assert "Ignoring a sign-in token" in text  # something was logged
    assert_clean(text)


def test_an_unexpected_bug_with_private_values_in_its_message_leaks_nothing(
    leaky_environment, monkeypatch, caplog, capsys
):
    memory = MemoryRepository()
    repository.set_repository(memory)

    def explode(*args, **kwargs):
        raise RuntimeError(f"unexpected: {NASTY}")

    monkeypatch.setattr(memory, "list_sessions", explode)
    monkeypatch.setattr(memory, "list_creations", explode)
    client = app_client()
    responses = [client.get("/api/sessions"), client.get("/api/creations")]
    assert [r.status_code for r in responses] == [500, 500]
    text = everything_said(responses, caplog, capsys)
    assert "Unexpected RuntimeError" in text
    assert_clean(text)


def test_normal_use_leaks_nothing(leaky_environment, monkeypatch, caplog, capsys):
    monkeypatch.delenv("DATABASE_URL")
    client = app_client()
    session_id = new_session(client)
    responses = [
        client.get("/api/songs"), start(client), make_creation(client), client.get("/api/sessions"),
        client.get("/api/creations"), client.post(f"/api/sessions/{session_id}/end", json={"summary": {"a": 1}}),
        client.post("/api/sessions", json={}), client.post(f"/api/sessions/{session_id}/samples", json=[1]),
    ]
    assert_clean(everything_said(responses, caplog, capsys))


def test_the_commands_print_nothing_private(leaky_environment, monkeypatch, caplog, capsys):
    outputs = []
    for kind in sorted(ERRORS):
        fail_with(monkeypatch, ERRORS[kind])
        for command in ("migrate", "ping"):
            out = io.StringIO()
            assert db.main([command], out=out) == 1
            outputs.append(out.getvalue())
    for command in ("status", "sql"):
        out = io.StringIO()
        assert db.main([command], out=out) == 0
        outputs.append(out.getvalue())
    assert_clean("\n".join(outputs) + caplog.text + capsys.readouterr().out)


def test_the_command_line_prints_nothing_private():
    env = {**os.environ, "DATABASE_URL": DB_URL, "AUTH0_DOMAIN": DOMAIN, "GEMINI_API_KEY": GEMINI}
    for command in ("status", "sql"):
        done = subprocess.run(
            [sys.executable, "-m", "app.db", command],
            check=False, cwd=config.SERVER_ROOT, capture_output=True, text=True, timeout=120, env=env,
        )
        assert done.returncode == 0, done.stderr[-500:]
        assert_clean(done.stdout + done.stderr)
    status = subprocess.run(
        [sys.executable, "-m", "app.db", "status"],
        check=False, cwd=config.SERVER_ROOT, capture_output=True, text=True, timeout=120, env=env,
    )
    assert status.stdout.startswith("repository: postgres")


def test_describe_error_and_redact_remove_every_marker(leaky_environment):
    for make_error in ERRORS.values():
        assert_clean(db.describe_error(make_error()))
    assert_clean(db.redact(NASTY))
