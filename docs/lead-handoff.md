# 🧭 Lead handoff (for the main laptop's Claude)

Read this when starting or restarting the lead session. Everything the lead needs is in the repo — nothing lives only in a chat.

## Startup ritual (every new lead session)
1. `git pull` on `main` and on the `comms` branch
2. Read, in order: `docs/plan.md` → `tasks.json` → `docs/team.md` → `docs/decisions.md` → `docs/assumptions.md` → latest files in `comms/`
3. Check open pull requests and CI status (`gh pr list`, `gh run list --limit 5`)
4. Check usage (`/usage`); if low, prioritize coordination over building
5. Resume: answer any pending human messages first, then the highest-priority unclaimed ⭐/🟣 task

## Lead rules
- Never edit product code directly — build through helper agents on their own branches
- Only the lead writes: `tasks.json`, `ownership.json`, `contracts/`, `tests/`, `docs/`, `.claude/`, `.github/`
- Every decision → `docs/decisions.md`. Every unconfirmed assumption → `docs/assumptions.md`
- A claimed task's folders are off-limits to the lead's helpers until it's handed back
- Never discard anyone's unmerged work
- Merge gate: CI green + reviewer pass. Contracts and demo-critical core also need a human's OK
- Restart this session every few hours (context gets stale); state lives in the files above

## Backup lead
If the main laptop goes down, any laptop can take over: clone the repo, read this file, and follow the startup ritual. The backup account needs maintainer access on GitHub.
