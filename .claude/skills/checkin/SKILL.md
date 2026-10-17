---
name: checkin
description: Get a task and a personal brief. Use when a teammate arrives, comes back, or wants something new to work on.
disable-model-invocation: true
---

# /checkin

Humans first: answer plainly, short bullets, no raw errors.

## 1. Who is typing?
Ask "Who's at the keyboard?" (Lalitha, Sadie, Shayaan, Veda, or someone new). Never guess. Read `docs/team.md` for their interests; if blank, ask what they like working on and note it.

## 2. Which laptop?
- `.claude/lane.local.json` exists → **worker laptop**, go to section W
- It does not exist → **main laptop (lead)**, continue below

## 3. Menu (main laptop)
1. Read `tasks.json`. Keep tasks with `status: open` whose `deps` are all `done` (or `passes: true`) and whose lane is not claimed in `ownership.json`
2. Order: the person's interests first, then 🟣 and ⭐ tasks
3. Always add the open human-only ⭐ items from `docs/human-tasks.md` (even if they pick something else)
4. Show at most 8 numbered choices: id, title, one-line why, flags. Tell them they can also ask about any item

## 4. Claim
When they pick a task:
1. `node scripts/claim.mjs claim <person> <taskId>` (prints the branch name; refuses if taken or dependencies are unfinished)
2. If the lead was working on that task, stop. Push any work in progress to `lead/<taskId>`; never throw it away
3. Commit the changes to `tasks.json`, `ownership.json`, `docs/team.md` on a `lead/claim-<taskId>` branch and merge by pull request

## 5. Brief
1. Fill `docs/templates/brief.md` from the task card, the contracts it names, `fixtures/`, and the relevant lines of `docs/assumptions.md`. Plain words, bullets, numbered items. Keep the ⭐ box near the top. Keep "First time? Type /start" and "Get further information by typing /explain + item number" at the very top. End with "bigger picture". Section 4.1 repeats the task's `intent` word for word. Section 4.4 "Read these first" lists the task's `read_first` files (for example `docs/music-notes.md`) plus the contracts it names. Add the glossary line "Unknown word? Type `/explain glossary`". If the task card has a `progress` note, put it in section 1 ("what already exists") so the person builds on the skeleton instead of starting over
2. No getting-started steps in the brief; `/start` does that
3. Nothing private in a brief (briefs may be committed or emailed)
4. Save: `node scripts/comms-send.mjs briefs/<person>-<taskId>.md <file>`. Show it to the person; offer to email it

## W. Worker laptop
1. Do not claim anything yourself. Send a check-in request: `node scripts/comms-send.mjs comms/<person>-to-lead.md - --append` with the person's name, interests, OS and "checkin"
2. Tell the human: "Sent to the main laptop. Waiting for your menu." Then `node scripts/comms-read.mjs comms/lead-to-<person>.md --wait 600 --changed`
3. Show the menu; send their pick the same way; wait for `briefs/<person>-` with `node scripts/comms-read.mjs briefs/<person>- --wait 600`
4. Save the brief to `scratch/brief.md` so `/explain` can use it. Tell them: "Now type /start if this is your first time"
5. If the wait times out, say so and offer email (`[MUSIC] checkin`) or trying again
