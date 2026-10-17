"""Tests for the repositories. The Postgres class is driven through a stand-in connection: no database is touched."""
import uuid
from datetime import UTC, datetime

import psycopg
import pytest
from psycopg.types.json import Jsonb

from . import config, db, repository, store
from .repository import DatabaseUnavailable, MemoryRepository, NotFound, PostgresRepository
from .testing_fakes import FakeDatabase

NOTE = "x'; DROP TABLE songs; --"  # text that must only ever travel as a parameter


# --- memory --------------------------------------------------------------------------------------

@pytest.fixture
def mem():
    repo = MemoryRepository()
    repo.upsert_song("song-1", "First", "upload", "first.wav", 12.5)
    return repo


def test_memory_songs_are_saved_updated_and_listed_newest_first(mem):
    mem.upsert_song("song-2", "Second", "demo")
    created = mem.get_song("song-1")["created_at"]
    again = mem.upsert_song("song-1", "Renamed", "upload", "first.wav", 13.0)
    assert again["title"] == "Renamed" and again["duration_sec"] == 13.0
    assert again["created_at"] == created  # an update keeps the original time
    assert mem.get_song("nope") is None
    assert [s["id"] for s in mem.list_songs()] == ["song-2", "song-1"]
    assert [s["id"] for s in mem.list_songs(limit=1)] == ["song-2"]
    assert set(mem.get_song("song-2")) == set(repository.SONG_COLUMNS)


def test_memory_returns_copies_so_callers_cannot_change_stored_data(mem):
    row = mem.get_song("song-1")
    row["title"] = "changed"
    assert mem.get_song("song-1")["title"] == "First"
    mem.save_analysis("song-1", 1, {"tempo_bpm": 100, "parts": [1]})
    got = mem.get_analysis("song-1")
    got["analysis"]["parts"].append(2)
    assert mem.get_analysis("song-1")["analysis"]["parts"] == [1]


def test_memory_analyses_replace_the_same_version_and_need_a_known_song(mem):
    first = mem.save_analysis("song-1", 1, {"tempo_bpm": 100})
    second = mem.save_analysis("song-1", 1, {"tempo_bpm": 90})
    assert first["id"] != second["id"]
    assert mem.get_analysis("song-1")["analysis"] == {"tempo_bpm": 90}
    assert set(second) == set(repository.ANALYSIS_COLUMNS)
    assert mem.get_analysis("song-2") is None
    with pytest.raises(NotFound):
        mem.save_analysis("unknown", 1, {})


def test_memory_session_lifecycle(mem):
    session = mem.create_session("song-1", 0.8, latency_offset_ms=35, user_id="auth0|alice")
    assert set(session) == set(repository.SESSION_COLUMNS)
    assert session["ended_at"] is None and session["summary"] is None
    assert (session["tempo_ratio"], session["latency_offset_ms"], session["user_id"]) == (0.8, 35.0, "auth0|alice")
    assert uuid.UUID(session["id"])

    added = mem.add_samples(session["id"], [
        {"metric": "played_bpm", "value": 79.5, "song_time_sec": 1.0},
        {"metric": "pitch_cents_off", "value": -12},
    ])
    assert added == 2
    samples = mem.list_samples(session["id"])
    assert [s["metric"] for s in samples] == ["played_bpm", "pitch_cents_off"]
    assert samples[1]["song_time_sec"] is None and set(samples[0]) == set(repository.SAMPLE_COLUMNS)

    ended = mem.end_session(session["id"], {"avg_bpm": 79})
    assert ended["summary"] == {"avg_bpm": 79} and ended["ended_at"]
    first_end = ended["ended_at"]
    assert mem.end_session(session["id"], {"avg_bpm": 80})["ended_at"] == first_end  # ending twice keeps the time
    assert mem.get_session(session["id"])["summary"] == {"avg_bpm": 80}
    assert mem.get_session("missing") is None
    assert mem.end_session("missing", None) is None


def test_memory_refuses_unknown_parents(mem):
    with pytest.raises(NotFound):
        mem.create_session("unknown-song", 1.0)
    with pytest.raises(NotFound):
        mem.add_samples("missing", [{"metric": "m", "value": 1}])
    with pytest.raises(NotFound):
        mem.add_feedback("missing", "rules", {})


def test_memory_lists_sessions_newest_first_by_song_and_user(mem):
    mem.upsert_song("song-2", "Other", "demo")
    ids = [
        mem.create_session("song-1", 1.0, user_id="alice")["id"],
        mem.create_session("song-2", 1.0)["id"],
        mem.create_session("song-1", 1.0)["id"],
        mem.create_session("song-1", 1.0, user_id="bob")["id"],
    ]
    assert [s["id"] for s in mem.list_sessions()] == ids[::-1]
    assert [s["id"] for s in mem.list_sessions(song_id="song-1")] == [ids[3], ids[2], ids[0]]
    assert [s["id"] for s in mem.list_sessions(user_id="alice")] == [ids[0]]
    assert [s["id"] for s in mem.list_sessions(song_id="song-1", user_id="bob")] == [ids[3]]
    assert [s["id"] for s in mem.list_sessions(anonymous_only=True)] == [ids[2], ids[1]]
    assert [s["id"] for s in mem.list_sessions(limit=2)] == [ids[3], ids[2]]
    assert mem.list_sessions(song_id="nothing") == []


def test_memory_feedback(mem):
    session = mem.create_session("song-1", 1.0)
    item = mem.add_feedback(session["id"], "rules", {"summary": "Nice and steady"})
    mem.add_feedback(session["id"], "gemini", {"summary": "More detail"})
    assert set(item) == set(repository.FEEDBACK_COLUMNS) and uuid.UUID(item["id"])
    assert [f["source"] for f in mem.list_feedback(session["id"])] == ["rules", "gemini"]
    assert mem.list_feedback("other") == []


def test_memory_creations(mem):
    layers = [{"id": "l1", "notes": [{"pitch": 60}]}]
    first = mem.create_creation("Tune", 96, layers, user_id="alice")
    second = mem.create_creation("Anonymous tune", 100, [])
    layers[0]["notes"].clear()
    assert mem.get_creation(first["id"])["layers"] == [{"id": "l1", "notes": [{"pitch": 60}]}]
    assert set(first) == set(repository.CREATION_COLUMNS)
    assert [c["id"] for c in mem.list_creations()] == [second["id"], first["id"]]
    assert [c["id"] for c in mem.list_creations(user_id="alice")] == [first["id"]]
    assert [c["id"] for c in mem.list_creations(anonymous_only=True)] == [second["id"]]
    assert mem.get_creation("missing") is None


def test_memory_keeps_a_bounded_number_of_samples(monkeypatch, mem):
    monkeypatch.setattr(repository, "MAX_MEMORY_SAMPLES", 5)
    session = mem.create_session("song-1", 1.0)
    mem.add_samples(session["id"], [{"metric": "m", "value": float(i)} for i in range(8)])
    assert [s["value"] for s in mem.list_samples(session["id"])] == [3.0, 4.0, 5.0, 6.0, 7.0]


# --- which repository is used ----------------------------------------------------------------------

def test_without_a_database_address_the_memory_repository_is_used(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    repo = repository.get_repository()
    assert isinstance(repo, MemoryRepository)
    assert repository.get_repository() is repo  # one shared instance
    assert db.repository_kind() == "memory"


def test_with_a_database_address_the_postgres_repository_is_used(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "  placeholder-address  ")
    repo = repository.get_repository()
    assert isinstance(repo, PostgresRepository) and repo.kind == "postgres"
    assert db.repository_kind() == "postgres"


def test_a_blank_database_address_counts_as_not_set(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "   ")
    assert isinstance(repository.get_repository(), MemoryRepository)


# --- remembering and finding songs -------------------------------------------------------------------

def analysis_doc(song_id="upload-1a2b3c4d", **extra):
    return {
        "version": 1, "song_id": song_id, "title": "Song title", "duration_sec": 33.5, "tempo_bpm": 100,
        "source": {"kind": "upload", "file_name": "song.wav"}, **extra,
    }


def test_record_analysis_saves_the_song_and_its_analysis():
    repo = MemoryRepository()
    assert repository.record_analysis(analysis_doc(), repo) is True
    song = repo.get_song("upload-1a2b3c4d")
    assert (song["title"], song["source"], song["file_name"], song["duration_sec"]) == (
        "Song title", "upload", "song.wav", 33.5)
    assert repo.get_analysis("upload-1a2b3c4d")["analysis"]["tempo_bpm"] == 100


def test_record_analysis_uses_the_shared_repository_by_default():
    assert repository.record_analysis(analysis_doc()) is True
    assert repository.get_repository().get_song("upload-1a2b3c4d") is not None


def test_record_analysis_never_raises(caplog):
    assert repository.record_analysis({"title": "no id"}, MemoryRepository()) is False
    down = PostgresRepository("placeholder-address", connect=FakeDatabase(error=psycopg.OperationalError("down")))
    assert repository.record_analysis(analysis_doc(), down) is False
    assert "Could not remember the song analysis" in caplog.text


def test_record_analysis_fills_gaps_and_ignores_odd_source_kinds():
    repo = MemoryRepository()
    repository.record_analysis({"song_id": "s1", "source": {"kind": "weird"}}, repo)
    song = repo.get_song("s1")
    assert (song["title"], song["source"], song["file_name"], song["duration_sec"]) == ("Untitled", "upload", None, 0.0)


def test_ensure_song_adds_the_demo_song_once():
    repo = MemoryRepository()
    assert repository.ensure_song(repo, config.DEMO_SONG_ID) is True
    song = repo.get_song(config.DEMO_SONG_ID)
    assert song["title"] == "Twinkle, Twinkle, Little Star" and song["duration_sec"] > 0
    assert song["source"] == "demo"
    assert repo.get_analysis(config.DEMO_SONG_ID)["analysis"]["song_id"] == config.DEMO_SONG_ID
    repo.upsert_song(config.DEMO_SONG_ID, "Kept", "demo")
    assert repository.ensure_song(repo, config.DEMO_SONG_ID) is True
    assert repo.get_song(config.DEMO_SONG_ID)["title"] == "Kept"  # already known: left alone


def test_ensure_song_finds_uploads_on_disk_and_refuses_strangers(tmp_path, monkeypatch):
    monkeypatch.setenv("MUSIC_DATA_DIR", str(tmp_path))
    saved = store.save_upload("My Tune.wav", b"not really audio")
    repo = MemoryRepository()
    assert repository.ensure_song(repo, saved["song_id"]) is True
    assert repo.get_song(saved["song_id"])["title"] == "My Tune"
    assert repository.ensure_song(repo, "upload-00000000") is False
    assert repository.ensure_song(repo, "../etc/passwd") is False


def test_ensure_song_lets_database_errors_through():
    down = PostgresRepository("placeholder-address", connect=FakeDatabase(error=psycopg.OperationalError("down")))
    with pytest.raises(DatabaseUnavailable):
        repository.ensure_song(down, config.DEMO_SONG_ID)


# --- postgres: the SQL it sends ---------------------------------------------------------------------------

URL = "placeholder-address"
SESSION_ID = uuid.UUID("11111111-2222-4333-8444-555555555555")
WHEN = datetime(2026, 10, 17, 12, 0, tzinfo=UTC)


def pg(*results, error=None):
    database = FakeDatabase(*results, error=error)
    return PostgresRepository(URL, connect=database), database


def test_postgres_opens_a_new_short_lived_connection_for_every_call():
    repo, database = pg()
    repo.get_song("a")
    repo.get_song("b")
    repo.list_songs()
    assert len(database.connections) == 3
    assert all(c.closed and c.committed for c in database.connections)
    assert all(call == (URL, {"connect_timeout": db.CONNECT_TIMEOUT_SEC}) for call in database.calls)


def test_postgres_uses_psycopg_connect_when_none_is_given(monkeypatch):
    database = FakeDatabase()
    monkeypatch.setattr(psycopg, "connect", database)
    PostgresRepository(URL).get_song("a")
    assert len(database.calls) == 1


def test_postgres_upsert_song_and_reading_rows_back():
    row = ("song-1", "Title", "upload", "a.wav", 12.5, WHEN)
    repo, database = pg([[row]], [[row]], [[row]])
    saved = repo.upsert_song("song-1", "Title", "upload", "a.wav", 12.5)
    assert saved == {
        "id": "song-1", "title": "Title", "source": "upload", "file_name": "a.wav", "duration_sec": 12.5,
        "created_at": WHEN.isoformat(),
    }
    sql, params = database.statements[0]
    assert sql.startswith("INSERT INTO songs") and "ON CONFLICT (id) DO UPDATE" in sql and "RETURNING" in sql
    assert params == ("song-1", "Title", "upload", "a.wav", 12.5)
    assert repo.get_song("song-1")["title"] == "Title"
    assert database.statements[1] == (
        "SELECT id, title, source, file_name, duration_sec, created_at FROM songs WHERE id = %s", ("song-1",)
    )
    assert repo.list_songs(limit=7) == [saved]
    assert "ORDER BY created_at DESC LIMIT %s" in database.statements[2][0] and database.statements[2][1] == (7,)


def test_postgres_returns_none_and_empty_lists_when_nothing_matches():
    repo, _ = pg()
    assert repo.get_song("x") is None
    assert repo.list_songs() == []
    assert repo.get_session(str(SESSION_ID)) is None
    assert repo.get_creation(str(SESSION_ID)) is None
    assert repo.get_analysis("x") is None
    assert repo.end_session(str(SESSION_ID), {}) is None


def test_postgres_malformed_ids_never_reach_the_database():
    repo, database = pg()
    assert repo.get_session("not-a-uuid") is None
    assert repo.get_creation("not-a-uuid") is None
    assert repo.end_session("not-a-uuid", None) is None
    with pytest.raises(NotFound):
        repo.add_samples("not-a-uuid", [])
    with pytest.raises(NotFound):
        repo.add_feedback("not-a-uuid", "rules", {})
    assert database.statements == []


def test_postgres_save_analysis_replaces_the_same_version_in_one_transaction():
    repo, database = pg([[], [(uuid.uuid4(), "song-1", 1, {"tempo_bpm": 100}, WHEN)]])
    saved = repo.save_analysis("song-1", 1, {"tempo_bpm": 100})
    assert len(database.connections) == 1
    delete, insert = database.statements
    assert delete == ("DELETE FROM analyses WHERE song_id = %s AND version = %s", ("song-1", 1))
    assert insert[0].startswith("INSERT INTO analyses")
    _, song_id, version, document = insert[1]
    assert (song_id, version) == ("song-1", 1)
    assert isinstance(document, Jsonb) and document.obj == {"tempo_bpm": 100}
    assert saved["analysis"] == {"tempo_bpm": 100} and isinstance(saved["id"], str)


def test_postgres_create_session_and_row_conversion():
    row = (SESSION_ID, "auth0|alice", "song-1", WHEN, None, 0.8, 35.0, None)
    repo, database = pg([[row]])
    session = repo.create_session("song-1", 0.8, 35, "auth0|alice")
    assert session == {
        "id": str(SESSION_ID), "user_id": "auth0|alice", "song_id": "song-1", "started_at": WHEN.isoformat(),
        "ended_at": None, "tempo_ratio": 0.8, "latency_offset_ms": 35.0, "summary": None,
    }
    sql, params = database.statements[0]
    assert "INSERT INTO practice_sessions" in sql and "now()" in sql
    assert isinstance(params[0], uuid.UUID) and params[1:] == ("auth0|alice", "song-1", 0.8, 35.0)


def test_postgres_add_samples_sends_one_parameterized_row_per_sample():
    repo, database = pg()
    count = repo.add_samples(str(SESSION_ID), [
        {"metric": "played_bpm", "value": 79.5, "song_time_sec": 1.25},
        {"metric": "pitch_cents_off", "value": -12},
    ])
    assert count == 2
    sql, rows = database.statements[0]
    assert sql.startswith("INSERT INTO practice_samples") and sql.count("%s") == 4 and "now()" in sql
    assert rows == [(SESSION_ID, "played_bpm", 79.5, 1.25), (SESSION_ID, "pitch_cents_off", -12.0, None)]


def test_postgres_add_samples_with_nothing_to_add_sends_nothing():
    repo, database = pg()
    assert repo.add_samples(str(SESSION_ID), []) == 0
    assert database.statements == []


def test_postgres_list_samples_orders_by_time():
    sample = (WHEN, SESSION_ID, "played_bpm", 80.0, 1.5)
    repo, database = pg([[sample]])
    assert repo.list_samples(str(SESSION_ID), limit=10) == [{
        "time": WHEN.isoformat(), "session_id": str(SESSION_ID), "metric": "played_bpm", "value": 80.0,
        "song_time_sec": 1.5,
    }]
    sql, params = database.statements[0]
    assert "WHERE session_id = %s ORDER BY time, song_time_sec LIMIT %s" in sql and params == (SESSION_ID, 10)


def test_postgres_end_session_keeps_the_first_end_time_and_stores_the_summary():
    row = (SESSION_ID, None, "song-1", WHEN, WHEN, 1.0, None, {"avg_bpm": 80})
    repo, database = pg([[row]], [[row]])
    ended = repo.end_session(str(SESSION_ID), {"avg_bpm": 80})
    assert ended["summary"] == {"avg_bpm": 80} and ended["ended_at"] == WHEN.isoformat()
    sql, params = database.statements[0]
    assert "ended_at = COALESCE(ended_at, now())" in sql and "WHERE id = %s" in sql
    assert isinstance(params[0], Jsonb) and params[0].obj == {"avg_bpm": 80} and params[1] == SESSION_ID
    repo.end_session(str(SESSION_ID), None)
    assert database.statements[1][1][0] is None


@pytest.mark.parametrize(
    ("kwargs", "where", "params"),
    [
        ({}, "", [50]),
        ({"song_id": "s"}, " WHERE song_id = %s", ["s", 50]),
        ({"user_id": "u"}, " WHERE user_id = %s", ["u", 50]),
        ({"song_id": "s", "user_id": "u", "limit": 5}, " WHERE song_id = %s AND user_id = %s", ["s", "u", 5]),
        ({"anonymous_only": True}, " WHERE user_id IS NULL", [50]),
        ({"user_id": "u", "anonymous_only": True}, " WHERE user_id = %s", ["u", 50]),
    ],
)
def test_postgres_list_sessions_filters_with_parameters_only(kwargs, where, params):
    repo, database = pg()
    repo.list_sessions(**kwargs)
    sql, sent = database.statements[0]
    assert sql.endswith(f"FROM practice_sessions{where} ORDER BY started_at DESC LIMIT %s")
    assert list(sent) == params


def test_postgres_feedback_creations_and_lists():
    feedback_row = (uuid.uuid4(), SESSION_ID, "rules", {"summary": "ok"}, WHEN)
    creation_row = (uuid.uuid4(), "auth0|alice", "Tune", 96.0, [{"id": "l1"}], WHEN)
    repo, database = pg([[feedback_row]], [[feedback_row]], [[creation_row]], [[creation_row]], [[creation_row]])
    item = repo.add_feedback(str(SESSION_ID), "rules", {"summary": "ok"})
    assert item["feedback"] == {"summary": "ok"} and item["session_id"] == str(SESSION_ID)
    assert isinstance(database.statements[0][1][3], Jsonb)
    assert repo.list_feedback(str(SESSION_ID))[0]["source"] == "rules"
    made = repo.create_creation("Tune", 96, [{"id": "l1"}], user_id="auth0|alice")
    assert made["layers"] == [{"id": "l1"}] and made["user_id"] == "auth0|alice"
    assert isinstance(database.statements[2][1][4], Jsonb)
    assert repo.list_creations(user_id="auth0|alice", limit=3)[0]["name"] == "Tune"
    assert database.statements[3][0].endswith("FROM creations WHERE user_id = %s ORDER BY created_at DESC LIMIT %s")
    assert repo.get_creation(creation_row[0])["tempo_bpm"] == 96.0


def test_postgres_list_creations_anonymous_and_unfiltered():
    repo, database = pg()
    repo.list_creations(anonymous_only=True)
    repo.list_creations()
    assert "WHERE user_id IS NULL" in database.statements[0][0]
    assert "WHERE" not in database.statements[1][0]


OPERATIONS = {
    "upsert_song": lambda r: r.upsert_song("song-zz9", NOTE, NOTE, NOTE, 1.0),
    "get_song": lambda r: r.get_song(NOTE),
    "list_songs": lambda r: r.list_songs(),
    "save_analysis": lambda r: r.save_analysis(NOTE, 1, {"note": NOTE}),
    "get_analysis": lambda r: r.get_analysis(NOTE),
    "create_session": lambda r: r.create_session(NOTE, 1.0, 2.0, NOTE),
    "get_session": lambda r: r.get_session(str(SESSION_ID)),
    "add_samples": lambda r: r.add_samples(str(SESSION_ID), [{"metric": NOTE, "value": 1}]),
    "list_samples": lambda r: r.list_samples(str(SESSION_ID)),
    "end_session": lambda r: r.end_session(str(SESSION_ID), {"note": NOTE}),
    "list_sessions": lambda r: r.list_sessions(song_id=NOTE, user_id=NOTE),
    "list_sessions_anonymous": lambda r: r.list_sessions(song_id=NOTE, anonymous_only=True),
    "add_feedback": lambda r: r.add_feedback(str(SESSION_ID), NOTE, {"note": NOTE}),
    "list_feedback": lambda r: r.list_feedback(str(SESSION_ID)),
    "create_creation": lambda r: r.create_creation(NOTE, 90, [{"note": NOTE}], NOTE),
    "list_creations": lambda r: r.list_creations(user_id=NOTE),
    "get_creation": lambda r: r.get_creation(str(SESSION_ID)),
}


@pytest.mark.parametrize("name", sorted(OPERATIONS))
def test_every_postgres_statement_is_parameterized(name):
    """Values never become part of the SQL text: one %s per value, no quote marks, nothing user-supplied inside."""
    repo, database = pg()
    OPERATIONS[name](repo)
    assert database.statements, name
    for sql, params in database.statements:
        rows = params if sql.startswith("INSERT INTO practice_samples") else [params]
        for values in rows:
            assert sql.count("%s") == len(values), sql
            assert NOTE not in sql and "'" not in sql and '"' not in sql, sql
            assert not any(isinstance(v, str) and v and v in sql for v in values), sql


def test_every_repository_method_is_covered_by_the_parameterized_check():
    methods = {n for n in dir(PostgresRepository) if not n.startswith("_") and n != "kind"}
    covered = {n.removesuffix("_anonymous") for n in OPERATIONS}
    assert methods == covered


# --- postgres: failures ---------------------------------------------------------------------------------

def test_a_down_database_becomes_database_unavailable_with_a_safe_message():
    secret_url = "postgresql://" + "leakuser" + ":" + "leakpass" + "@" + "leakhost.invalid" + "/leakdb"
    error = psycopg.OperationalError(f'connection to server at "leakhost.invalid" (10.9.8.7), port 5432 failed: {secret_url}')
    repo = PostgresRepository(secret_url, connect=FakeDatabase(error=error))
    with pytest.raises(DatabaseUnavailable) as caught:
        repo.get_song("x")
    text = str(caught.value)
    for marker in ("leakuser", "leakpass", "leakhost", "leakdb", "10.9.8.7"):
        assert marker not in text
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


def test_a_missing_table_is_reported_as_unavailable_with_a_hint():
    error = psycopg.errors.UndefinedTable('relation "songs" does not exist')
    repo = PostgresRepository(URL, connect=FakeDatabase(error=error))
    with pytest.raises(DatabaseUnavailable) as caught:
        repo.list_songs()
    assert "migrate" in str(caught.value) and "42P01" in str(caught.value)


def test_errors_raised_while_running_a_statement_are_also_wrapped():
    class Exploding:
        def __call__(self, url, **kwargs):
            return self

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, sql, params=None):
            raise psycopg.errors.DataError("bad value")

    with pytest.raises(DatabaseUnavailable):
        PostgresRepository(URL, connect=Exploding()).get_song("x")


def test_a_missing_parent_row_becomes_not_found():
    class Violating(FakeDatabase):
        def __call__(self, url, **kwargs):
            connection = super().__call__(url, **kwargs)

            def execute(sql, params=None):
                raise psycopg.errors.ForeignKeyViolation("key is not present")

            connection.execute = execute
            return connection

    repo = PostgresRepository(URL, connect=Violating())
    with pytest.raises(NotFound):
        repo.create_session("unknown", 1.0)


def test_network_level_errors_are_wrapped_too():
    repo = PostgresRepository(URL, connect=FakeDatabase(error=OSError("socket closed")))
    with pytest.raises(DatabaseUnavailable):
        repo.get_song("x")
