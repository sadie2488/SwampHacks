# 🧭 Lead handoff (for the main laptop's Claude)

Read this when starting or restarting the lead session. Everything the lead needs is in the repo — nothing lives only in a chat.

## Startup ritual (every new lead session)
1. `git pull` on `main` and on the `comms` branch
2. Read, in order: `docs/plan.md` → `tasks.json` → `docs/team.md` → `docs/decisions.md` → `docs/assumptions.md` → latest files in `comms/`
3. Check open pull requests and CI status (`gh pr list`, `gh run list --limit 5`)
4. Check usage (`/usage`); if low, prioritize coordination over building
5. Resume: answer any pending human messages first, then the highest-priority unclaimed ⭐/🟣 task

## Current goals (set by Lalitha, Sun 2026-10-18 ~3:30 AM)
Two tracks, run side by side:
1. **Frontend look** (Overture): one design helper at a time on `web/src/ui`, `web/src/styles`, `web/src/app` so they never overwrite each other. The lead checks every change at 1280x800, 1366x768, 1440x900 and 1920x1080 with screenshots and the browser test before merging. Design rules: `docs/decisions.md` (no scrolling, camera + mic always on, blank-by-default modes with panel toggles, Grail feel, nothing copied from references).
2. **Backend works** (every motion and audio command really does something): **testable and implemented is the priority.** The loop per command: (a) a test-writer helper writes an integration test per rule in `mappings.yaml` (fake signal in, observable effect out) and changes no app code; (b) a different fixer helper makes the failing ones pass without weakening tests; (c) a human checks the same list live with the real camera and mic in the Command Lab.

## Lead rules
- Never edit product code directly — build through helper agents on their own branches
- Only the lead writes: `tasks.json`, `ownership.json`, `contracts/`, `tests/`, `docs/`, `.claude/`, `.github/`
- Every decision → `docs/decisions.md`. Every unconfirmed assumption → `docs/assumptions.md`
- A claimed task's folders are off-limits to the lead's helpers until it's handed back
- Never discard anyone's unmerged work
- Merge gate: CI green + reviewer pass. Contracts and demo-critical core also need a human's OK
- Restart this session every few hours (context gets stale); state lives in the files above

## Lead tools (all in `scripts/`)
- `node scripts/claim.mjs claim|release <person> <task>`: records a claim in `tasks.json`, `ownership.json` and `docs/team.md`
- `node scripts/comms-send.mjs` / `comms-read.mjs`: messages on the `comms` branch (`--append`, `--wait`, `--changed`)
- `node scripts/branch-scope.mjs <branch> <lane>...`: did a helper's branch stay inside its folders? Run before merging
- `node scripts/check.mjs [--build] [--e2e]`: runs every quick check at the same time (about a minute); the first thing to run before merging
- `node scripts/dev.mjs`: starts the server, website and relay for people to try the app
- `node scripts/vultr-budget.mjs --watch`: the Vultr budget watcher (see `docs/vultr.md`)
- `node scripts/e2e.mjs`: starts the server, website and relay and runs the browser test in real Chrome (made-up camera/mic data). If someone already runs `dev.mjs`, run `node --test tests/e2e/skeleton.e2e.mjs` against their servers instead
- `node scripts/hook-selftest.mjs`, `node --test "tests/**/*.test.mjs"`, `node scripts/validate-contracts.mjs`: the safety nets. Run all three before merging anything
- `node scripts/make-fixtures.mjs`: rewrites the fake data in `fixtures/` (they must stay valid)
- Email relay (needs Sadie's app password, see `docs/email-relay.md`): start `node scripts/relay/daemon.mjs` in the background; ask questions with `node scripts/ask-human.mjs`
- Helper agents: brief them with `docs/helper-brief-common.md`, run them in separate worktrees, check `branch-scope.mjs`, then merge and re-run the checks yourself. Never merge on a helper's word alone

## Backup lead
If the main laptop goes down, any laptop can take over: clone the repo, read this file, and follow the startup ritual. The backup account needs maintainer access on GitHub.
