"""The saving endpoints: the song list, practice runs and their measurements, feedback, and creations.

Everything goes through `repository.get_repository()`: a database when DATABASE_URL is set,
otherwise memory. If the database is down these answer 503 `{"detail": "..."}`; bad input gets a
plain-English 422; nothing here returns a stack trace or the database address.
"""
import json
import logging
import re
import traceback
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config
from .analyzer import load_demo_analysis
from .auth import optional_user
from .db import redact
from .repository import (
    DatabaseUnavailable,
    NotFound,
    Repository,
    Row,
    ensure_song,
    get_repository,
)

log = logging.getLogger("music.server.sessions")

MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_SAMPLES_PER_CALL = 500
MAX_SUMMARY_BYTES = 64 * 1024
MAX_FEEDBACK_BYTES = 128 * 1024
MAX_LAYERS_BYTES = 1536 * 1024
MAX_LAYERS = 64
MAX_LIST = 50
BACKFILL_PER_CALL = 25
BACKFILL_SCAN = 100

SOMETHING_WRONG = "Something went wrong on our side while saving that. Please try again."
UNAVAILABLE = "We could not reach the place where practice history is saved. Please try again in a moment."
NO_SONG = "We could not find that song. Upload it again or pick the demo song."
NO_SESSION = "We could not find that practice run. Start a new one and try again."
NO_CREATION = "We could not find that creation."

_UPLOAD_ID = re.compile(r"^upload-[0-9a-f]{8}$")


# --- friendly errors ------------------------------------------------------------------------------

def _num(value: Any) -> str:
    return f"{value:g}" if isinstance(value, (int, float)) else str(value)


def _describe(error: dict) -> str:
    kind, ctx = error["type"], error.get("ctx") or {}
    simple = {
        "missing": "is required",
        "finite_number": "must be a regular number",
        "float_parsing": "must be a number",
        "float_type": "must be a number",
        "int_parsing": "must be a whole number",
        "int_type": "must be a whole number",
        "string_type": "must be text",
        "dict_type": "must be an object",
        "list_type": "must be a list",
        "string_pattern_mismatch": "has characters that are not allowed",
    }
    if kind in simple:
        return simple[kind]
    if kind == "string_too_short":
        return f"needs at least {ctx.get('min_length')} character(s)"
    if kind == "string_too_long":
        return f"is too long (at most {ctx.get('max_length')} characters)"
    if kind == "too_long":
        return f"has too many items (at most {ctx.get('max_length')})"
    if kind == "too_short":
        return f"needs at least {ctx.get('min_length')} item(s)"
    bounds = {
        "greater_than": "must be more than", "greater_than_equal": "must be at least",
        "less_than": "must be less than", "less_than_equal": "must be at most",
    }
    if kind in bounds:
        return f"{bounds[kind]} {_num(next(iter(ctx.values()), ''))}"
    if kind == "literal_error":
        return f"must be {ctx.get('expected')}"
    if kind == "value_error":
        return re.sub(r"^Value error, ", "", error["msg"])
    return error["msg"]


def _friendly_validation(exc: RequestValidationError) -> dict:
    problems = []
    for error in exc.errors():
        if error["type"] == "json_invalid":
            problems.append({"field": "request", "message": "was not valid JSON"})
            continue
        path = [str(part) for part in error["loc"] if part not in ("body", "query", "path")]
        problems.append({"field": ".".join(path) or "request", "message": _describe(error)})
    shown = "; ".join(f"{p['field']} {p['message']}" for p in problems[:3])
    more = f" (and {len(problems) - 3} more)" if len(problems) > 3 else ""
    return {"detail": f"Please check what was sent: {shown}{more}.", "errors": problems}


class FriendlyRoute(APIRoute):
    """Plain-English 422s, a friendly 503 when the database is down, and a cap on request size."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            too_big = JSONResponse(
                status_code=413, content={"detail": "That request is too big. Send less data at a time."}
            )
            declared = request.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
                return too_big
            try:
                if len(await request.body()) > MAX_BODY_BYTES:
                    return too_big
                return await original(request)
            except RequestValidationError as exc:
                return JSONResponse(status_code=422, content=_friendly_validation(exc))
            except DatabaseUnavailable:
                return JSONResponse(status_code=503, content={"detail": UNAVAILABLE})
            except StarletteHTTPException:
                raise
            except Exception as exc:  # noqa: BLE001 - never show a stack trace or a raw message
                where = traceback.extract_tb(exc.__traceback__)[-1]
                log.error(
                    "Unexpected %s at %s:%s: %s", type(exc).__name__, where.filename, where.lineno, redact(str(exc))[:200]
                )
                return JSONResponse(status_code=500, content={"detail": SOMETHING_WRONG})

        return handler


router = APIRouter(prefix="/api", route_class=FriendlyRoute, tags=["saving"])


def repo_dependency() -> Repository:
    return get_repository()


Repo = Annotated[Repository, Depends(repo_dependency)]
User = Annotated[str | None, Depends(optional_user)]


# --- what may be sent -----------------------------------------------------------------------------

def _check_json(value: Any, max_bytes: int, label: str) -> Any:
    try:
        text = json.dumps(value, allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        raise ValueError(f"{label} must be plain JSON (no NaN or infinity)") from None
    if "\\u0000" in text:
        raise ValueError(f"{label} cannot contain the null character")
    if len(text) > max_bytes:
        raise ValueError(f"{label} is too big (at most {max_bytes // 1024} KB)")
    return value


class _Body(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class SessionIn(_Body):
    song_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
    tempo_ratio: float = Field(gt=0, le=4, allow_inf_nan=False)
    latency_offset_ms: float | None = Field(default=None, ge=-5000, le=5000, allow_inf_nan=False)


class SampleIn(_Body):
    metric: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_.:-]{0,63}$")
    value: float = Field(ge=-1e9, le=1e9, allow_inf_nan=False)
    song_time_sec: float | None = Field(default=None, ge=0, le=86400, allow_inf_nan=False)


class SamplesIn(_Body):
    samples: list[SampleIn] = Field(max_length=MAX_SAMPLES_PER_CALL)

    @model_validator(mode="before")
    @classmethod
    def _accept_a_bare_list(cls, data: Any) -> Any:
        return {"samples": data} if isinstance(data, list) else data


class EndIn(_Body):
    summary: dict[str, Any] | None = None

    @model_validator(mode="before")
    @classmethod
    def _accept_the_summary_itself(cls, data: Any) -> Any:
        # Either {"summary": {...}} or the summary object on its own.
        if isinstance(data, dict) and data and not isinstance(data.get("summary", False), dict | None):
            return {"summary": data}
        return data

    @field_validator("summary")
    @classmethod
    def _small_enough(cls, value: dict | None) -> dict | None:
        return None if value is None else _check_json(value, MAX_SUMMARY_BYTES, "The summary")


class FeedbackIn(_Body):
    session_id: str = Field(min_length=1, max_length=64)
    source: Literal["rules", "gemini", "canned"] | None = None
    feedback: dict[str, Any]

    @field_validator("feedback")
    @classmethod
    def _small_enough(cls, value: dict) -> dict:
        return _check_json(value, MAX_FEEDBACK_BYTES, "The feedback")

    @model_validator(mode="after")
    def _find_the_source(self) -> "FeedbackIn":
        if self.source is None:
            inside = self.feedback.get("source")
            if inside not in ("rules", "gemini", "canned"):
                raise ValueError("source must be rules, gemini or canned")
            self.source = inside
        return self


class CreationIn(_Body):
    name: str = Field(min_length=1, max_length=120)
    tempo_bpm: float = Field(gt=0, le=1000, allow_inf_nan=False)
    layers: list[dict[str, Any]] = Field(max_length=MAX_LAYERS)

    @field_validator("name")
    @classmethod
    def _no_control_characters(cls, value: str) -> str:
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            raise ValueError("name cannot contain control characters")
        return value

    @field_validator("layers")
    @classmethod
    def _small_enough(cls, value: list) -> list:
        return _check_json(value, MAX_LAYERS_BYTES, "The layers")


# --- helpers --------------------------------------------------------------------------------------

def _public(row: Row) -> Row:
    """A copy without the owner's id: callers only ever see their own or anonymous rows anyway."""
    return {key: value for key, value in row.items() if key != "user_id"}


def _visible_to(row: Row | None, user: str | None) -> bool:
    return row is not None and (row["user_id"] is None or row["user_id"] == user)


def _session_or_404(repo: Repository, session_id: str, user: str | None) -> Row:
    row = repo.get_session(session_id)
    if not _visible_to(row, user):
        raise HTTPException(404, NO_SESSION)
    return row  # type: ignore[return-value]


def _owner_filter(user: str | None) -> dict[str, Any]:
    return {"user_id": user} if user else {"anonymous_only": True}


def _song_item(row: Row) -> dict:
    return {
        "song_id": row["id"], "title": row["title"], "source": row["source"],
        "file_name": row["file_name"], "duration_sec": row["duration_sec"],
    }


def _demo_item() -> dict:
    demo = load_demo_analysis()
    return {
        "song_id": config.DEMO_SONG_ID, "title": demo.get("title", "Demo song"), "source": "demo",
        "file_name": None, "duration_sec": float(demo.get("duration_sec") or 0),
    }


def _backfill_uploads(repo: Repository, known: set[str]) -> bool:
    """Remember uploads that are on disk but not yet in the repository. True if any were added."""
    try:
        files = sorted(
            (config.data_dir() / "analyses").glob("upload-*.json"), key=lambda p: p.stat().st_mtime, reverse=True
        )[:BACKFILL_SCAN]
    except OSError:
        return False
    added = False
    for song_id in [p.stem for p in files if _UPLOAD_ID.match(p.stem) and p.stem not in known][:BACKFILL_PER_CALL]:
        try:
            added = ensure_song(repo, song_id) or added
        except DatabaseUnavailable:
            break  # the list we already have is still good
        except (OSError, ValueError, KeyError, TypeError):
            log.warning("Skipped a saved upload that could not be read.")
    return added


# --- songs ----------------------------------------------------------------------------------------

@router.get("/songs")
def list_songs(repo: Repo) -> list[dict]:
    """The demo song first, then every upload we know about (newest first)."""
    rows = repo.list_songs()
    if _backfill_uploads(repo, {r["id"] for r in rows}):
        rows = repo.list_songs()
    return [_demo_item(), *(_song_item(r) for r in rows if r["id"] != config.DEMO_SONG_ID)]


# --- practice runs --------------------------------------------------------------------------------

@router.post("/sessions", status_code=201)
def create_session(body: SessionIn, repo: Repo, user: User) -> dict:
    try:
        if not ensure_song(repo, body.song_id):
            raise HTTPException(404, NO_SONG)
        row = repo.create_session(body.song_id, body.tempo_ratio, body.latency_offset_ms, user)
    except NotFound:
        raise HTTPException(404, NO_SONG) from None
    return {"id": row["id"]}


@router.post("/sessions/{session_id}/samples")
def add_samples(session_id: str, body: SamplesIn, repo: Repo, user: User) -> dict:
    _session_or_404(repo, session_id, user)
    try:
        added = repo.add_samples(session_id, [s.model_dump() for s in body.samples])
    except NotFound:
        raise HTTPException(404, NO_SESSION) from None
    return {"added": added}


@router.post("/sessions/{session_id}/end")
def end_session(session_id: str, repo: Repo, user: User, body: EndIn | None = None) -> dict:
    _session_or_404(repo, session_id, user)
    row = repo.end_session(session_id, body.summary if body else None)
    if row is None:
        raise HTTPException(404, NO_SESSION)
    return _public(row)


@router.get("/sessions")
def list_sessions(
    repo: Repo,
    user: User,
    song_id: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIST)] = MAX_LIST,
) -> list[dict]:
    """Newest first, at most 50: your own runs when signed in, otherwise the anonymous ones."""
    return [_public(r) for r in repo.list_sessions(song_id=song_id, limit=limit, **_owner_filter(user))]


# --- feedback -------------------------------------------------------------------------------------

@router.post("/feedback-items", status_code=201)
def add_feedback_item(body: FeedbackIn, repo: Repo, user: User) -> dict:
    _session_or_404(repo, body.session_id, user)
    try:
        row = repo.add_feedback(body.session_id, body.source or "rules", body.feedback)
    except NotFound:
        raise HTTPException(404, NO_SESSION) from None
    return {"id": row["id"]}


# --- creations ------------------------------------------------------------------------------------

def _creation_summary(row: Row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "tempo_bpm": row["tempo_bpm"], "created_at": row["created_at"],
        "layer_count": len(row["layers"]),
    }


@router.get("/creations")
def list_creations(
    repo: Repo, user: User, limit: Annotated[int, Query(ge=1, le=MAX_LIST)] = MAX_LIST
) -> list[dict]:
    """Newest first, without the notes (open one to get them)."""
    return [_creation_summary(r) for r in repo.list_creations(limit=limit, **_owner_filter(user))]


@router.post("/creations", status_code=201)
def create_creation(body: CreationIn, repo: Repo, user: User) -> dict:
    return _creation_summary(repo.create_creation(body.name, body.tempo_bpm, body.layers, user))


@router.get("/creations/{creation_id}")
def get_creation(creation_id: str, repo: Repo, user: User) -> dict:
    row = repo.get_creation(creation_id)
    if not _visible_to(row, user):
        raise HTTPException(404, NO_CREATION)
    return _public(row)  # type: ignore[arg-type]
