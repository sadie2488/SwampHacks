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
| 15 | Sadie has added `VULTR_API_KEY` (restricted to the main laptop's IP) to `server/.env`; she may have added only the storage keys | Unconfirmed |
| 16 | The GoDaddy domain name is not known yet | Unconfirmed |
| 17 | The stray `@auth0/auth0-react` in the repo-root `package.json` came from Auth0's quickstart ("npm install @auth0/auth0-react@2.x") run in the wrong folder. It belongs in `web/package.json` and moves there when login is built | Assumed |
| 19 | Workers can't start helper agents because `/start` writes `permissions.deny: ["Agent"]` into the worker's own `.claude/settings.local.json` (the docs describe this rule; untested on a real worker laptop yet) | Per the docs |
| 20 | Auto mode is already the default starting mode in Claude Code 2.1.283+ (interactive terminal and VS Code); project settings can't set it, and teammates on older versions must launch with `claude --permission-mode auto` | Per the docs |
| 21 | `attribution.commit: ""` hides the co-author line (the docs say an empty string hides it). Not yet seen on a real worker laptop; the command guard and CI reject any AI credit either way | Per the docs |
| 22 | Claude Code installed with npm needs Node 22 or newer; the native installer has no such need. The project's own scripts only need Node 20 | Per the docs |
| 18 | Vultr credit math for the watcher: spent = 100 + account balance (negative means credit left) + pending charges. Field names `balance` and `pending_charges` come from Vultr's Go client; the official API page was unreachable, so the sign and the IP-restriction option for keys are unverified. Check the watcher's number against the Vultr dashboard once | Unconfirmed |
