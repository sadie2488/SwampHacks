# SwampHacks: interactive music website

Learn songs with live feedback, control music with your body and voice, and create with your hum, with reactive visuals.

- **Learn**: upload a song, see its tempo, key and sheet music, slow it down without changing pitch, play along
- **Play**: your camera (hands, head) and your voice (claps, snaps, words) control the music through a mapping file anyone can edit
- **Create**: hum a melody, pick an instrument, layer loops
- **Visuals**: TouchDesigner reacts to the music and your hands

New teammate? Ask the main laptop for a brief with `/checkin`, then type `/start`. Plan: `docs/plan.md`. What the app does: `docs/features.md`.

## Run it on your computer
Needs Node 20+, [uv](https://docs.astral.sh/uv/), and Chrome. One time: `npm ci` inside `web/` and `bridge/`, and `uv sync` inside `server/`. (`setup/setup-check.ps1` on Windows or `setup/setup-check.sh` on Mac/Linux checks everything and tells you what to fix.)

```
node scripts/dev.mjs
```
Then open <http://localhost:5173/>. No camera or microphone handy? Use <http://localhost:5173/?fake=1> (made-up camera and microphone data). Keys go in `server/.env` (copy `.env.example`; never commit or share it).

The first `uv sync` downloads the audio analysis libraries (a few hundred MB) and the first upload of a song takes a little longer while they warm up. Uploaded songs get a real tempo, key and (for a single instrument playing alone) real sheet music.

## Check that it works
| What | Command |
|---|---|
| **Everything quick, all at once (about a minute)** | `node scripts/check.mjs` (add `--build`, or `--e2e` to also run the browser test) |
| The whole app in a real Chrome (starts everything itself) | `node scripts/e2e.mjs` |
| Website: types, unit tests, build | `cd web && npx tsc --noEmit && npx vitest run && npx vite build` |
| Server | `cd server && uv run ruff check . && uv run pytest -q` |
| TouchDesigner relay | `cd bridge && node --test && node relay.mjs --selftest` |
| Contracts, CI checks, email relay, safety hooks | `node --test "tests/**/*.test.mjs"` · `node scripts/validate-contracts.mjs` · `node scripts/hook-selftest.mjs` |

## How it's built
- **Website**: React + Vite, Web Audio and Tone.js (tempo without pitch change, pitch shift), MediaPipe hand and face tracking in a background worker, OpenSheetMusicDisplay for the sheet, three.js for the paper landscape, Chrome speech recognition for spoken commands
- **Server**: Python (FastAPI) with librosa: tempo, beats, key, time signature, the melody as notes (pYIN), and drums taken out of full-band songs before reading the melody
- **TouchDesigner**: the website streams hand positions, the song's position and its frequency bands to a small relay (`bridge/`), which forwards them as OSC
- **Gemini** turns measured practice facts (timing, rushed or dragged bars) into short, kind coaching. Rule-based feedback shows first, so the app never waits on it
- **Tiger Data** (Postgres with TimescaleDB) stores songs, practice runs and saved tracks. Without it the server keeps them in memory
- **Auth0** login appears only when it is set up; without it the app works the same
- Planned: hosting on **Vultr** and a **GoDaddy** domain (`deploy/` has the setup)

## Where things are
- `web/` the website · `server/` the Python server · `bridge/` + `touchdesigner/` the TouchDesigner relay and its guide
- `contracts/` the agreed data shapes and the lists of signals and controls · `fixtures/` fake data
- `web/src/modules/mappings/mappings.yaml` the file that maps signals to controls (Veda's)
- `docs/` plans, rules and guides · `.claude/` the team's Claude setup · `scripts/` lead tools
