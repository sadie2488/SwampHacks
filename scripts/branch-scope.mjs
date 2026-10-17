#!/usr/bin/env node
// Lead tool: did a helper's branch stay inside its lane? Lists every file the branch changed (since it left main)
// that is outside the given lanes' folders from ownership.json.
// Usage: node scripts/branch-scope.mjs <branch> <lane> [<lane> ...]      Exit 1 if anything is outside.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesAny } from '../.claude/hooks/lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [branch, ...lanes] = process.argv.slice(2);
if (!branch || !lanes.length) {
  console.error('usage: node scripts/branch-scope.mjs <branch> <lane> [<lane> ...]');
  process.exit(2);
}
const own = JSON.parse(readFileSync(join(root, 'ownership.json'), 'utf8'));
const paths = lanes.flatMap((l) => {
  if (!own.lanes[l]) {
    console.error(`unknown lane "${l}" (lanes: ${Object.keys(own.lanes).join(', ')})`);
    process.exit(2);
  }
  return own.lanes[l].paths;
});
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const files = git('diff', '--name-status', '--no-renames', `main...${branch}`).split('\n').filter(Boolean).map((l) => {
  const [status, ...p] = l.split('\t');
  return { status, path: p.join('\t') };
});
const outside = files.filter((f) => !matchesAny(f.path, paths));
console.log(`${branch}: ${files.length} file(s) changed, ${files.length - outside.length} inside [${lanes.join(', ')}]`);
for (const f of outside) console.log(`  OUTSIDE  ${f.status}  ${f.path}`);
process.exit(outside.length ? 1 : 0);
