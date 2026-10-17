// PreToolUse on Read. Keys and passwords are never read into the chat.
import { activeOverride, block, globTargetsSecret, isSecretPath, readInput, repoRoot, ruleAllowed } from './lib.mjs';

// Covers the Read tool (file_path) and the Grep tool (path, glob): neither may open a secrets file.
try {
  const input = readInput();
  const ti = input.tool_input || {};
  const named = [ti.file_path, ti.path].filter(Boolean);
  const hit = named.find((p) => isSecretPath(p)) ?? [ti.glob, ...named].filter(Boolean).find((g) => input.tool_name === 'Grep' && globTargetsSecret(g));
  if (hit && !ruleAllowed(activeOverride(repoRoot(input)), 'read-secrets')) {
    const base = String(hit).replace(/\\/g, '/').split('/').pop();
    block(`"${base}" holds secrets, so I won't read it. Type keys yourself into the private file; never paste them into chat. (.env.example is fine to read.)`);
  }
  process.exit(0);
} catch (e) {
  block(`The secrets guard hit an error (${e.message}), so I stopped to be safe. Tell the lead.`);
}
