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

## Check that it works
| What | Command |
|---|---|
| The whole app in a real Chrome (starts everything itself) | `node scripts/e2e.mjs` |
| Website: types, unit tests, build | `cd web && npx tsc --noEmit && npx vitest run && npx vite build` |
| Server | `cd server && uv run ruff check . && uv run pytest -q` |
| TouchDesigner relay | `cd bridge && node --test && node relay.mjs --selftest` |
| Contracts, CI checks, email relay, safety hooks | `node --test "tests/**/*.test.mjs"` · `node scripts/validate-contracts.mjs` · `node scripts/hook-selftest.mjs` |

## Where things are
- `web/` the website · `server/` the Python server · `bridge/` + `touchdesigner/` the TouchDesigner relay and its guide
- `contracts/` the agreed data shapes and the lists of signals and controls · `fixtures/` fake data
- `web/src/modules/mappings/mappings.yaml` the file that maps signals to controls (Veda's)
- `docs/` plans, rules and guides · `.claude/` the team's Claude setup · `scripts/` lead tools
