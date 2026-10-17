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

## Lead tools (all in `scripts/`)
- `node scripts/claim.mjs claim|release <person> <task>`: records a claim in `tasks.json`, `ownership.json` and `docs/team.md`
- `node scripts/comms-send.mjs` / `comms-read.mjs`: messages on the `comms` branch (`--append`, `--wait`, `--changed`)
- `node scripts/branch-scope.mjs <branch> <lane>...`: did a helper's branch stay inside its folders? Run before merging
- `node scripts/e2e.mjs`: starts the server, website and relay and runs the browser test in real Chrome (made-up camera/mic data)
- `node scripts/hook-selftest.mjs`, `node --test "tests/**/*.test.mjs"`, `node scripts/validate-contracts.mjs`: the safety nets. Run all three before merging anything
- `node scripts/make-fixtures.mjs`: rewrites the fake data in `fixtures/` (they must stay valid)
- Email relay (needs Sadie's app password, see `docs/email-relay.md`): start `node scripts/relay/daemon.mjs` in the background; ask questions with `node scripts/ask-human.mjs`
- Helper agents: brief them with `docs/helper-brief-common.md`, run them in separate worktrees, check `branch-scope.mjs`, then merge and re-run the checks yourself. Never merge on a helper's word alone

## Backup lead
If the main laptop goes down, any laptop can take over: clone the repo, read this file, and follow the startup ritual. The backup account needs maintainer access on GitHub.
