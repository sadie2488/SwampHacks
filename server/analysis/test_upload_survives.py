"""When pitch tracking raises during a real upload, the upload still answers in plain words and the next one works."""
import io

import numpy as np
import psycopg
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from analysis import pitch_pool
from app import analyzer, config, repository
from app.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    # The same isolation as app/conftest.py: no real settings, uploads in a temporary folder, no database.
    for name in config.ENV_VAR_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MUSIC_DATA_DIR", str(tmp_path / "music-data"))

    def blocked(*args, **kwargs):
        raise psycopg.OperationalError("Tests may not open real database connections.")

    monkeypatch.setattr(psycopg, "connect", blocked)
    repository.set_repository(None)
    yield TestClient(app)  # not started as a context manager: no warm-up, no worker processes
    repository.set_repository(None)


def song_wav() -> bytes:
    sr = 22050
    y = np.tile(analyzer._warm_up_audio(np, sr), 2)  # 10 s: a click track at 120 BPM with a tune on top
    buf = io.BytesIO()
    sf.write(buf, y, sr, format="WAV")
    return buf.getvalue()


def upload(client):
    return client.post("/api/songs", files={"file": ("tune.wav", song_wav(), "audio/wav")})


def test_a_pitch_tracking_error_still_answers_and_the_next_upload_works(client, monkeypatch):
    def crash(audio, options):
        raise RuntimeError("compiled code failed")

    real = pitch_pool._pyin
    monkeypatch.setattr(pitch_pool, "_pyin", crash)
    first = upload(client)
    assert first.status_code == 200
    assert first.json()["parts"] == [] and first.json()["warnings"] == [analyzer.WARNING_NO_MELODY]
    assert client.get("/api/health").json() == {"status": "ok"}

    monkeypatch.setattr(pitch_pool, "_pyin", real)  # pitch tracking works again
    second = upload(client)
    assert second.status_code == 200
    assert second.json()["parts"] and second.json()["parts"][0]["notes"]
