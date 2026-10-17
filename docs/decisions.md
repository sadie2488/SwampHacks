# 📌 Decision log

Newest first. Only the main laptop writes here. Overrides by humans are logged here too.

| When | Decision | Why | Decided by |
|---|---|---|---|
| Sat 5:09 AM | CI runs its check scripts from the base branch, not from the pull request's copy | A branch must not be able to weaken the checks that judge it | Lead |
| Sat 5:05 AM | `.env` is private: git-ignored (tested), Claude blocked from reading or writing it by permissions and hooks, `.env.example` lists key names only, keys never in `VITE_` names | Safe place for API keys on a public repo | Lalitha |
| Sat 4:55 AM | Claude is never credited as a contributor on GitHub: settings turn off commit and PR credit lines, a hook blocks credit wording, CI rejects it in commits, authors, PR title and body | Team preference, extends the 3:38 AM no-attribution decision | Lalitha |
| Sat 4:33 AM | Plan locked (see `docs/plan.md`) | Planning complete | Team |
| Sat 4:28 AM | Email relay sends from Sadie's Gmail to 3 team addresses (kept in a private local file, not in this repo) | Avoid a separate account | Lalitha |
| Sat 4:22 AM | Create mode is in scope; Veda owns command design for play + create and may change any design detail of her part | Veda will design commands | Lalitha |
| Sat 3:38 AM | No AI attribution or tool credits in commits, PRs, or docs | Team preference | Lalitha |
| Sat 3:36 AM | Agents never write the tests that grade their own work; humans approve tests | Agent-written tests mirror the agent's own mistakes | Lead + research |
| Sat 3:36 AM | Folder ownership enforced by CI (hooks are early warnings only) | Hooks can be bypassed and fail open | Lead + research |
| Sat 3:00 AM | Repo is public | Free branch protection needs a public repo | Lalitha |
| Sat 2:45 AM | Pretrained models first (basic-pitch etc.), then our own PyTorch model swapped in if it beats the baseline | Working product is top priority | Lalitha |
| Sat 2:45 AM | Sponsors: Gemini, Tiger Data, Vultr, GoDaddy, Auth0 (Auth0 last, switchable) | Prize eligibility | Lalitha |
