# 🤖 How the AI setup works (plain language)

Ask about any part with `/explain ai-setup`.

## The big picture
- **One main laptop** runs all the time. Its Claude is the "lead": it plans, hands out tasks, checks work, and merges it
- **Your laptop** runs its own Claude when you're working. It only works on the task you picked
- Everyone shares one GitHub repo. That's where code, tasks, and messages live

## Why there are rules
Four AIs editing one project at 4 AM can easily overwrite each other. The rules stop that:
- **Your own folders**: each task owns specific folders. You get a warning if you edit outside them
- **Your own branch**: your work lives on its own branch (a separate copy) until it's checked and merged
- **Locked files**: contracts, tests, and setup files are locked so nobody accidentally breaks everyone else
- **Automatic checks**: every pull request is checked for wrong folders, leaked keys, big files, and AI attribution lines

## Key ideas
- **Contracts** (`contracts/`): the agreed format for data passed between parts of the app. Example: what "hand position" data looks like. If everyone follows them, the parts fit together
- **Fake data** (`fixtures/`): sample data that follows the contracts, so you can build before other parts exist
- **Tests**: written in plain English first and approved by a human. Your Claude can't edit them, so "done" means really done
- **Brief**: the one-page guide you get when you check in
- **Update file**: what you leave behind with `/handback`, so the next person (or the main laptop) can continue

## Overrides
- You can override any rule. Your Claude will warn you first and explain what could break
- If you go ahead, it's logged and the main laptop is told, then everything is updated to match

## Saving Claude usage
- Each task starts a fresh session (less to re-read = cheaper and smarter)
- Claude reads only the files it needs
- Long jobs run in the background so Claude can keep answering you

## Email
- If the main laptop asks a question and nobody answers within 3 minutes, it's emailed out
- Replies count as answers. Commands also work by email. See `docs/email-relay.md`
