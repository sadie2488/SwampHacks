---
name: handback
description: Wrap up your work. Writes your update file, saves work in progress, and releases or keeps your task. Use when you stop, finish, or leave.
disable-model-invocation: true
---

# /handback

Takes about a minute. The person should not have to remember anything.

1. **Draft the update** from `docs/templates/update.md`, filled from `git log`/`git diff` on the task branch, the task's acceptance list, and progress notes. At most 300 words
2. **Verification report** at the top: build, type check, lint, tests (trimmed to the important lines); secrets check; files changed and whether all are inside the owned folders; verdict READY or NOT READY. Never claim something works without the command output
3. **Remaining Claude usage**: run `/usage` and put the result in item 9
4. **Ask the human to confirm or add** (items 5–8 and 10 especially). Short questions, one at a time
5. **Save work in progress**: commit on the task branch (their own git identity, no AI credit) and `git push` that branch. Never push `main`
6. **Send the update**: `node scripts/comms-send.mjs updates/<person>-<task>-<time>.md <file>`
7. **Release or keep**: ask "Coming back to this?". Tell the lead which; the lead runs `node scripts/claim.mjs release <person> <task>` (add `--done` only when it is finished and checked)
8. **Human to-dos** from item 10 go to the lead, who adds them to `docs/human-tasks.md`
9. Tell them it is safe to close the laptop
