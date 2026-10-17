"""Where songs, analyses, practice runs, feedback and creations are kept.

`MemoryRepository` is the default when DATABASE_URL is not set: a local demo mode that needs no
database and forgets everything on restart. `PostgresRepository` talks to Postgres (Tiger Data)
with psycopg 3: a new short-lived connection per call and only parameterized SQL.

Rows come back as plain dicts with JSON-friendly values (ids and times are strings).
"""
import copy
import logging
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, Protocol

import psycopg
from psycopg.types.json import Jsonb

from . import config, db, store

log = logging.getLogger("music.server.repository")

Row = dict[str, Any]

MAX_MEMORY_SAMPLES = 200_000
SONG_COLUMNS = ("id", "title", "source", "file_name", "duration_sec", "created_at")
ANALYSIS_COLUMNS = ("id", "song_id", "version", "analysis", "created_at")
SESSION_COLUMNS = ("id", "user_id", "song_id", "started_at", "ended_at", "tempo_ratio", "latency_offset_ms", "summary")
SAMPLE_COLUMNS = ("time", "session_id", "metric", "value", "song_time_sec")
FEEDBACK_COLUMNS = ("id", "session_id", "source", "feedback", "created_at")
CREATION_COLUMNS = ("id", "user_id", "name", "tempo_bpm", "layers", "created_at")


class NotFound(LookupError):
    """A row that something points at (a song or a practice run) does not exist."""


class DatabaseUnavailable(RuntimeError):
    """The database could not be reached or answered with an error. The message is safe to log."""


class Repository(Protocol):
    kind: str

    def upsert_song(
        self, song_id: str, title: str, source: str, file_name: str | None = None, duration_sec: float = 0.0
    ) -> Row: ...

    def get_song(self, song_id: str) -> Row | None: ...

    def list_songs(self, limit: int = 200) -> list[Row]: ...

    def save_analysis(self, song_id: str, version: int, analysis: dict) -> Row: ...

    def get_analysis(self, song_id: str) -> Row | None: ...

    def create_session(
        self, song_id: str, tempo_ratio: float, latency_offset_ms: float | None = None, user_id: str | None = None
    ) -> Row: ...

    def get_session(self, session_id: str) -> Row | None: ...

    def add_samples(self, session_id: str, samples: list[dict]) -> int: ...

    def list_samples(self, session_id: str, limit: int = 5000) -> list[Row]: ...

    def end_session(self, session_id: str, summary: dict | None) -> Row | None: ...

    def list_sessions(
        self, song_id: str | None = None, user_id: str | None = None, anonymous_only: bool = False, limit: int = 50
    ) -> list[Row]: ...

    def add_feedback(self, session_id: str, source: str, feedback: dict) -> Row: ...

    def list_feedback(self, session_id: str) -> list[Row]: ...

    def create_creation(self, name: str, tempo_bpm: float, layers: list, user_id: str | None = None) -> Row: ...

    def list_creations(
        self, user_id: str | None = None, anonymous_only: bool = False, limit: int = 50
    ) -> list[Row]: ...

    def get_creation(self, creation_id: str) -> Row | None: ...


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise NotFound("That id is not valid.") from None


def _owned(row_user: str | None, user_id: str | None, anonymous_only: bool) -> bool:
    if user_id is not None:
        return row_user == user_id
    return row_user is None if anonymous_only else True


class MemoryRepository:
    """Everything in this process's memory. Fine for a demo, gone on restart."""

    kind = "memory"

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._songs: dict[str, Row] = {}
        self._analyses: list[Row] = []
        self._sessions: dict[str, Row] = {}
        self._samples: list[Row] = []
        self._feedback: list[Row] = []
        self._creations: dict[str, Row] = {}

    def upsert_song(self, song_id, title, source, file_name=None, duration_sec=0.0):
        with self._lock:
            created = self._songs[song_id]["created_at"] if song_id in self._songs else _now()
            row = {
                "id": song_id, "title": title, "source": source, "file_name": file_name,
                "duration_sec": float(duration_sec), "created_at": created,
            }
            self._songs[song_id] = row
            return copy.deepcopy(row)

    def get_song(self, song_id):
        with self._lock:
            return copy.deepcopy(self._songs.get(song_id))

    def list_songs(self, limit=200):
        with self._lock:
            rows = list(self._songs.values())[::-1]
            rows.sort(key=lambda r: r["created_at"], reverse=True)  # ties stay newest first
            return copy.deepcopy(rows[:limit])

    def save_analysis(self, song_id, version, analysis):
        with self._lock:
            if song_id not in self._songs:
                raise NotFound("That song is not known yet.")
            self._analyses = [a for a in self._analyses if not (a["song_id"] == song_id and a["version"] == version)]
            row = {
                "id": _new_id(), "song_id": song_id, "version": int(version),
                "analysis": copy.deepcopy(analysis), "created_at": _now(),
            }
            self._analyses.append(row)
            return copy.deepcopy(row)

    def get_analysis(self, song_id):
        with self._lock:
            found = [a for a in self._analyses if a["song_id"] == song_id]
            return copy.deepcopy(max(found, key=lambda a: a["created_at"])) if found else None

    def create_session(self, song_id, tempo_ratio, latency_offset_ms=None, user_id=None):
        with self._lock:
            if song_id not in self._songs:
                raise NotFound("That song is not known yet.")
            row = {
                "id": _new_id(), "user_id": user_id, "song_id": song_id, "started_at": _now(), "ended_at": None,
                "tempo_ratio": float(tempo_ratio),
                "latency_offset_ms": None if latency_offset_ms is None else float(latency_offset_ms),
                "summary": None,
            }
            self._sessions[row["id"]] = row
            return copy.deepcopy(row)

    def get_session(self, session_id):
        with self._lock:
            return copy.deepcopy(self._sessions.get(str(session_id)))

    def add_samples(self, session_id, samples):
        with self._lock:
            if str(session_id) not in self._sessions:
                raise NotFound("That practice run is not known.")
            now = _now()
            self._samples.extend(
                {
                    "time": now, "session_id": str(session_id), "metric": s["metric"], "value": float(s["value"]),
                    "song_time_sec": None if s.get("song_time_sec") is None else float(s["song_time_sec"]),
                }
                for s in samples
            )
            del self._samples[: max(0, len(self._samples) - MAX_MEMORY_SAMPLES)]
            return len(samples)

    def list_samples(self, session_id, limit=5000):
        with self._lock:
            rows = [s for s in self._samples if s["session_id"] == str(session_id)]
            return copy.deepcopy(rows[:limit])

    def end_session(self, session_id, summary):
        with self._lock:
            row = self._sessions.get(str(session_id))
            if row is None:
                return None
            row["ended_at"] = row["ended_at"] or _now()
            row["summary"] = copy.deepcopy(summary)
            return copy.deepcopy(row)

    def list_sessions(self, song_id=None, user_id=None, anonymous_only=False, limit=50):
        with self._lock:
            rows = [
                r for r in list(self._sessions.values())[::-1]
                if (song_id is None or r["song_id"] == song_id) and _owned(r["user_id"], user_id, anonymous_only)
            ]
            rows.sort(key=lambda r: r["started_at"], reverse=True)  # ties stay newest first
            return copy.deepcopy(rows[:limit])

    def add_feedback(self, session_id, source, feedback):
        with self._lock:
            if str(session_id) not in self._sessions:
                raise NotFound("That practice run is not known.")
            row = {
                "id": _new_id(), "session_id": str(session_id), "source": source,
                "feedback": copy.deepcopy(feedback), "created_at": _now(),
            }
            self._feedback.append(row)
            return copy.deepcopy(row)

    def list_feedback(self, session_id):
        with self._lock:
            return copy.deepcopy([f for f in self._feedback if f["session_id"] == str(session_id)])

    def create_creation(self, name, tempo_bpm, layers, user_id=None):
        with self._lock:
            row = {
                "id": _new_id(), "user_id": user_id, "name": name, "tempo_bpm": float(tempo_bpm),
                "layers": copy.deepcopy(layers), "created_at": _now(),
            }
            self._creations[row["id"]] = row
            return copy.deepcopy(row)

    def list_creations(self, user_id=None, anonymous_only=False, limit=50):
        with self._lock:
            rows = [r for r in list(self._creations.values())[::-1] if _owned(r["user_id"], user_id, anonymous_only)]
            rows.sort(key=lambda r: r["created_at"], reverse=True)  # ties stay newest first
            return copy.deepcopy(rows[:limit])

    def get_creation(self, creation_id):
        with self._lock:
            return copy.deepcopy(self._creations.get(str(creation_id)))


def _plain(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _to_row(columns: tuple[str, ...], values: tuple) -> Row:
    return {name: _plain(value) for name, value in zip(columns, values, strict=True)}


def _rows(columns: tuple[str, ...], cursor) -> list[Row]:
    return [_to_row(columns, values) for values in cursor.fetchall()]


def _one(columns: tuple[str, ...], cursor) -> Row | None:
    values = cursor.fetchone()
    return None if values is None else _to_row(columns, values)


def _cols(columns: tuple[str, ...]) -> str:
    return ", ".join(columns)


class PostgresRepository:
    """Postgres with psycopg 3. `connect` can be swapped for a stand-in in tests."""

    kind = "postgres"

    def __init__(self, url: str, connect: Callable[..., Any] | None = None) -> None:
        self._url = url
        self._connect = connect

    def _run(self, work: Callable[[Any], Any]) -> Any:
        """Run `work(connection)` on a fresh connection that commits and closes afterwards.

        Database failures become `DatabaseUnavailable` with a safe message (no address, no password).
        """
        connect = self._connect or psycopg.connect
        try:
            with connect(self._url, connect_timeout=db.CONNECT_TIMEOUT_SEC) as conn:
                return work(conn)
        except psycopg.errors.ForeignKeyViolation:
            raise NotFound("A song or practice run that this refers to does not exist.") from None
        except (psycopg.Error, OSError) as exc:
            message = db.describe_error(exc)
            log.warning("Database call failed: %s", message)
            raise DatabaseUnavailable(message) from None

    def upsert_song(self, song_id, title, source, file_name=None, duration_sec=0.0):
        sql = (
            "INSERT INTO songs (id, title, source, file_name, duration_sec, created_at) "
            "VALUES (%s, %s, %s, %s, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, source = EXCLUDED.source, "
            "file_name = EXCLUDED.file_name, duration_sec = EXCLUDED.duration_sec "
            f"RETURNING {_cols(SONG_COLUMNS)}"
        )
        params = (song_id, title, source, file_name, float(duration_sec))
        return self._run(lambda conn: _one(SONG_COLUMNS, conn.execute(sql, params)))

    def get_song(self, song_id):
        sql = f"SELECT {_cols(SONG_COLUMNS)} FROM songs WHERE id = %s"
        return self._run(lambda conn: _one(SONG_COLUMNS, conn.execute(sql, (song_id,))))

    def list_songs(self, limit=200):
        sql = f"SELECT {_cols(SONG_COLUMNS)} FROM songs ORDER BY created_at DESC LIMIT %s"
        return self._run(lambda conn: _rows(SONG_COLUMNS, conn.execute(sql, (int(limit),))))

    def save_analysis(self, song_id, version, analysis):
        delete = "DELETE FROM analyses WHERE song_id = %s AND version = %s"
        insert = (
            "INSERT INTO analyses (id, song_id, version, analysis, created_at) VALUES (%s, %s, %s, %s, now()) "
            f"RETURNING {_cols(ANALYSIS_COLUMNS)}"
        )

        def work(conn):
            conn.execute(delete, (song_id, int(version)))
            return _one(ANALYSIS_COLUMNS, conn.execute(insert, (uuid.uuid4(), song_id, int(version), Jsonb(analysis))))

        return self._run(work)

    def get_analysis(self, song_id):
        sql = f"SELECT {_cols(ANALYSIS_COLUMNS)} FROM analyses WHERE song_id = %s ORDER BY created_at DESC LIMIT 1"
        return self._run(lambda conn: _one(ANALYSIS_COLUMNS, conn.execute(sql, (song_id,))))

    def create_session(self, song_id, tempo_ratio, latency_offset_ms=None, user_id=None):
        sql = (
            "INSERT INTO practice_sessions (id, user_id, song_id, started_at, tempo_ratio, latency_offset_ms) "
            f"VALUES (%s, %s, %s, now(), %s, %s) RETURNING {_cols(SESSION_COLUMNS)}"
        )
        offset = None if latency_offset_ms is None else float(latency_offset_ms)
        params = (uuid.uuid4(), user_id, song_id, float(tempo_ratio), offset)
        return self._run(lambda conn: _one(SESSION_COLUMNS, conn.execute(sql, params)))

    def get_session(self, session_id):
        try:
            key = _uuid(session_id)
        except NotFound:
            return None
        sql = f"SELECT {_cols(SESSION_COLUMNS)} FROM practice_sessions WHERE id = %s"
        return self._run(lambda conn: _one(SESSION_COLUMNS, conn.execute(sql, (key,))))

    def add_samples(self, session_id, samples):
        key = _uuid(session_id)
        sql = "INSERT INTO practice_samples (time, session_id, metric, value, song_time_sec) VALUES (now(), %s, %s, %s, %s)"
        rows = [
            (
                key, s["metric"], float(s["value"]),
                None if s.get("song_time_sec") is None else float(s["song_time_sec"]),
            )
            for s in samples
        ]

        def work(conn):
            if rows:
                with conn.cursor() as cur:
                    cur.executemany(sql, rows)
            return len(rows)

        return self._run(work)

    def list_samples(self, session_id, limit=5000):
        key = _uuid(session_id)
        sql = (
            f"SELECT {_cols(SAMPLE_COLUMNS)} FROM practice_samples WHERE session_id = %s "
            "ORDER BY time, song_time_sec LIMIT %s"
        )
        return self._run(lambda conn: _rows(SAMPLE_COLUMNS, conn.execute(sql, (key, int(limit)))))

    def end_session(self, session_id, summary):
        try:
            key = _uuid(session_id)
        except NotFound:
            return None
        sql = (
            "UPDATE practice_sessions SET ended_at = COALESCE(ended_at, now()), summary = %s WHERE id = %s "
            f"RETURNING {_cols(SESSION_COLUMNS)}"
        )
        value = None if summary is None else Jsonb(summary)
        return self._run(lambda conn: _one(SESSION_COLUMNS, conn.execute(sql, (value, key))))

    @staticmethod
    def _owner_filter(user_id: str | None, anonymous_only: bool) -> tuple[str, list]:
        if user_id is not None:
            return "user_id = %s", [user_id]
        if anonymous_only:
            return "user_id IS NULL", []
        return "", []

    def list_sessions(self, song_id=None, user_id=None, anonymous_only=False, limit=50):
        clauses: list[str] = []
        params: list[Any] = []
        if song_id is not None:
            clauses.append("song_id = %s")
            params.append(song_id)
        owner_clause, owner_params = self._owner_filter(user_id, anonymous_only)
        if owner_clause:
            clauses.append(owner_clause)
            params += owner_params
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT {_cols(SESSION_COLUMNS)} FROM practice_sessions{where} ORDER BY started_at DESC LIMIT %s"
        params.append(int(limit))
        return self._run(lambda conn: _rows(SESSION_COLUMNS, conn.execute(sql, params)))

    def add_feedback(self, session_id, source, feedback):
        key = _uuid(session_id)
        sql = (
            "INSERT INTO feedback_items (id, session_id, source, feedback, created_at) "
            f"VALUES (%s, %s, %s, %s, now()) RETURNING {_cols(FEEDBACK_COLUMNS)}"
        )
        params = (uuid.uuid4(), key, source, Jsonb(feedback))
        return self._run(lambda conn: _one(FEEDBACK_COLUMNS, conn.execute(sql, params)))

    def list_feedback(self, session_id):
        key = _uuid(session_id)
        sql = f"SELECT {_cols(FEEDBACK_COLUMNS)} FROM feedback_items WHERE session_id = %s ORDER BY created_at"
        return self._run(lambda conn: _rows(FEEDBACK_COLUMNS, conn.execute(sql, (key,))))

    def create_creation(self, name, tempo_bpm, layers, user_id=None):
        sql = (
            "INSERT INTO creations (id, user_id, name, tempo_bpm, layers, created_at) "
            f"VALUES (%s, %s, %s, %s, %s, now()) RETURNING {_cols(CREATION_COLUMNS)}"
        )
        params = (uuid.uuid4(), user_id, name, float(tempo_bpm), Jsonb(layers))
        return self._run(lambda conn: _one(CREATION_COLUMNS, conn.execute(sql, params)))

    def list_creations(self, user_id=None, anonymous_only=False, limit=50):
        owner_clause, params = self._owner_filter(user_id, anonymous_only)
        where = f" WHERE {owner_clause}" if owner_clause else ""
        sql = f"SELECT {_cols(CREATION_COLUMNS)} FROM creations{where} ORDER BY created_at DESC LIMIT %s"
        params.append(int(limit))
        return self._run(lambda conn: _rows(CREATION_COLUMNS, conn.execute(sql, params)))

    def get_creation(self, creation_id):
        try:
            key = _uuid(creation_id)
        except NotFound:
            return None
        sql = f"SELECT {_cols(CREATION_COLUMNS)} FROM creations WHERE id = %s"
        return self._run(lambda conn: _one(CREATION_COLUMNS, conn.execute(sql, (key,))))


# --- which repository the server uses -------------------------------------------------------------

_current: Repository | None = None
_current_lock = threading.Lock()


def get_repository() -> Repository:
    """The shared repository: Postgres when DATABASE_URL is set, otherwise the in-memory demo mode."""
    global _current
    with _current_lock:
        if _current is None:
            url = db.database_url()
            if url:
                _current = PostgresRepository(url)
                log.info("Saving songs and practice history to the database.")
            else:
                _current = MemoryRepository()
                log.info("DATABASE_URL is not set: keeping data in memory only (lost on restart).")
        return _current


def set_repository(repo: Repository | None) -> None:
    """Swap the shared repository (tests), or pass None to choose again from the environment."""
    global _current
    with _current_lock:
        _current = repo


# --- remembering songs ----------------------------------------------------------------------------

def _register(repo: Repository, analysis: dict, source_kind: str | None = None) -> None:
    """Save the song row and its analysis. Lets database errors through."""
    source = analysis.get("source") if isinstance(analysis.get("source"), dict) else {}
    kind = source_kind or (source.get("kind") if source.get("kind") in ("upload", "demo", "fixture") else "upload")
    file_name = source.get("file_name")
    repo.upsert_song(
        str(analysis["song_id"]),
        title=str(analysis.get("title") or "Untitled")[:200],
        source=kind,
        file_name=str(file_name)[:255] if file_name else None,
        duration_sec=float(analysis.get("duration_sec") or 0),
    )
    repo.save_analysis(str(analysis["song_id"]), int(analysis.get("version", 1)), analysis)


def record_analysis(analysis: dict, repo: Repository | None = None) -> bool:
    """Remember a finished song analysis (the song row and the analysis). Never raises.

    This is the hook for the upload flow: call it with the document that `store.save_upload`
    returns. If saving fails the upload still works, and the failure is logged without any secrets.
    """
    try:
        _register(repo or get_repository(), analysis)
        return True
    except Exception as exc:  # noqa: BLE001 - this hook must never break an upload
        log.warning("Could not remember the song analysis: %s", db.describe_error(exc))
        return False


def ensure_song(repo: Repository, song_id: str) -> bool:
    """Make sure the song has a row, adding the demo song or an upload found on disk. False if unknown.

    Database errors are raised, so the caller can answer "temporarily unavailable".
    """
    if repo.get_song(song_id) is not None:
        return True
    analysis = store.get_analysis(song_id)
    if analysis is None:
        return False
    analysis.setdefault("song_id", song_id)
    _register(repo, analysis, "demo" if song_id == config.DEMO_SONG_ID else None)
    return True
