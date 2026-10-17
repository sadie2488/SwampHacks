---
name: start
description: Guided first-time setup on a worker laptop. Checks tools, signs in to GitHub, switches to the task branch, and saves who you are. Use after the first /checkin.
disable-model-invocation: true
---

# /start

For people who may be tired and do not know the setup. Plain words. Never leave them alone with a raw error: explain it, give the one next step.

## Steps
1. **Detect the computer.** Windows → `setup/setup-check.ps1` (run with `powershell -NoProfile -ExecutionPolicy Bypass -File`). Mac or Linux → `bash setup/setup-check.sh`
2. **Explain every result** in one plain line each (✅ ready / ❌ missing). For each ❌ give the exact install link or command, wait for the person, then re-run the check. Repeat until nothing the task needs is missing
3. **GitHub sign-in.** If `gh auth status` fails, run `gh auth login` with them and say exactly what to click. Keys and passwords are never typed into this chat
4. **Get the code.** Clone the repo (or `git pull`). Fetch the brief (`scratch/brief.md`, or `node scripts/comms-read.mjs briefs/<person>-`) to learn the task and branch name
5. **Switch to the task branch** from the brief (`<lane>/<person>/<task-id>-<slug>`). Create it from `main` if it does not exist. Never work on `main`
6. **Save who you are.** Write these two files (both are gitignored):
   - `.claude/settings.local.json` → `{ "autoMemoryEnabled": false, "permissions": { "deny": ["Agent"] } }` (worker laptops do not keep their own memory, and workers do not start helper agents)
   - `.claude/lane.local.json` → `{ "person": "...", "task": "...", "lane": "...", "owned_paths": [...from ownership.json...], "branch": "..." }`
   Write `settings.local.json` first: once the lane file exists, edits outside your folders are blocked
7. **Smoke test.** Run `node scripts/hook-selftest.mjs` (proves the guard blocks an edit outside your folders and allows one inside). Run the task's tests if any exist; say plainly if there are none yet
8. **Check the Claude Code settings people forget.**
   - The first time Claude opens this folder it asks "Do you trust this folder?". They must say **yes**, or the project's safety hooks and permission rules do not fully apply
   - Claude Code 2.1.283 or newer starts in auto mode on its own. If they keep getting permission prompts for everyday commands, close Claude and start it with `claude --permission-mode auto` (the project settings cannot turn auto mode on)
   - Run it in VS Code's built-in terminal, not the chat panel: the "needs your input" notification does not fire in the panel
9. **Finish** with "You're ready" and a one-line summary of the task. Remind them: `/explain`, `/ask`, `/handback`
