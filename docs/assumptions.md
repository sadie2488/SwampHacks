# 🤔 Assumptions log

Things decided without a confirmed answer. Anyone can correct one: tell the main laptop (`/ask`) and it's updated right away.

How assumptions are handled:
- Easy to undo → decide, log here, flag as "Assumed" in briefs
- Hard to undo or affects someone's work → ask first (emailed after 3 minutes with no answer)
- Never assumed: who you are, what you want to work on, anything with keys, accounts, or deleting work

| # | Assumption | Status |
|---|---|---|
| 1 | The main laptop has an NVIDIA GPU and webcam (can train models too) | Unconfirmed |
| 2 | Everyone runs the app in Chrome (needed for voice recognition and camera tests) | Unconfirmed |
| 3 | Pitch demo uses clarinet or trombone; guitar gets tempo-only feedback | Unconfirmed |
| 4 | Demo songs are public-domain or self-recorded | Unconfirmed |
| 5 | Practice uses headphones or a metronome; everything else plays on speakers | Unconfirmed |
| 6 | Feature freeze 3:00 AM Sunday | Unconfirmed |
| 7 | Briefs contain nothing private (they may be committed and emailed) | Unconfirmed |
| 8 | Only Veda edits the mapping file, unless someone overrides | Unconfirmed |
| 9 | Repo owner and merger is GitHub account `sadie2488` | Confirmed |
| 10 | The brief has no "getting started" section; `/start` gives the setup steps (the template's section 3 is "Hard rules") | Assumed |
| 11 | Claude Code's docs don't confirm the `MultiEdit` tool name or the notebook path field name; the folder guard handles both spellings and blocks if it can't find a path | Assumed |
| 12 | The "needs input" notification may not fire in the VS Code panel (docs are silent); run Claude in VS Code's integrated terminal | Unconfirmed |
| 13 | The GitHub CLI (`gh`) will be installed on the main laptop; the plan's pull requests, CI checks and merges depend on it | Unconfirmed |
| 14 | Project permission "allow" rules only take effect after each person accepts the folder-trust prompt; "deny" rules and hooks apply right away | Per the docs, untested |
