"""The shape of the request body for coaching, checked before anything is sent anywhere.

This mirrors `contracts/feedback.schema.json` (the tests check real responses against the contract
itself) and adds size caps. Unknown fields are kept so a future additive contract change is not lost.
"""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_BODY_BYTES = 20 * 1024
MAX_ISSUES = 10
MAX_STRENGTHS = 10

# Numbers that cannot be NaN or infinite, with generous but finite ceilings.
Seconds = Annotated[float, Field(ge=0, le=86_400, allow_inf_nan=False)]


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="allow")


class Tempo(_Strict):
    target_bpm: Annotated[float, Field(gt=0, le=1000, allow_inf_nan=False)]
    played_bpm: Annotated[float, Field(ge=0, le=2000, allow_inf_nan=False)]
    ratio: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] | None = None
    verdict: Literal["rushing", "dragging", "steady"]


class Issue(_Strict):
    kind: Literal["tempo", "pitch", "rhythm", "missed", "extra"]
    start_sec: Seconds | None = None
    end_sec: Seconds | None = None
    bars: Annotated[list[Annotated[int, Field(ge=1, le=100_000)]], Field(min_length=2, max_length=2)] | None = None
    severity: Literal["low", "medium", "high"] | None = None
    message: Annotated[str, Field(max_length=300)]


class Feedback(_Strict):
    version: Literal[1]
    session_id: Annotated[str, Field(max_length=100)] | None = None
    song_id: Annotated[str, Field(max_length=200)]
    generated_at: Annotated[str, Field(max_length=40)] | None = None
    source: Literal["rules", "gemini", "canned"]
    pending: bool | None = None
    summary: Annotated[str, Field(max_length=600)]
    tempo: Tempo | None = None
    issues: Annotated[list[Issue], Field(max_length=MAX_ISSUES)] | None = None
    strengths: Annotated[list[Annotated[str, Field(max_length=200)]], Field(max_length=MAX_STRENGTHS)] | None = None
    next_step: Annotated[str, Field(max_length=300)] | None = None
    coaching: Annotated[str, Field(max_length=1200)] | None = None

    @field_validator("source")
    @classmethod
    def _only_rules(cls, value: str) -> str:
        if value != "rules":
            raise ValueError("coaching can only be added to the quick rule-based feedback")
        return value


class CoachRequest(_Strict):
    feedback: Feedback
    level: Literal["beginner", "advanced"] = "beginner"
