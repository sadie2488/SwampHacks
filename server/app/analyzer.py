"""Audio analysis. This is the fake version: it returns the Twinkle analysis for any file.

The real analysis (lane A) replaces `analyze_audio` and keeps the same signature. The caller
fills in `song_id`, `title`, `source` and `analyzed_at`, so the function only has to return
the musical content (tempo, beats, key, time signature, sections, parts).
"""
import json
from pathlib import Path

from . import config


def load_demo_analysis() -> dict:
    """The built-in Twinkle analysis, straight from the shared fixtures (a fresh copy each call)."""
    return json.loads(config.DEMO_ANALYSIS_FILE.read_text(encoding="utf-8"))


def analyze_audio(path: Path) -> dict:
    """Analyze the audio file at `path` and return a song-analysis dict. Fake for now."""
    return load_demo_analysis()
