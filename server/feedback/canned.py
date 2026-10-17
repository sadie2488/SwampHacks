"""Coaching written without any AI: one to three kind sentences built from the same facts.

Used whenever Gemini is not available (no key, slow, blocked, broken, or over the call limit).
`canned_coaching` never raises; if anything is odd it returns a safe, generic message.
"""

GENERIC = "Good effort on that run-through. Play it once more, a little slower, and listen to the beat."

# What to try next when the facts do not include their own next step.
DEFAULT_STEPS = {
    "dragging": "Play along with a metronome and count out loud to keep the beat moving.",
    "rushing": "Slow the song down a bit and play with a metronome to keep the beat even.",
    "steady": "When it feels easy, nudge the speed up by a few beats per minute.",
    "missed": "Loop that spot at a slower speed until every note is there, then join it back in.",
    "pitch": "Play that spot slowly and listen closely to each note before speeding up.",
    "rhythm": "Clap or tap the rhythm first, then play it slowly with a metronome.",
    "extra": "Play that spot slowly and check each note before you move on.",
    "tempo": "Play along with a metronome and count out loud to keep the beat even.",
    "other": "Play it once more, a little slower, and listen to the beat.",
}

SEVERITY_RANK = {"high": 3, "medium": 2, "low": 1}


def canned_coaching(facts: dict) -> str:
    try:
        return _build(facts)
    except Exception:  # noqa: BLE001  (this must never raise, whatever the facts look like)
        return GENERIC


def _sentence(text: str) -> str:
    text = " ".join(str(text).split()).strip()
    return text if not text or text[-1] in ".!?" else text + "."


def _lower_first(text: str) -> str:
    """Make 'Every note was right' read well after 'Nice work:' (but leave 'BPM'-style words alone)."""
    if len(text) > 1 and text[0].isupper() and text[1].islower():
        return text[0].lower() + text[1:]
    return text


def _where(issue: dict | None) -> str:
    bars = (issue or {}).get("bars")
    if isinstance(bars, list) and len(bars) == 2:
        first, last = bars
        return f" in bar {first}" if first == last else f" in bars {first} to {last}"
    return ""


def _top_issue(issues: list[dict], kind: str | None = None) -> dict | None:
    pool = [i for i in issues if kind is None or i.get("kind") == kind]
    # max() keeps the first of equal ratings, so the earliest issue wins a tie
    return max(pool, key=lambda i: SEVERITY_RANK.get(i.get("severity"), 0), default=None)


def _tempo_sentence(tempo: dict, advanced: bool, where: str) -> str:
    verdict = tempo.get("verdict")
    target, played = tempo.get("target_bpm"), tempo.get("played_bpm")
    numbers = ""
    if advanced and isinstance(target, (int, float)) and isinstance(played, (int, float)) and target > 0:
        numbers = f" (about {round(played)} BPM against a target of {round(target)})"
    if verdict == "dragging":
        return f"You were a little behind the beat{where}, which is very common{numbers}."
    if verdict == "rushing":
        return f"You got a little ahead of the beat{where}, which is very common when you feel excited{numbers}."
    return f"Your tempo stayed steady{where}{numbers}."


def _issue_sentence(kind: str, count: int, where: str) -> str:
    one = count == 1
    if kind == "missed":
        return f"One spot{where} had a missed note." if one else f"A few spots{where} had missed notes."
    if kind == "pitch":
        return f"One note{where} was a little off pitch." if one else f"A few notes{where} were a little off pitch."
    if kind == "rhythm":
        return f"The rhythm{where} was a bit uneven."
    if kind == "extra":
        return f"An extra note slipped in{where}." if one else f"A few extra notes slipped in{where}."
    return f"Your timing wandered a little{where}."


def _build(facts: dict) -> str:
    advanced = facts.get("level") == "advanced"
    tempo = facts.get("tempo") if isinstance(facts.get("tempo"), dict) else {}
    issues = [i for i in facts.get("issues") or [] if isinstance(i, dict)]
    strengths = [s.strip() for s in facts.get("strengths") or [] if isinstance(s, str) and s.strip()]
    next_step = facts.get("next_step") if isinstance(facts.get("next_step"), str) else ""
    verdict = tempo.get("verdict")

    # Choose the one thing to talk about: a tempo problem first, then the worst other issue.
    if verdict in ("dragging", "rushing"):
        focus = verdict
        focus_text = _tempo_sentence(tempo, advanced, _where(_top_issue(issues, "tempo")))
    elif issues:
        top = _top_issue(issues)
        kind = top.get("kind") if top else "other"
        focus = kind if kind in DEFAULT_STEPS else "other"
        count = sum(1 for i in issues if i.get("kind") == kind)
        focus_text = _issue_sentence(kind, count, _where(top))
    elif verdict == "steady":
        focus = "steady"
        focus_text = _tempo_sentence(tempo, advanced, "")
    else:
        return GENERIC

    if strengths:
        opener = _sentence(f"Nice work: {_lower_first(strengths[0].rstrip('.!? '))}")
    else:
        opener = "Good effort on that run-through."
    step = _sentence(next_step) or DEFAULT_STEPS.get(focus, DEFAULT_STEPS["other"])
    return f"{opener} {focus_text} {step}"
