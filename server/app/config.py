"""Server settings: where things live on disk and which environment variables the server will use.

Private keys live in `server/.env`; the repo-root `.env` is a fallback. Values already set in the
process environment always win. Only the names in ENV_VAR_NAMES are ever loaded, and nothing here
prints or returns a value (the one exception is `public_auth0`, which is safe for the website).
"""
import os
from collections.abc import Iterable
from pathlib import Path

from dotenv import dotenv_values

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_ROOT = REPO_ROOT / "server"
FIXTURES_DIR = REPO_ROOT / "fixtures"
CONTRACTS_DIR = REPO_ROOT / "contracts"

# Names only (the same names as `.env.example`). VULTR_API_KEY is deliberately absent:
# it belongs to the separate budget script and the server must never load or use it.
ENV_VAR_NAMES = (
    "GEMINI_API_KEY",  # coaching text
    "DATABASE_URL",  # database connection string
    "VULTR_S3_ENDPOINT",  # object storage
    "VULTR_S3_BUCKET",
    "VULTR_S3_ACCESS_KEY",
    "VULTR_S3_SECRET_KEY",
    "AUTH0_DOMAIN",  # login (public)
    "AUTH0_CLIENT_ID",  # login (public)
    "AUTH_ENABLED",  # switch for login (true or false)
    "AUTH0_AUDIENCE",  # login: the API the tokens are for
    "GEMINI_MODEL",  # coaching text: which model to ask (a sensible default is built in)
    "MUSIC_DATA_DIR",  # where uploads and analyses are saved (default: server/data)
)

# Checked in this order: the first file that sets a name wins over the second.
ENV_FILES = (SERVER_ROOT / ".env", REPO_ROOT / ".env")


def load_env_files(paths: Iterable[Path | str], names: Iterable[str] = ENV_VAR_NAMES) -> list[str]:
    """Copy allowed variables from env files into the process environment, never overriding.

    Files that do not exist are skipped. Names outside `names` and blank values are ignored.
    A name already in the environment (from the process or an earlier file) is left alone.
    Returns the names that were set, never their values.
    """
    allowed = set(names)
    loaded: list[str] = []
    for path in paths:
        if not Path(path).is_file():
            continue
        # utf-8-sig accepts the invisible marker some editors put at the start of the file
        for name, value in dotenv_values(path, encoding="utf-8-sig", interpolate=False).items():
            if name in allowed and value and name not in os.environ:
                os.environ[name] = value
                loaded.append(name)
    return loaded


load_env_files(ENV_FILES)

CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}

DEMO_SONG_ID = "demo-twinkle"
DEMO_ANALYSIS_FILE = FIXTURES_DIR / "song-analysis" / "twinkle.json"


def data_dir() -> Path:
    """Folder for saved uploads and analyses. Read on every call so tests can point it elsewhere."""
    override = os.environ.get("MUSIC_DATA_DIR")
    return Path(override) if override else SERVER_ROOT / "data"


def public_auth0() -> dict[str, str | None]:
    """The only two environment values the website may see. A blank or missing value becomes None."""
    return {
        "domain": os.environ.get("AUTH0_DOMAIN", "").strip() or None,
        "client_id": os.environ.get("AUTH0_CLIENT_ID", "").strip() or None,
    }
