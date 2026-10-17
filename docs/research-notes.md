# Research notes (condensed, for the lead)

Source of the rules in `build-spec.md`. Practitioner sources (ECC hackathon winner, Kun Chen) were weighted higher when sources disagreed.

## ECC (github.com/affaan-m/ECC, MIT, from an Anthropic hackathon winner): copy specific files, never install whole
- **Worker lane contract** (`docs/LANE-RULES.md`): one task → one branch → one PR or receipt, then stop. If blocked, stop and say exactly what's needed; don't wait/poll/sleep; don't spawn subagents. Receipt ≤ 300 words
- **Progress format** (`commands/save-session.md`): what worked (with evidence) · what didn't + why · not yet tried · decisions · blockers · exact next step
- **Config-protection hook** (`scripts/hooks/config-protection.js`): block edits to lint/format configs (agents edit them "to make checks pass"). Extend to `tests/`, `contracts/`, `.github/`
- **No-verify blocker** (`scripts/hooks/block-no-verify.js`): block `--no-verify` and `core.hooksPath` overrides
- **Hook hygiene** (`docs/hook-bug-workarounds.md`): read stdin first, quiet stdout, messages to stderr, exit 0 allow / 2 block, restart session after editing hooks
- **Anti-template design rule** (`rules/web/design-quality.md` + `scripts/hooks/design-quality-check.js`): bans uniform card grids, centered hero + gradient blob, default fonts, "safe gray-on-white", "Get Started/Learn more" copy. Give to the design lane
- **Contract-first** (`skills/contract-first/SKILL.md`): one machine-checkable schema per boundary
- **Reviewer** (`agents/code-reviewer.md`): only report issues > 80% confident
- **Verification loop** (`skills/verification-loop/SKILL.md`): build, types, lint, tests, secrets grep, diff, each trimmed with `tail`, ends READY / NOT READY
- **PyTorch fixer** (`agents/pytorch-build-resolver.md`) for the ML lane
- Cautions: full plugin + default hooks are heavy; GateGuard roughly doubles turns (`ECC_GATEGUARD=off`); `CLAUDE_CODE_SUBAGENT_MODEL=haiku` would make worker task-agents code with Haiku, so don't set it on workers; skip `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`

## Kun Chen (github.com/kunchenguid; ex-Meta/Microsoft/Atlassian principal eng.), likely the "Ken Chen" mentioned
- Opinions: `kunchenguid/kun/OPINIONS.md`. Brief template: `kunchenguid/firstmate/AGENTS.md` §9–11 (captain's intent verbatim + explicit out-of-scope; reviewer uses intent as acceptance criteria)
- Banning agent-written tests slightly *raised* success in his eval → humans author/approve gating tests; prefer end-to-end tests
- Always-loaded memory ≤ ~5k tokens; procedures go in skills; prune memory instead of appending
- Orchestrator never edits project code, never merges without the human's word (we use tiered merges instead), never discards unlanded work
- Escalations: evidence → consequence → recommendation. Make reversible calls yourself; escalate subjective/risky ones
- Workers verify placement first (`git rev-parse --show-toplevel`, current branch ≠ main) and stop "blocked" if wrong
- Zero-token watcher that wakes the lead only when something needs action
- Tools worth considering: `gh-axi` (token-cheap gh wrapper), `quota-axi` (`npx -y quota-axi`, shows remaining Claude quota). Skip firstmate (needs tmux, one machine) and no-mistakes
- AXI tool-design principles for our scripts: compact output, few fields, truncation with `--full`, explicit "0 results", structured errors with next-step hints

## Agentic-coding best practices (Anthropic, OpenAI, Fowler, Cognition, Cursor, Hamel Husain, Simon Willison)
- Harness: short entry file pointing to docs; errors that say how to fix; turn repeatedly-ignored doc rules into checks; pair guides (rules) with sensors (deterministic checks) run early
- Orchestration: map-reduce-and-manage; writes stay single-threaded per area; children don't report back unless told; integrator roles become bottlenecks (Cursor) → workers rebase/resolve their own conflicts
- Context: smallest high-signal context; just-in-time file reads; subagents return 1–2k-token summaries; context rot hits every model; `/clear` after two failed corrections
- Memory: JSON task list with pass flags + progress log + commit every session; CLAUDE.md < 200 lines (imports don't save context); auto memory is per-machine → disable on workers; boundaries said only in chat can be lost to compaction → use deny rules
- Guardrails: auto mode drops broad allow rules, misses ~17% of overeager actions, and reverts to prompting after 3 consecutive / 20 total blocks; `.env` deny rules don't stop scripts (OS sandbox does, WSL2-only on Windows); hooks fail open by default; lethal trifecta = private data + untrusted content + a way out
- Loops: `/goal <condition>` (main session only, not inside subagents); Stop/SubagentStop hooks as deterministic gates (Claude Code overrides after 8 consecutive blocks)
- Evals: 20–50 tasks from real failures; grade outcomes; pass^k for demo reliability; binary judges validated against human labels; read ~30 traces first
- Human-in-the-loop: humans mostly interrupt to add context; sort escalations into notify / question / review
- Observability: OTel (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) optional; `/usage` usually enough; Monitor tool (event-driven, silent = zero tokens) instead of `/loop` polling; Monitor has a max timeout and needs Git Bash on Windows

## Repos evaluated
- Use partially: ponytail (just its "reuse before writing" idea, 3 lines in CLAUDE.md) · superpowers (lead only: systematic-debugging, verification-before-completion) · Trail of Bits claude-code-config (ideas only, no license: block push to main / rm -rf, credential denies, anti-rationalization Stop hook; rewrite in Node) · ui-ux-pro-max (design lane only, for contrast/accessibility checks, not for choosing the look)
- Skip: spec-kit, taskmaster, serena (duplicate our contracts/tasks.json or cost too many tokens) · Understand Anything (maybe one architecture visual at the end) · Strix ("stri"?)

## Token rules
- Cache reads cost ~1/10 of input; switching model/effort, editing CLAUDE.md, or adding MCP servers mid-session breaks the cache; > 5 min idle expires it
- Only give MCP servers to agents that need them (Playwright for the frontend/design lane only); prefer CLIs (`gh`) over MCP
- Lower effort for routine work; bounded reads; exact file paths in briefs

## Known Claude Code quirks
- "Needs input" Notification hook doesn't fire in the VS Code extension panel (Stop hook does) → run Claude in the integrated terminal
- No hook fires when Claude asks an on-screen question → route questions through the `ask-human` script
- Headless `claude -p` and the GitHub Action reportedly no longer draw from subscriptions (third-party report) → don't build the workflow on them
- Claude Code can auto-continue after a usage-limit reset (desktop setting / `/rate-limit-options`); laptop must stay awake
