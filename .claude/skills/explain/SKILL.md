---
name: explain
description: Explain a numbered item from your brief (like 4.3) or a topic (plan, ai-setup, features, team, demo, accounts, clips, approve) in plain words.
argument-hint: "[item number or topic]"
disable-model-invocation: true
---

# /explain $ARGUMENTS

Answer **only** from the person's latest brief (`scratch/brief.md`, or the newest `briefs/<person>-*` from `node scripts/comms-read.mjs briefs/<person>-`) and the project docs. Do not use outside knowledge about this project.

## Where answers come from
- A number like `4.3` → that bullet of the brief; add the plain reason behind it from `docs/`
- `plan` → `docs/plan.md` · `ai-setup` → `docs/ai-setup.md` · `features` → `docs/features.md` · `team` → `docs/team.md` · `demo` → `docs/demo.md`
- `accounts`, `clips`, `approve` → the matching sections of `docs/human-tasks.md`
- No argument → list the topics and say "type /explain 4.3 or /explain plan"

## Style
- Short: a few bullets, plain words, no jargon without a one-line meaning
- If the brief and docs do not cover it, say so and suggest `/ask <question>`
- Never invent. Never share keys or private details
