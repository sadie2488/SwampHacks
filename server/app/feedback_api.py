"""POST /api/feedback/coach: add friendly coaching text to rule-based practice feedback."""
import json
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError

from feedback.facts import build_facts
from feedback.models import MAX_BODY_BYTES, CoachRequest
from feedback.service import CoachService

from . import config  # noqa: F401  (loads server/.env so GEMINI_API_KEY is in the environment)

router = APIRouter(prefix="/api/feedback")

_service: CoachService | None = None


def get_service() -> CoachService:
    global _service
    if _service is None:
        _service = CoachService()
    return _service


def _bad_input(reason: str) -> HTTPException:
    return HTTPException(422, f"We could not read those practice results: {reason}")


def _describe(error: ValidationError) -> str:
    """One plain sentence about the first problem. Never repeats the value that was sent."""
    first = error.errors()[0]
    where = " > ".join(str(part) for part in first["loc"] if part != "body") or "the request"
    kind = first["type"]
    if kind == "missing":
        why = "is missing"
    elif kind.endswith("too_long"):
        why = "is too long or has too many items"
    elif kind.startswith(("greater_than", "less_than")):
        why = "is out of range"
    elif kind == "value_error":
        why = "cannot be used for coaching (only the quick rule-based feedback can)"
    else:
        why = "is not in the expected form"
    return f"{where} {why}."


async def _read_json(request: Request) -> object:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise _bad_input(f"the request is too big (the limit is {MAX_BODY_BYTES // 1024} KB).")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BODY_BYTES:
            raise _bad_input(f"the request is too big (the limit is {MAX_BODY_BYTES // 1024} KB).")
    try:
        return json.loads(body)
    except (ValueError, RecursionError):  # bad text, bad JSON, or JSON nested absurdly deep
        raise _bad_input("the request was not valid JSON.") from None


@router.post("/coach")
async def coach(request: Request, service: Annotated[CoachService, Depends(get_service)]) -> dict:
    data = await _read_json(request)
    try:
        parsed = CoachRequest.model_validate(data)
    except ValidationError as error:
        raise _bad_input(_describe(error)) from None
    document = parsed.feedback.model_dump(mode="json", exclude_none=True)
    result = await service.coach(build_facts(document, parsed.level))
    document.update(
        coaching=result.text,
        pending=False,
        source=result.source,
        generated_at=datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
    )
    return document
