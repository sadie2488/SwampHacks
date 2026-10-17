# ⭐ Things only humans can do

These show up in everyone's ⭐ box until done. Tell the main laptop when you finish one (`/handback` or `/ask`).

| Status | Task | Urgency |
|---|---|---|
| ✅ | Sponsor accounts + keys: Vultr, Gemini, Tiger Data, Auth0 (keys are in `server/.env`) | 🔴 |
| ☐ | **Database password**: the connection string in `server/.env` (`DATABASE_URL`) has no password in it (the connection fails with "no password supplied"). Tiger Data shows the password only once when the service is created. Easiest: in a terminal in the project folder run `node scripts/set-db-password.mjs`, type the password (it stays hidden) and it puts it in the right place. Or edit the line yourself, like `postgres://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require` (encode `@ / ? # : %` in the password as `%40 %2F %3F %23 %3A %25`). If it was lost, reset it in the Tiger Data console. Never paste it into chat. Then tell the main laptop and it will run `uv run python -m app.db ping` and `migrate` | 🟠 |
| ☐ | GoDaddy domain name (not a secret: just tell the main laptop the name) | 🟠 |
| ☐ | Deploy: read `deploy/README.md` (cost about $10 a month, $1 to $2 for the weekend, check the price on Vultr), then say yes or no to creating the server. Nothing is created until a person says yes | 🟠 |
| ☐ | Confirm `VULTR_API_KEY` is in `server/.env` (restricted to the main laptop's IP) so the budget watcher can run | 🟠 |
| ☐ | After submitting: delete all Vultr resources (checklist in `docs/vultr.md`) | 🟡 |
| ☐ | Record test clips | 🔴 |
| ☐ | Sadie: Gmail app password for the email relay | 🔴 |
| ☐ | Repo owner: turn on GitHub secret scanning + push protection (Settings → Code security) | 🔴 |
| ☐ | Approve the first tests | 🟠 |
| ☐ | Design: look at the three mockups (Firefly Marsh, Glass Hall, Paper Reef; link in the main laptop's chat) and say A, B, C or a mix, plus any inspiration | 🟠 |
| ☐ | TouchDesigner visuals | 🟡 |
| ☐ | Pick the demo song + instrument | 🟡 |

---

## 🔑 Sponsor accounts (`/explain accounts`)
**Golden rule: never paste a key into chat, email, or any file in this repo.** Keys go only into the private `.env` file on the machine that needs them — type them in yourself.

Status (done by Sadie): ✅ Vultr · ✅ Gemini · ✅ Tiger Data · ✅ Auth0 · ❓ GoDaddy (domain name still needed)
- **Vultr** (hosting + storage): Object Storage `swamphacks` with bucket `swamphacks-data`. Keys in `server/.env`. **Budget rules: `docs/vultr.md`** (a $100 credit; nothing gets created without a human's yes and a cost estimate; GPU banned)
- **Tiger Data** (database): connection string is `DATABASE_URL` in `server/.env`
- **Gemini** (coaching text): `GEMINI_API_KEY` in `server/.env`
- **GoDaddy** (domain): not confirmed. Needed: the domain name
- **Auth0** (login, added last): a "Single Page Application" (React). Callback, logout and web-origin URLs are `http://localhost:5173` for now (add the real domain at deploy). `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` are public values (safe in the website); everything else stays secret

## 🔒 Your private `.env` file (`/explain env`)
The safe place for API keys. Each laptop that needs keys makes its own.
- **The file lives at `server/.env`** (already made on the main laptop). On another laptop, make it once (PowerShell, in the project folder): `Copy-Item .env.example server\.env`
- **Fill it in yourself**: open it in **Notepad**, type each key after its `=`, save. In Notepad's Save dialog choose "All files" so it stays `.env` and not `.env.txt`
- **Why it's safe**
  - Git ignores it, so it can't be committed by accident (this is tested automatically)
  - Claude is blocked from reading it or writing to it; so are shell tricks like `cat .env` or `node -e`
  - Every pull request is scanned for keys, and GitHub's push protection (owner turns it on once) stops a push that contains one
- **Don't**
  - Paste a key into chat, email, a commit, a pull request, or any other file
  - Keep `.env` open or selected in VS Code while chatting with Claude (open files and selections can be shared with it as context). Close that tab first
  - Screenshot or screen-share the file
  - Put a key in a name that starts with `VITE_`: those are sent to every visitor's browser. Keys stay on the server
- **Share keys** only in person or through a password manager, never by chat or email. Each person can also make their own keys at the provider
- **If a key leaks** (even for a second): revoke or rotate it at the provider right away. Deleting the commit is not enough. Then tell the main laptop
- The email relay password is not in `.env`. It goes in `relay.private.json` (also private)

## 🎥 Test clips (`/explain clips`)
Short clips let the app test camera and mic features automatically, without someone standing in front of a camera.
- Each clip ~5–10 seconds, laptop webcam or phone is fine
- **Privacy**: hands-only framing where possible. Clips are stored in Vultr storage, **not** in this public repo
- Name files like `vision_fist_01.mp4`, `audio_clap_01.wav`

**Camera clips**
- Open palm · fist · one hand raised · pinch (thumb + index) · both hands moving apart/together
- Head tilt left · head tilt right · nod (face visible is OK for these)
- Drum-hit motion (hitting an invisible drum)
- 10 s of "nothing happening" (hands still) — important for testing false triggers

**Audio clips** (quiet room if possible, plus one noisy version of each)
- Spoken words: "play", "pause", "slower", "faster", "higher", "lower" (each ~3 times)
- Snap · clap · 10 s of humming a simple tune
- 20–30 s of the demo instrument playing along with a metronome (once the demo song is picked)
- 10 s of room silence

## ✅ Approving tests (`/explain approve`)
- The main laptop writes what each feature should do as a short plain-English list
- Read it and reply "approved" or suggest changes. No code reading needed

## 🎨 Design inspiration
- Screenshots, mood boards, colors, fonts, websites or art you like — anything visual
- Drop them in the team chat or email; the main laptop will collect them

## 🌈 TouchDesigner visuals
- Built by hand in TouchDesigner. The app will stream music and hand data to it (task C3)

## 🎼 Demo song + instrument
- Pick a public-domain or self-recorded song and the instrument for the demo (clarinet or trombone recommended for pitch feedback)
