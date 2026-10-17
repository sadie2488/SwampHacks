"""Shared test setup: no test may reach a real database, and each test starts with fresh state."""
import psycopg
import pytest

from . import analyzer, auth, config, repository, store


@pytest.fixture(autouse=True)
def isolated_saving_and_login(monkeypatch, tmp_path):
    # A real server/.env (loaded into the process when app.config is imported) may define any of these, and the tests
    # must give the same answer on every laptop. So clear every setting the server knows; tests set what they need.
    for name in config.ENV_VAR_NAMES:
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


@pytest.fixture
def fake_analysis(monkeypatch):
    """Uploads get the built-in Twinkle analysis instead of the real (slow) one, for tests about saving songs."""
    monkeypatch.setattr(store, "analyze_audio", lambda path: analyzer.load_demo_analysis())
