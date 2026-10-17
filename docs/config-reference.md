# Claude Code config reference (checked against official docs, Sat Oct 17)

For the lead when writing `.claude/` files. "UNVERIFIED" = not confirmed from the docs; check the linked page before relying on it.

## Lead notes: what we did with this (Sat ~6:40 AM)
- Attribution: `.claude/settings.json` sets `attribution.commit` and `attribution.pr` to `""` and `attribution.sessionUrl` to `false` (the docs say an empty string hides each line). On top of that: the `bash-guard` hook blocks any commit/PR text with AI credit before it runs, and CI rejects it in commits, authors, PR title and body
- Hooks: all written in Node; guards use `onFailure: "block"`; timeout raised to 30 s; `setup/setup-check` now checks Claude Code is at least 2.1.295
- `defaultMode: "auto"` is NOT set in project settings (it would be ignored). `/start` tells each person how to launch in auto mode
- Workers must not spawn helper agents: `/start` writes `permissions.deny: ["Agent"]` into the worker's own `.claude/settings.local.json` (verified in the docs: a bare `Agent` rule blocks all subagents; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` only turns nesting off). The lead's laptop has no such file, so its helpers still work
- Rules files use `paths:` frontmatter exactly as shown below; skills use the frontmatter keys below

## Corrections to earlier assumptions
- **`defaultMode: "auto"` does NOT work from project `.claude/settings.json`** (nor `bypassPermissions`). Each laptop sets auto mode itself: launch with `claude --permission-mode auto` or set it in the user's own settings. Put this in `/start` and the lead's own launch command
- **Subagents CAN spawn subagents** (up to 3 levels). To stop workers' helpers nesting: `Agent` in `disallowedTools`, or env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`
- Project-level subagent hooks are skipped until the folder is **trusted**: accept the trust prompt on each laptop
- Auto memory: use `{ "autoMemoryEnabled": false }` in project settings (documented). Env `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` also exists

## Attribution: https://code.claude.com/docs/en/settings-reference#attribution
- Keys: `attribution.commit`, `attribution.pr`, `attribution.sessionUrl`; `includeCoAuthoredBy` is deprecated. Scope: any settings file (project works)
- `includeGitInstructions` removes the built-in commit/PR instructions from context
- UNVERIFIED: exact value that hides the line (likely empty string): read the anchor, then test with one commit
- Backstop regardless: CI check rejecting attribution text in commit messages and PR bodies

## Hooks: https://code.claude.com/docs/en/hooks
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [ { "type": "command",
          "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/scope-guard.mjs\"",
          "timeout": 30, "onFailure": "block" } ] },
      { "matcher": "Bash",
        "hooks": [ { "type": "command",
          "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/bash-guard.mjs\"",
          "timeout": 30, "onFailure": "block" } ] }
    ],
    "Stop": [ { "hooks": [ { "type": "command", "command": "..." } ] } ],
    "SubagentStop": [ { "matcher": "<agent-type>", "hooks": [ { "type": "command", "command": "..." } ] } ],
    "Notification": [ { "matcher": "permission_prompt|idle_prompt", "hooks": [ { "type": "command", "command": "..." } ] } ],
    "SessionStart": [ { "matcher": "startup|resume", "hooks": [ { "type": "command", "command": "..." } ] } ]
  }
}
```
- `onFailure: "block"` (fail closed) needs Claude Code **v2.1.295+**; default is continue; no effect on Stop/SubagentStop. Setup check should verify the version
- Default hook timeout 600 s. `if` field filters tool events (e.g. `"if": "Edit(*.ts)"`)
- Stop has no matcher. SubagentStop matches agent type. SessionStart matchers: startup, resume, clear, compact, fork
- Stdin: session_id, transcript_path, cwd, permission_mode, hook_event_name (+ agent_id, agent_type inside subagents); PreToolUse adds tool_name, tool_input (`file_path` for Read/Edit/Write, `command` for Bash), tool_use_id. Stop/SubagentStop: `last_assistant_message`
- **PreToolUse fires for subagent tool calls** (confirmed)
- Exit 0 = OK (stdout JSON parsed if one object) · **exit 2 = block, stderr is the reason** · other = non-blocking error (so never rely on exit 1)
- JSON deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` (values allow/deny/ask/defer). Stop/SubagentStop block: top-level `{"decision":"block","reason":"..."}`
- `${CLAUDE_PROJECT_DIR}` = project root; quote it in shell form
- **Windows**: hooks run in Git Bash by default, PowerShell only if Git Bash is missing; force with `"shell": "powershell"`. Calling `node "...mjs"` works in both → install Git for Windows + Node on every laptop
- Hooks are enforcement; CLAUDE.md is context only

## Permissions: https://code.claude.com/docs/en/permissions
- Order: deny → ask → allow; first match wins
- File rules: `Read(./.env)`, `Read(~/secrets/**)`, `Edit(/src/**)`. A Read deny also blocks Edit/Write on that path. UNVERIFIED: `Read(**/.env*)`: test with `/permissions`
- Bash: `Bash(npm run build)` exact, `Bash(npm run *)`, `Bash(git push *)`. Compound commands are split on `&& || ; | &` and newlines; wrappers (timeout, nohup, xargs…) are stripped
- `WebFetch(domain:example.com)`
- Modes: default, acceptEdits, plan, auto, dontAsk, bypassPermissions (auto/bypass not settable in project settings)

## Skills (our slash commands): https://code.claude.com/docs/en/skills
- Use `.claude/skills/<name>/SKILL.md` (recommended; `.claude/commands/<name>.md` still works; skill wins on name clash)
- Frontmatter: `name`, `description`, `argument-hint`, `disable-model-invocation: true` (user-only: use for /checkin, /handback, /start), `user-invocable`, `allowed-tools` (space-separated), `model`, `effort`, `paths`, `hooks`
- `$ARGUMENTS` = text after the command; `$1`/`$ARGUMENTS[N]` for positional; no placeholder → appended as `ARGUMENTS: ...`

## Subagents: https://code.claude.com/docs/en/sub-agents
- `.claude/agents/<name>.md`; required `name`, `description`; optional `tools`, `disallowedTools`, `model` (sonnet/opus/haiku/fable/inherit/full ID), `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation: worktree`, `initialPrompt`
- Pin `model: sonnet` on worker task agents

## Monitor tool: https://code.claude.com/docs/en/tools-reference#monitor-tool
- Watch deadline: default 5 min, max 30 min (10 min under `claude -p`); one notice at the deadline → re-arm
- Same permission rules as Bash
- Disabled if `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set
- UNVERIFIED: minimum version and Windows requirements

## Rules files: https://code.claude.com/docs/en/memory
- Nested `CLAUDE.md` loads on demand; root CLAUDE.md re-injected after /compact
- `.claude/rules/*.md` scoped with frontmatter:
```markdown
---
paths:
  - "web/src/modules/vision/**"
---
# rules for the vision folder
```
- Without `paths:` → loads at session start
