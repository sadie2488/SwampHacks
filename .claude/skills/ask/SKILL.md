---
name: ask
description: Send a question to the main laptop and bring back the answer.
argument-hint: "[your question]"
disable-model-invocation: true
---

# /ask $ARGUMENTS

1. If there is no question, ask "What would you like to ask the main laptop?"
2. Read `.claude/lane.local.json` for the person and task. Write the question with the task id and what the person was doing
3. Send it: `node scripts/comms-send.mjs comms/<person>-to-lead.md - --append` (text on stdin). No keys or passwords in the text
4. Tell the human: "Sent. I'll look for the answer." Then `node scripts/comms-read.mjs comms/lead-to-<person>.md --wait 300 --changed`
5. Show the answer in plain words. If nothing arrives in 5 minutes, say so, keep working on what you can, and offer to email it (`[MUSIC] ask ...`)

## On the main laptop
If this is the lead (no `lane.local.json`), a question arrives in `comms/<person>-to-lead.md`. Answer in `comms/lead-to-<person>.md` using `--append`. Log anything that changes a decision in `docs/decisions.md`.
