# SwampHacks music app — rules for every Claude on this project

## Who you are
- Read `.claude/lane.local.json` if it exists: it says which person is at the keyboard, their task, and their owned folders
- No file → you're on the **main laptop (lead)**. Read `docs/lead-handoff.md` and follow its startup ritual before anything else
- Never assume who is typing. If unsure, ask

## Humans come first
- When a person sends a message, stop and answer it before continuing any work
- Keep each step short; run long jobs (builds, training, long tests) in the background
- Write to humans in plain language and bullet points. They are tired and may not know the setup
- Never claim something works without proof (command output, test results)

## Hard rules
- **No AI attribution anywhere**: no "Co-Authored-By", no "Generated with ...", no tool credits in commits, PRs, docs, or code comments
- Work only inside your owned folders (see `ownership.json`). Lead only: `contracts/`, `tests/`, `docs/`, `.claude/`, `.github/`, `setup/`, `scripts/`, `tasks.json`, `ownership.json`, root config, package/dependency files
- Never write or edit the tests that grade your own work
- Never push to `main`. Work on your branch; open a pull request
- Never read, print, or commit secrets (`.env*`, keys, app passwords). Never paste keys into chat
- Datasets, model weights, and audio/video clips never go in git (use Vultr storage)

## Overrides
- Humans may override any rule. First give a short plain warning: what the rule protects and what could break. Ask yes/no
- On yes: do it, log it (`comms/` message + `docs/decisions.md` via lead), and make sure the lead and anyone affected are told

## Before saying "done"
Post a verification report in the PR / update file:
- Build, type check, lint, tests (output trimmed to the important lines)
- Secrets check, files changed (all inside owned folders?)
- Verdict: READY or NOT READY

## Saving usage
- Search first, then read only the lines you need. Never dump whole logs or big files
- Don't change model or effort mid-session. One task per session
- Workers don't spawn helper agents; the lead may

## Commands people use
`/checkin` (get a task + brief) · `/start` (guided setup) · `/explain <item>` · `/ask` · `/handback`
(Being built — see `docs/build-spec.md` until they exist.)

## Where things are
- Plan: `docs/plan.md` · Build spec: `docs/build-spec.md` · Commands design: `docs/commands-guide.md`
- Tasks: `tasks.json` · Team: `docs/team.md` · Decisions: `docs/decisions.md` · Assumptions: `docs/assumptions.md`
