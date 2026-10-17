---
paths:
  - ".claude/**"
  - ".github/**"
  - "scripts/**"
  - "setup/**"
---
# Lead-only files: hooks, CI, scripts, setup

- Hooks are written in Node (`.mjs`), not bash (Windows). Read stdin first, keep stdout quiet, send messages to stderr, exit 2 to block
- Hook messages name the fix ("not your folder - use /ask to request it, or say 'override'")
- Hooks are early warnings. CI is the real gate for ownership, secrets, attribution, and file size
- Scripts print short output; errors say how to fix them
- Test a hook by piping a sample JSON into it (`node scripts/hook-selftest.mjs`) before relying on it. A broken fail-closed hook blocks every edit
- No AI attribution or tool credits in any file, commit message, or PR text
