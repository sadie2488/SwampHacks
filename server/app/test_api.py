"""Development tests for the server API. Audio is generated here; nothing is committed."""
import io
import json
import math
import struct
import wave
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from . import config
from .main import app


def _validator() -> Draft202012Validator:
    registry = Registry()
    for path in sorted(config.CONTRACTS_DIR.glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    song_schema = json.loads((config.CONTRACTS_DIR / "song-analysis.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(song_schema, registry=registry)


VALIDATOR = _validator()


def assert_valid_analysis(doc: dict) -> None:
    errors = [e.message for e in VALIDATOR.iter_errors(doc)]
    assert errors == []
    if "analyzed_at" in doc:
        datetime.fromisoformat(doc["analyzed_at"])


def make_wav(seconds: float = 0.2, rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = (int(12000 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(int(seconds * rate)))
        w.writeframes(b"".join(struct.pack("<h", f) for f in frames))
    return buf.getvalue()


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("MUSIC_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client(data_dir, fake_analysis):  # the real analysis has its own tests in test_analysis_pipeline.py
    return TestClient(app)


def upload(client, name="my song.wav", data=None, content_type="audio/wav"):
    data = make_wav() if data is None else data
    return client.post("/api/songs", files={"file": (name, data, content_type)})


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_demo_songs(client):
    r = client.get("/api/demo-songs")
    assert r.status_code == 200
    assert r.json() == [{"song_id": "demo-twinkle", "title": "Twinkle, Twinkle, Little Star"}]


def test_demo_analysis_matches_schema(client):
    r = client.get("/api/songs/demo-twinkle/analysis")
    assert r.status_code == 200
    doc = r.json()
    assert_valid_analysis(doc)
    assert doc["song_id"] == "demo-twinkle"
    assert doc["source"]["kind"] == "demo"


def test_upload_returns_valid_analysis_and_saves_files(client, data_dir):
    r = upload(client, "my song.wav")
    assert r.status_code == 200
    doc = r.json()
    assert_valid_analysis(doc)
    assert doc["song_id"].startswith("upload-")
    assert len(doc["song_id"]) == len("upload-") + 8
    assert doc["song_id"] != "demo-twinkle"
    assert doc["title"] == "my song"
    assert doc["source"] == {"kind": "upload", "file_name": "my song.wav"}
    assert doc["parts"], "the fake analysis keeps the Twinkle notes"

    saved_audio = list((data_dir / "uploads").glob(doc["song_id"] + ".wav"))
    assert len(saved_audio) == 1
    assert saved_audio[0].read_bytes() == make_wav()
    assert json.loads((data_dir / "analyses" / f"{doc['song_id']}.json").read_text(encoding="utf-8")) == doc


def test_uploaded_song_can_be_fetched_again(client):
    doc = upload(client).json()
    again = TestClient(app).get(f"/api/songs/{doc['song_id']}/analysis")
    assert again.status_code == 200
    assert again.json() == doc
    assert_valid_analysis(again.json())


def test_each_upload_gets_its_own_id(client):
    first = upload(client).json()["song_id"]
    second = upload(client).json()["song_id"]
    assert first != second


def test_unknown_song_is_404(client):
    for song_id in ["nope", "upload-00000000", "upload-zzzzzzzz", "..%2F..%2Fpyproject"]:
        r = client.get(f"/api/songs/{song_id}/analysis")
        assert r.status_code == 404, song_id
        assert isinstance(r.json()["detail"], str)


def test_text_file_is_rejected_with_415(client, data_dir):
    r = upload(client, "notes.txt", b"hello", "text/plain")
    assert r.status_code == 415
    assert isinstance(r.json()["detail"], str)
    assert not (data_dir / "uploads").exists()


def test_audio_extension_is_accepted_even_without_audio_content_type(client):
    r = upload(client, "clip.m4a", make_wav(), "application/octet-stream")
    assert r.status_code == 200
    assert r.json()["title"] == "clip"


def test_empty_file_is_400(client):
    r = upload(client, "silence.wav", b"")
    assert r.status_code == 400
    assert isinstance(r.json()["detail"], str)


def test_missing_file_is_400(client):
    r = client.post("/api/songs")
    assert r.status_code == 400
    assert isinstance(r.json()["detail"], str)


def test_too_big_is_413(client, monkeypatch, data_dir):
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 1000)
    r = upload(client, "big.wav", b"x" * 1001)
    assert r.status_code == 413
    assert isinstance(r.json()["detail"], str)
    assert not (data_dir / "uploads").exists()


def test_windows_path_in_file_name_is_cut_down_to_the_name(client):
    doc = upload(client, r"C:\Users\me\Music\hello.mp3", make_wav(), "audio/mpeg").json()
    assert doc["source"]["file_name"] == "hello.mp3"
    assert doc["title"] == "hello"


def test_cors_allows_the_web_app(client):
    for origin in config.CORS_ORIGINS:
        r = client.get("/api/health", headers={"Origin": origin})
        assert r.headers["access-control-allow-origin"] == origin
    r = client.get("/api/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers
