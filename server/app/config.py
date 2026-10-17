"""Server settings: where things live on disk and which environment variables the server will use.

If a private `.env` file exists in the repo root it is loaded (values already set in the
environment win). Nothing here reads or prints the values.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_ROOT = REPO_ROOT / "server"
FIXTURES_DIR = REPO_ROOT / "fixtures"
CONTRACTS_DIR = REPO_ROOT / "contracts"

_env_file = REPO_ROOT / ".env"
if _env_file.is_file():
    load_dotenv(_env_file)

# Names only. Nothing depends on these yet; later lanes read them with os.environ.get(NAME).
ENV_VAR_NAMES = (
    "MUSIC_DATA_DIR",  # where uploads and analyses are saved (default: server/data)
    "GEMINI_API_KEY",  # coaching text
    "TIGER_DATA_URL",  # database
    "VULTR_S3_ENDPOINT",  # object storage
    "VULTR_S3_BUCKET",
    "VULTR_S3_ACCESS_KEY",
    "VULTR_S3_SECRET_KEY",
    "AUTH0_DOMAIN",  # login
    "AUTH0_CLIENT_ID",
    "AUTH0_AUDIENCE",
)

CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}

DEMO_SONG_ID = "demo-twinkle"
DEMO_ANALYSIS_FILE = FIXTURES_DIR / "song-analysis" / "twinkle.json"


def data_dir() -> Path:
    """Folder for saved uploads and analyses. Read on every call so tests can point it elsewhere."""
    override = os.environ.get("MUSIC_DATA_DIR")
    return Path(override) if override else SERVER_ROOT / "data"
