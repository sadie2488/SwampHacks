# Helper brief (read this first)

You are a helper for the lead, building ONE part (lane) of the walking skeleton for a music app. The deadline is tight, so build the simplest thing that really works and prove it. Everything the lead needs from you is in your final report.

## The project in five lines
- A website (React + Vite + TypeScript in `web/`) and a small Python server (FastAPI in `server/`)
- **Learn**: upload a song, see tempo/key/time signature and sheet music, play it with tempo and pitch controls
- **Play**: motion (camera) and sound (mic) control the music through a mapping file Veda edits (`web/src/modules/mappings/mappings.yaml`)
- **Create**: hum a melody, it becomes notes, add instruments, layers and loops
- **Visuals**: TouchDesigner reacts to the music and hands, fed by a small relay

## Hard rules
- Work **only inside the folders your task lists**. Never edit anything else, especially: `web/src/bus/`, `web/src/contracts/`, any `package.json`, `package-lock.json`, `pyproject.toml`, `uv.lock`, `contracts/`, `fixtures/`, `tests/`, `docs/`, `.claude/`, `.github/`, `scripts/`, `ownership.json`, `tasks.json`. If you need a change there, do NOT work around it: finish what you can and list it under **NEEDS LEAD** in your report
- **No new dependencies.** Everything needed is installed (react, tone, soundtouchjs, opensheetmusicdisplay, @mediapipe/tasks-vision, pitchy, yaml, vitest, jsdom in `web/`; fastapi, uvicorn, pytest, httpx, ruff, jsonschema in `server/`). If something is truly missing, say so under NEEDS LEAD. (Exception: the TouchDesigner helper may add `ws` inside `bridge/`)
- **No AI credit anywhere**: no co-author lines, no "Generated with", no tool names in commit messages, code comments, or docs. Commit with plain messages like "Add pitch detection"
- Never read, print, or write `.env*`, keys, or passwords. Never put a key in code. No audio, video, model weights or datasets in git. Nothing over 5 MB
- Don't push anything and don't touch other branches. Commit your work on your own branch (you are in your own copy of the repo)
- Match the style of the code around you. Comment only what is not obvious. User-facing text is plain English for non-programmers

## How to work
1. Read: this file, `CLAUDE.md`, `web/src/bus/index.ts` (the topic table at the top says who publishes and listens to what), `web/src/contracts/index.ts` (the data shapes), and whichever of `contracts/*.json`, `fixtures/`, and `docs/commands-guide.md` your task points at. Search first and read only what you need
2. Set up: `cd web && npm ci --prefer-offline` (and `cd server && uv sync` for Python work)
3. Build in small steps. After each step run what applies:
   - Web: `cd web && npx tsc --noEmit && npx vitest run`, and `npx vite build` at the end
   - Server: `cd server && uv run ruff check . && uv run pytest -q`
4. Write unit tests for your pure logic next to the code (`*.test.ts`, or `test_*.py`). Use the fixtures in `fixtures/` as fake data (import with `@fixtures/...` in web code). These are your own development tests; the lead writes the real acceptance tests
5. Commit when it works: `git add -A && git commit -m "..."`. Check `git status` first and make sure you only changed your folders

## How the modules fit together
- Modules never import each other. They talk through the bus (`import { bus, sendCommand, sendSignal, reportStatus, isFakeMode, getAudioContext, resumeAudio } from '@/bus'`) and the types in `@/contracts`. Catalogs: `import { signalCatalog, controlCatalog } from '@/contracts/catalogs'`
- Every module exposes `start(): Stop` from its `index.ts(x)`: begin listening to the bus, return a function that stops everything. `start()` must not open the camera or mic by itself: devices open only after a bus `enable` event for your module (the user clicked a button first)
- **Fake mode**: when `isFakeMode()` is true (page opened with `?fake=1`), device modules replay fixtures instead of using the camera or mic, so everything works without hardware (this is how the lead tests)
- Browsers only start audio after a click: use `resumeAudio()` from the bus helpers inside click handlers. Use the shared `getAudioContext()`, never create your own AudioContext
- `controls` (on the bus) always has the latest value of every control (tempo, pitch, volume, loop, ...): read it for absolute values. Use `command` events only for triggers (`playback.play`, `playback.pause`, `playback.toggle`, `create.layer.add`, `create.loop.stop`)
- Notes are **concert-pitch MIDI**. Times are song time at 1.0x speed, in seconds
- Add `data-testid` attributes exactly as your task lists them (the lead's browser tests look for them)
- The final visual design comes later from a designer: keep the UI plain, tidy, and semantic (real buttons, labels, headings). Don't spend time on styling

## Server API (the shell calls it, the server implements it)
- `GET /api/health` -> `{"status":"ok"}`
- `GET /api/demo-songs` -> `[{"song_id":"demo-twinkle","title":"Twinkle, Twinkle, Little Star"}]`
- `GET /api/songs/{song_id}/analysis` -> a `song-analysis` document (demo ids and uploaded ids). 404 with `{"detail": "..."}` if unknown
- `POST /api/songs` (multipart field `file`) -> a `song-analysis` document with a new `song_id` like `upload-1a2b3c4d`, `source.kind = "upload"`, `source.file_name` set, `title` from the file name. For now the analysis content is fake (the Twinkle notes); the real analysis comes later
- If the server can't be reached, the web app falls back to the built-in demo (`@fixtures/song-analysis/twinkle.json`) and says so on screen

## Definition of done and your final report
Done means: your task's list works, the checks above pass, and you committed. Your final message is your report (at most 300 words, plain language):
1. **Summary**: what you built, in a few bullets
2. **Verification**: the exact commands you ran with the key lines of their output (typecheck, tests, build; test counts). Never claim something works without that proof
3. **Files**: the folders you changed (all inside your task's folders?)
4. **What is faked or incomplete**: be honest, including anything you could not test (for example a real camera or microphone)
5. **NEEDS LEAD**: changes you need in files you may not edit (or "none")
6. **Branch name** and the last commit
7. **Verdict**: READY or NOT READY
