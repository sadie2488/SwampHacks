# 🎵 Project Plan (locked Sat 4:33 AM)

Plain-language version of the whole plan. Ask about any part with `/explain plan`.

## 1. What we're building
- **Learn mode**
  - Upload a song → the app finds its tempo, key and time signature
  - It isolates the part you want and turns it into sheet music (beginner mode shows note letters)
  - You play along on a real instrument → the app compares you to the song and gives feedback (demo focus: tempo)
- **Play mode**: motion and audio control playback (tempo, pitch, volume, loop). Example: tilt your head to slow down
- **Create mode (DJ)**: hum a melody → it becomes an instrument → add beats and loops → save and replay
- **Visuals**: TouchDesigner reacts to the music and to your hands
- **Demo flow**: learning → upload → analysis → tempo practice with motion → feedback → play → create a beat with the judges → adaptive visuals

## 2. People and machines
- **Main laptop**: always on. Coordinates, merges, and builds anything nobody has claimed
- **Lalitha**: planning lead
- **Sadie, Shayaan**: on the early shift
- **Veda**: joins ~10 AM, owns command design (play + create). She is free to change any design detail of her part
- **Other laptops**: check in when active. Each one detects its own OS during `/start`

## 3. How people work with the system
1. `/checkin` → pick a task from a short menu → get your brief
2. `/start` → guided setup (first time only)
3. `/explain 5.3` → explanation of any numbered point in your brief (also `/explain plan`, `ai-setup`, `features`, `team`, `demo`)
4. `/ask` → question for the main laptop
5. `/handback` → your update file when you stop or finish
- All commands also work by email (see `docs/email-relay.md`)
- Anyone can override any rule after a warning. Overrides are logged and everyone affected is told
- Every Claude answers a human message before continuing work. Press **Esc** to interrupt immediately

## 4. Guardrails and quality
- Everyone works on their own branch. Only the main laptop merges (after checks pass)
- Locked for task workers: `contracts/`, `tests/`, `.github/`, `.claude/`, root config files
- Automatic checks on every pull request: folder ownership, secrets, no AI attribution, no big files, contracts valid
- Tests are written in plain English by the main laptop and **approved by a human**. Agents never write the tests that grade their own work
- "Done" needs proof: a verification report (READY / NOT READY)
- A fresh reviewer agent checks changes. More care for demo-critical work
- Live features are tested with recorded camera and mic clips
- The ML model is scored on a frozen test set against basic-pitch
- The demo must pass 5 runs out of 5 before submitting
- Keys never go in files, chat, or the repo. The Gemini key stays on the server

## 5. Usage rules (saves everyone's Claude budget)
- Short rules files. Fresh session per task. Don't switch model mid-session
- Read only what you need (search first, then read the relevant lines)
- Sonnet builds; Opus plans and reviews (main laptop)
- Long jobs run in the background

## 6. Tech and sponsors
- **Website**: React + Vite, Web Audio / Tone.js, MediaPipe, OpenSheetMusicDisplay
- **Server**: Python (FastAPI), librosa, Demucs, basic-pitch + our PyTorch model, music21
- **Sponsors**: Gemini (coaching) · Tiger Data (songs + practice history) · Vultr (hosting + storage) · GoDaddy (domain) · Auth0 (login, added last, can be switched off)

## 7. Tasks
⭐ = demo path · 🟣 = needed for Veda by 9:30 AM. Live status lives in `tasks.json`.

**Setup (main laptop)**: 0.1 repo + ownership · 0.2 rules, commands, docs · 0.3 guardrails + CI · 0.4 contracts + fake data · 0.5 setup checks · 0.6 🟣 walking skeleton · 0.7 email relay

**Commands & mappings (Veda's lane)**: L1 🟣⭐ command system + mapping engine · L6 🟣 Command Lab · V1 Veda designs the play + create commands

**Lane A: music → data**: A1 ⭐ datasets · A2 ⭐ tempo + key · A3 segmentation · A4 ⭐ sheet music · A5 frozen test set · A6 custom PyTorch model

**Lane B: live audio**: B1 🟣⭐ mic + pitch · B2 ⭐ compare user to song (+ timing calibration) · B3 ⭐ feedback + Gemini · B4 🟣 keywords + snap/clap

**Lane C: vision + visuals**: C1 🟣⭐ tracking · C2 🟣 basic gestures · C3 ⭐ TouchDesigner connection

**Lane D: create mode**: D1 🟣 hum → notes · D2 🟣 instruments · D3 🟣 layers + loops · D4 save + replay

**Main laptop**: L2 🟣⭐ playback (tempo without pitch change, pitch shift) · L3 ⭐ app shell · L4 server + Tiger Data + Auth0 · L5 deploy

**Design**: F1 the real look (after inspiration arrives). Must not look AI-generated

**Human-only** (shown in everyone's ⭐ box): 🔴 sponsor accounts incl. Vultr · 🔴 test clips · 🟠 approve tests · 🟠 design inspiration · 🟡 TouchDesigner visuals · 🟡 demo song + instrument · 🟡 Sadie's email app password

## 8. Timeline
| Time | Milestone |
|---|---|
| ~6:00 AM Sat | Setup + email relay done, first check-ins |
| **9:30 AM** | **Walking skeleton + everything Veda needs** |
| ~2:00 PM | Real analysis, sheet music and tracking connected |
| ~8:00 PM | Learn, play and create modes connected |
| ~12:00 AM Sun | Design applied, deployed |
| **3:00 AM** | **Feature freeze** |
| 3:00–5:30 AM | Polish, 5 demo run-throughs, README |
| **6:00 AM** | **Submit** |

## 9. Biggest risks → fallbacks
- Messy sheet music from full songs → separate the part first; fall back to note letters + pre-analyzed demo songs
- Song leaking into the mic → headphones or metronome during practice
- Venue Wi-Fi → local demo mode with cached results and canned coaching
- Judges' song fails → switch to a pre-analyzed song after ~20 s
- Browser overload → camera tracking in a background thread at ~15 fps
- Main laptop goes down → all state lives in this repo; a backup lead can take over (`docs/lead-handoff.md`)

## 10. Pinned (decide later)
Final commands (Veda) · design details · demo fallbacks · voice commands during play mode · final computer-vision list · sleep rotation · demo song · headphones · backup lead · who approves tests
