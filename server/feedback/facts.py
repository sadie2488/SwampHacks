"""Reduce a feedback document to the plain facts that coaching is written from.

Only these facts ever reach Gemini or the canned builder; ids and timestamps are left out so the same
practice run always produces the same facts (which is what the cache relies on).
"""
import hashlib
import json

TEXT_KEYS = ("summary", "next_step")
TEMPO_KEYS = ("target_bpm", "played_bpm", "ratio", "verdict")
ISSUE_KEYS = ("kind", "severity", "bars", "start_sec", "end_sec", "message")


def build_facts(feedback: dict, level: str) -> dict:
    facts: dict = {"level": level}
    for key in TEXT_KEYS:
        if feedback.get(key):
            facts[key] = feedback[key]
    tempo = feedback.get("tempo")
    if isinstance(tempo, dict):
        facts["tempo"] = {k: tempo[k] for k in TEMPO_KEYS if k in tempo}
    issues = [i for i in feedback.get("issues") or [] if isinstance(i, dict)]
    if issues:
        facts["issues"] = [{k: i[k] for k in ISSUE_KEYS if k in i} for i in issues]
    if feedback.get("strengths"):
        facts["strengths"] = list(feedback["strengths"])
    return facts


def facts_json(facts: dict) -> str:
    """The facts as one JSON string that cannot contain a real `<` or `>`.

    The characters are written as JSON escapes (they decode to the same text), so text inside the facts
    can never close the data tags the prompt puts around them.
    """
    text = json.dumps(facts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def cache_key(facts: dict) -> str:
    return hashlib.sha256(json.dumps(facts, sort_keys=True).encode("utf-8")).hexdigest()
