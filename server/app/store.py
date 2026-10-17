"""Finding and saving songs: the built-in demo and uploaded files (kept on disk, so they survive restarts)."""
import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

from . import config
from .analyzer import analyze_audio, load_demo_analysis

_UPLOAD_ID = re.compile(r"^upload-[0-9a-f]{8}$")


def demo_songs() -> list[dict]:
    demo = load_demo_analysis()
    return [{"song_id": config.DEMO_SONG_ID, "title": demo.get("title", "Demo song")}]


def _analysis_path(song_id: str) -> Path:
    return config.data_dir() / "analyses" / f"{song_id}.json"


def get_analysis(song_id: str) -> dict | None:
    """The analysis for a demo or uploaded song id, or None if we don't know it."""
    if song_id == config.DEMO_SONG_ID:
        return load_demo_analysis()
    if not _UPLOAD_ID.match(song_id):  # also keeps odd ids from reaching the file system
        return None
    path = _analysis_path(song_id)
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _new_song_id() -> str:
    while True:
        song_id = "upload-" + uuid.uuid4().hex[:8]
        if not _analysis_path(song_id).exists():
            return song_id


def save_upload(file_name: str, data: bytes) -> dict:
    """Save the uploaded bytes, analyze them, save and return the analysis."""
    song_id = _new_song_id()
    extension = re.sub(r"[^a-z0-9.]", "", Path(file_name).suffix.lower())[:8]
    upload_path = config.data_dir() / "uploads" / f"{song_id}{extension}"
    upload_path.parent.mkdir(parents=True, exist_ok=True)
    upload_path.write_bytes(data)

    try:
        analysis = analyze_audio(upload_path)
    except Exception:
        upload_path.unlink(missing_ok=True)
        raise

    analysis["song_id"] = song_id
    analysis["title"] = Path(file_name).stem or "Untitled"
    analysis["source"] = {"kind": "upload", "file_name": file_name}
    analysis["analyzed_at"] = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")

    analysis_path = _analysis_path(song_id)
    analysis_path.parent.mkdir(parents=True, exist_ok=True)
    analysis_path.write_text(json.dumps(analysis, indent=2), encoding="utf-8")
    return analysis
