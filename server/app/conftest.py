"""Shared test setup: no test may reach a real database, and each test starts with fresh state."""
import psycopg
import pytest

from . import auth, repository


@pytest.fixture(autouse=True)
def isolated_saving_and_login(monkeypatch, tmp_path):
    # A real server/.env may define these. Tests set what they need themselves.
    for name in ("DATABASE_URL", "AUTH_ENABLED", "AUTH0_AUDIENCE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MUSIC_DATA_DIR", str(tmp_path / "music-data"))  # never look at real uploads

    def blocked(*args, **kwargs):
        raise psycopg.OperationalError("Tests may not open real database connections.")

    monkeypatch.setattr(psycopg, "connect", blocked)
    repository.set_repository(None)
    auth.use_http_client(None)
    yield
    repository.set_repository(None)
    auth.use_http_client(None)
