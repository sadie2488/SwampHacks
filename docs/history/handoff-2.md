# Handoff #2: updates since the plan was locked (Sat ~5:45 AM)

*History copy. The lead has merged these updates into `decisions.md`, `team.md`, `human-tasks.md`, `assumptions.md`, `build-spec.md` and `docs/vultr.md`. One phrase about the payment card is generalized because this repo is public.*

## Accounts (done by Sadie)
- ✅ **Vultr**: Object Storage created (label `swamphacks`), bucket `swamphacks-data`. Keys in `server/.env` (`VULTR_S3_ENDPOINT`, `VULTR_S3_ACCESS_KEY`, `VULTR_S3_SECRET_KEY`, `VULTR_S3_BUCKET`)
- ✅ **Gemini**: `GEMINI_API_KEY` in `server/.env`
- ✅ **Tiger Data**: `DATABASE_URL` in `server/.env`
- ✅ **Auth0**: Single Page Application (React), renamed for the project. Allowed Callback / Logout URLs and Web Origins = `http://localhost:5173` (add real domain at deploy). `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID` in `server/.env` (these two are public values, safe in the frontend)
- ❓ **GoDaddy domain**: not confirmed. Ask Sadie for the domain name (not secret)
- ✅ **GitHub**: all collaborators added by Sadie (repo `sadie2488/SwampHacks`, Sadie = owner/admin)
- Rules: never read, print, or commit `server/.env`. Confirm it's gitignored (`.env` pattern) before the first commit that touches `server/`

## New hard rule: Vultr budget (from Sadie)
- Vultr has a **$100 credit and a real payment card is linked**. Must not go over
- Never create or resize any Vultr resource without a human's explicit yes **plus a cost estimate**
- **GPU instances banned** unless a human explicitly approves
- **Task 0.8: Vultr budget watcher** (main laptop): every 30 min read balance + pending charges from the Vultr API (`VULTR_API_KEY` in `server/.env`, restricted to this laptop's IP; never read/printed by Claude). Email the team at **$50, $75, $90 used** (via the relay; terminal alert until the relay exists). At $75 stop all new Vultr usage; at $90 list everything running + what to shut down
- **Sunday after submission**: "delete all Vultr resources" checklist (storage bills monthly until deleted)
- Other team accounts may be used later if needed (decide then)
- Note: confirm Sadie has added `VULTR_API_KEY` (she may have only added storage keys)

## People (current)
- **Lalitha**: planning lead · **Sadie**: did accounts + GitHub · **Shayaan**: awake · **Veda**: wakes ~10 AM, semi-comfortable with code, owns command design (may change any design detail of her part)
- Main laptop must stay awake and plugged in

## Reports still coming from the planning chat
- Music theory background (rhythm, pitch/tuning tolerances, keys, notation, transposing instruments, practice-feedback pedagogy, humming to notes, time-stretch) + a plain-language glossary for `/explain`
- Exact Claude Code config syntax check (attribution setting keys, hooks schema, permission rules, skills/commands format, subagent files). **Until it arrives, verify against the official docs yourself.** (Done by the lead: verified against code.claude.com docs; see `.claude/settings.json`)

## Still open
- GoDaddy domain name · test clips (🔴) · design inspiration · who builds TouchDesigner visuals · demo song + instrument · Sadie's Gmail app password (only when the email relay is built) · sleep rotation · GitHub usernames (for briefs/branch names)
