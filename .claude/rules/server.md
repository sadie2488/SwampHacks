---
paths:
  - "server/**"
  - "ml/**"
---
# Server and ML (Python, FastAPI)

- Use `uv` for Python. Dependencies change only in `server/pyproject.toml` (lead only); ask the lead if you need one
- Pretrained models first (basic-pitch and similar). Our own PyTorch model replaces them only if it beats the baseline on the frozen test set
- Separate the part before transcribing, and quantize notes to the tempo grid
- Datasets, model weights, and audio or video never go in git. Use Vultr storage
- Cache analysis results so repeat runs are instant
- ML scoring: held-out split by piece and performer (no leakage), `mir_eval` note-onset F1 against basic-pitch, results logged to files. A leakage review comes before each training run
- The Gemini key lives only on the server, never in the browser
- Load keys from `server/.env` (python-dotenv; the repo-root `.env` is a fallback). Key names are in `.env.example`. Never print, log, or return a key or the connection string, not even in error messages. Add new key names to `.env.example` with no value (ask the lead; it is a root file)
