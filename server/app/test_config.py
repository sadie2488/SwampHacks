"""Tests for env loading and the public config route. Env files here are made in temp folders; the real
`.env` files are never touched, and the values below are made-up markers, not real keys."""
import json
import os
import re
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from . import config
from .main import app
from .test_api import make_wav

PUBLIC_NAMES = ("AUTH0_DOMAIN", "AUTH0_CLIENT_ID")
SECRET_NAMES = [name for name in config.ENV_VAR_NAMES if name not in PUBLIC_NAMES]
# Not loaded by the server, but must never show up anywhere either.
ALL_PRIVATE_NAMES = SECRET_NAMES + ["VULTR_API_KEY"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Start every test with none of the server's variables set, and restore them afterwards."""
    for name in (*config.ENV_VAR_NAMES, "VULTR_API_KEY"):
        monkeypatch.setenv(name, "placeholder")
        monkeypatch.delenv(name)


def write_env(folder, name, text):
    path = folder / name
    path.write_text(text, encoding="utf-8")
    return path


# --- the names ---------------------------------------------------------------------------------

def test_env_var_names_are_the_agreed_list():
    assert set(config.ENV_VAR_NAMES) == {
        "GEMINI_API_KEY",
        "DATABASE_URL",
        "VULTR_S3_ENDPOINT",
        "VULTR_S3_BUCKET",
        "VULTR_S3_ACCESS_KEY",
        "VULTR_S3_SECRET_KEY",
        "AUTH0_DOMAIN",
        "AUTH0_CLIENT_ID",
        "MUSIC_DATA_DIR",
    }
    assert "VULTR_API_KEY" not in config.ENV_VAR_NAMES


def test_names_match_the_template_file():
    template = (config.REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    template_names = set(re.findall(r"^([A-Z][A-Z0-9_]*)=", template, flags=re.MULTILINE))
    assert set(config.ENV_VAR_NAMES) <= template_names


def test_env_files_are_server_first_then_repo_root():
    assert config.ENV_FILES == (config.SERVER_ROOT / ".env", config.REPO_ROOT / ".env")


# --- loading env files -------------------------------------------------------------------------

def test_loads_values_from_a_file(tmp_path):
    path = write_env(tmp_path, "server.env", "GEMINI_API_KEY=marker-gemini\nAUTH0_DOMAIN=\"marker.example.com\"\n")
    loaded = config.load_env_files([path])
    assert sorted(loaded) == ["AUTH0_DOMAIN", "GEMINI_API_KEY"]
    assert os.environ["GEMINI_API_KEY"] == "marker-gemini"
    assert os.environ["AUTH0_DOMAIN"] == "marker.example.com"


def test_first_file_wins_and_second_fills_gaps(tmp_path):
    server = write_env(tmp_path, "server.env", "GEMINI_API_KEY=from-server\n")
    root = write_env(tmp_path, "root.env", "GEMINI_API_KEY=from-root\nDATABASE_URL=from-root-db\n")
    config.load_env_files([server, root])
    assert os.environ["GEMINI_API_KEY"] == "from-server"
    assert os.environ["DATABASE_URL"] == "from-root-db"


def test_process_environment_always_wins(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "from-process")
    path = write_env(tmp_path, "server.env", "GEMINI_API_KEY=from-file\nDATABASE_URL=from-file-db\n")
    loaded = config.load_env_files([path])
    assert os.environ["GEMINI_API_KEY"] == "from-process"
    assert loaded == ["DATABASE_URL"]


def test_missing_files_are_skipped(tmp_path):
    root = write_env(tmp_path, "root.env", "VULTR_S3_BUCKET=bucket-marker\n")
    assert config.load_env_files([tmp_path / "nope.env", tmp_path / "folder", root]) == ["VULTR_S3_BUCKET"]
    assert config.load_env_files([]) == []


def test_blank_values_do_not_block_the_fallback_file(tmp_path):
    server = write_env(tmp_path, "server.env", "DATABASE_URL=\nGEMINI_API_KEY=   \n")
    root = write_env(tmp_path, "root.env", "DATABASE_URL=from-root-db\n")
    config.load_env_files([server, root])
    assert os.environ["DATABASE_URL"] == "from-root-db"
    assert "GEMINI_API_KEY" not in os.environ


def test_only_known_names_are_loaded_and_the_vultr_account_key_never_is(tmp_path):
    path = write_env(
        tmp_path,
        "server.env",
        "VULTR_API_KEY=account-marker\nSOMETHING_ELSE=other-marker\nPATH=bad\nGEMINI_API_KEY=ok-marker\n",
    )
    original_path = os.environ["PATH"]
    assert config.load_env_files([path]) == ["GEMINI_API_KEY"]
    assert "VULTR_API_KEY" not in os.environ
    assert "SOMETHING_ELSE" not in os.environ
    assert os.environ["PATH"] == original_path


def test_file_saved_with_a_byte_order_mark_still_loads(tmp_path):
    path = tmp_path / "bom.env"
    path.write_bytes(b"\xef\xbb\xbfGEMINI_API_KEY=bom-marker\r\nDATABASE_URL=bom-db\r\n")
    assert sorted(config.load_env_files([path])) == ["DATABASE_URL", "GEMINI_API_KEY"]
    assert os.environ["GEMINI_API_KEY"] == "bom-marker"


def test_values_are_not_expanded_from_other_variables(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "other-marker")
    path = write_env(tmp_path, "server.env", "DATABASE_URL=prefix-${GEMINI_API_KEY}\n")
    config.load_env_files([path])
    assert os.environ["DATABASE_URL"] == "prefix-${GEMINI_API_KEY}"


def test_loader_returns_names_not_values(tmp_path):
    path = write_env(tmp_path, "server.env", "GEMINI_API_KEY=value-marker\n")
    assert "value-marker" not in repr(config.load_env_files([path]))


# --- GET /api/config ---------------------------------------------------------------------------

@pytest.fixture
def client():
    return TestClient(app)


def test_config_is_null_when_nothing_is_set(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    assert r.json() == {"auth0": {"domain": None, "client_id": None}}


def test_config_returns_the_two_public_values(client, monkeypatch):
    monkeypatch.setenv("AUTH0_DOMAIN", "tenant.example.auth0.com")
    monkeypatch.setenv("AUTH0_CLIENT_ID", "client-marker")
    r = client.get("/api/config")
    assert r.json() == {"auth0": {"domain": "tenant.example.auth0.com", "client_id": "client-marker"}}


def test_config_treats_blank_values_as_missing(client, monkeypatch):
    monkeypatch.setenv("AUTH0_DOMAIN", "")
    monkeypatch.setenv("AUTH0_CLIENT_ID", "   ")
    assert client.get("/api/config").json() == {"auth0": {"domain": None, "client_id": None}}


def test_config_picks_up_values_loaded_from_an_env_file(client, tmp_path):
    path = write_env(tmp_path, "server.env", "AUTH0_DOMAIN=file.example.com\nAUTH0_CLIENT_ID=file-client\n")
    config.load_env_files([path])
    assert client.get("/api/config").json() == {"auth0": {"domain": "file.example.com", "client_id": "file-client"}}


def test_config_never_returns_a_secret(client, monkeypatch):
    public = {"AUTH0_DOMAIN": "tenant.example.auth0.com", "AUTH0_CLIENT_ID": "client-marker"}
    secrets = {name: f"secret-{name.lower()}-4f9c21" for name in ALL_PRIVATE_NAMES}
    for name, value in {**public, **secrets}.items():
        monkeypatch.setenv(name, value)
    r = client.get("/api/config")
    assert r.json() == {"auth0": {"domain": public["AUTH0_DOMAIN"], "client_id": public["AUTH0_CLIENT_ID"]}}
    everything = r.text + str(dict(r.headers))
    for name, value in secrets.items():
        assert value not in everything, name


# --- safety: nothing leaks from any route, from importing, or from the logs ---------------------

def _leak_forms(value):
    return {value, json.dumps(value)[1:-1]}


def test_importing_the_app_and_calling_every_route_never_leaks_a_value(tmp_path, monkeypatch, capsys, caplog):
    public = {"AUTH0_DOMAIN": "tenant-marker.example.auth0.com", "AUTH0_CLIENT_ID": "client-marker-77"}
    secrets = {name: f"secret-{name.lower()}-4f9c21" for name in ALL_PRIVATE_NAMES}
    secrets["MUSIC_DATA_DIR"] = str(tmp_path / "private-data-4f9c21")
    for name, value in {**public, **secrets}.items():
        monkeypatch.setenv(name, value)

    def leaks(text):
        return [name for name, value in secrets.items() if any(form in text for form in _leak_forms(value))]

    # Importing the app in a fresh process prints nothing that contains a value.
    imported = subprocess.run(
        [sys.executable, "-c", "import app.main"],
        check=False, cwd=config.SERVER_ROOT, capture_output=True, text=True, timeout=120,
    )
    assert imported.returncode == 0, imported.stderr[-500:]
    assert imported.stdout == ""
    assert leaks(imported.stdout + imported.stderr) == []

    client = TestClient(app)
    wav = make_wav()

    def upload(name, data, content_type):
        return client.post("/api/songs", files={"file": (name, data, content_type)})

    # Every route (including the built-in docs pages), with success and failure cases.
    calls = [
        ("/api/health", client.get("/api/health")),
        ("/api/health", client.get("/api/health", headers={"Origin": config.CORS_ORIGINS[0]})),
        ("/api/config", client.get("/api/config")),
        ("/api/demo-songs", client.get("/api/demo-songs")),
        ("/api/songs/{song_id}/analysis", client.get("/api/songs/demo-twinkle/analysis")),
        ("/api/songs/{song_id}/analysis", client.get("/api/songs/upload-00000000/analysis")),
        ("/api/songs", upload("hello.wav", wav, "audio/wav")),
        ("/api/songs", upload("notes.txt", b"hello", "text/plain")),
        ("/api/songs", upload("silence.wav", b"", "audio/wav")),
        ("/api/songs", client.post("/api/songs")),
        ("/openapi.json", client.get("/openapi.json")),
        ("/docs", client.get("/docs")),
        ("/docs/oauth2-redirect", client.get("/docs/oauth2-redirect")),
        ("/redoc", client.get("/redoc")),
        # The saving routes. DATABASE_URL is set to a made-up value here, so psycopg.connect is blocked by
        # conftest.py and these answer 503 (or 422 for bad input): nothing may leak either way.
        ("/api/songs", client.get("/api/songs")),
        ("/api/sessions", client.post("/api/sessions", json={"song_id": "demo-twinkle", "tempo_ratio": 1})),
        ("/api/sessions", client.get("/api/sessions")),
        ("/api/sessions", client.post("/api/sessions", json={})),
        ("/api/sessions/{session_id}/samples", client.post("/api/sessions/s1/samples", json=[])),
        ("/api/sessions/{session_id}/end", client.post("/api/sessions/s1/end", json={})),
        ("/api/feedback-items", client.post("/api/feedback-items", json={})),
        ("/api/creations", client.get("/api/creations")),
        ("/api/creations", client.post("/api/creations", json={"name": "n", "tempo_bpm": 90, "layers": []})),
        ("/api/creations/{creation_id}", client.get("/api/creations/c1")),
    ]
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 10)
    calls.append(("/api/songs", upload("big.wav", wav, "audio/wav")))
    assert calls[-1][1].status_code == 413

    # Every OTHER route (added later by any lane) is called here automatically with empty input, so no route can
    # skip this check and nobody has to remember to edit this test. Path parameters are filled with a dummy value.
    explicit = {path for path, _ in calls}
    for path, methods in app.openapi()["paths"].items():
        if path in explicit:
            continue
        for method in methods:
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            url = re.sub(r"\{[^}]+\}", "x", path)
            body = {} if method in {"post", "put", "patch"} else None
            calls.append((path, client.request(method.upper(), url, json=body)))
    assert set(app.openapi()["paths"]) <= {path for path, _ in calls}

    for path, response in calls:
        text = response.text + str(dict(response.headers))
        assert leaks(text) == [], path
        if path != "/api/config":
            assert not any(value in text for value in public.values()), path

    config_response = next(r for path, r in calls if path == "/api/config")
    assert config_response.json() == {
        "auth0": {"domain": public["AUTH0_DOMAIN"], "client_id": public["AUTH0_CLIENT_ID"]}
    }

    printed = capsys.readouterr()
    assert leaks(printed.out + printed.err + caplog.text) == []
