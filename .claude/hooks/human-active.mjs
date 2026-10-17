// UserPromptSubmit: a person just typed something, so nobody needs a "waiting for you" email.
// Writes a timestamp for the email relay. Must never slow down or block typing: always exits 0.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, repoRoot } from './lib.mjs';

try {
  const dir = join(repoRoot(readInput()), 'scratch', 'relay');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'human.json'), JSON.stringify({ t: Date.now() }));
} catch {
  /* never get in the way */
}
process.exit(0);
