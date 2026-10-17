// PreToolUse on Edit|Write|MultiEdit|NotebookEdit.
// Worker laptop (.claude/lane.local.json exists): only the person's owned folders may change.
// Main laptop (no lane file): the lead may edit lead files, but never a folder someone has claimed.
// This is an early warning; CI is the real gate. Fails closed: if unsure, it blocks and says why.
import { join } from 'node:path';
import { activeOverride, block, isSecretPath, loadJson, matchesAny, readInput, repoRoot, toRepoRelative } from './lib.mjs';

try {
  const input = readInput();
  const ti = input.tool_input || {};
  const target = ti.file_path ?? ti.notebook_path ?? ti.path;
  if (!target) {
    block(`Stopped to be safe: I can't tell which file this ${input.tool_name || 'edit'} changes. Try again, or use /ask if it keeps happening.`);
  }

  // Nobody's Claude writes into a secrets file: people type their own keys into it.
  if (isSecretPath(target)) {
    block(`"${String(target).replace(/\\/g, '/').split('/').pop()}" is a secrets file, so I won't write to it. Type your keys into it yourself; never paste them into chat.`);
  }

  const root = repoRoot(input);
  const rel = toRepoRelative(target, root, input.cwd);
  if (rel === null || rel === '') process.exit(0); // not a project file

  const ov = activeOverride(root);
  if (ov && matchesAny(rel, ov.allow_paths)) process.exit(0);

  const own = loadJson(join(root, 'ownership.json'), null);
  const lane = loadJson(join(root, '.claude', 'lane.local.json'), null); // throws if the file is broken
  const ALWAYS_OK = ['.claude/lane.local.json', '.claude/settings.local.json', '.claude/override.local.json', ...(own?.anyone || ['scratch/**'])];
  if (matchesAny(rel, ALWAYS_OK)) process.exit(0);

  if (lane) {
    if (matchesAny(rel, lane.owned_paths)) process.exit(0);
    const leadOnly = matchesAny(rel, own?.lead_only);
    const mine = (lane.owned_paths || []).join(', ') || '(none set)';
    block(
      leadOnly
        ? `"${rel}" is a lead-only file (contracts, tests, docs, CI, config). Use /ask to request the change, or say "override".`
        : `"${rel}" is not in your folders. Your folders: ${mine}. Use /ask to request access, or say "override".`,
    );
  }

  // Lead (main laptop): never touch a folder that a person has claimed until they hand it back.
  for (const [name, claim] of Object.entries(own?.claims || {})) {
    if (matchesAny(rel, own.lanes?.[name]?.paths)) {
      block(`"${rel}" belongs to ${claim.person} (branch ${claim.branch}) until they /handback. Ask them, or say "override".`);
    }
  }
  process.exit(0);
} catch (e) {
  block(`The folder guard hit an error (${e.message}), so I stopped to be safe. Nothing was changed. Tell the lead.`);
}
