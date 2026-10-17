// Notification and Stop: when Claude is waiting for a person, note it for the email relay.
// If nobody types within 3 minutes, the relay daemon emails a heads-up. This hook only writes a small file;
// it never sends mail itself, never blocks, and always exits 0. It does nothing unless the relay is set up.
// Stop only counts when the last message asks a question or says NEEDS HUMAN (not every ordinary stop).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, repoRoot } from './lib.mjs';
import { createRelay } from '../../scripts/relay/core.mjs';
import { FileStore } from '../../scripts/relay/store.mjs';

try {
  const input = readInput();
  const root = repoRoot(input);
  if (!existsSync(join(root, 'relay.private.json'))) process.exit(0);

  let message = '';
  if (input.hook_event_name === 'Notification') message = String(input.message ?? 'Claude needs your input.');
  else if (input.hook_event_name === 'Stop') {
    const last = String(input.last_assistant_message ?? '').trim();
    if (!(last.endsWith('?') || /NEEDS HUMAN/i.test(last))) process.exit(0);
    message = last.split('\n').slice(-6).join('\n');
  } else process.exit(0);

  message = message.replace(/[A-Za-z0-9_\-]{32,}/g, '[hidden]').slice(0, 600); // never let a key-like string leave the machine
  const store = new FileStore(process.env.RELAY_STATE_DIR || join(root, 'scratch', 'relay'));
  const relay = createRelay({ config: { waitMinutes: 3 }, store, transport: null, mailbox: null });
  const open = Object.values(store.read('questions', {})).find((q) => q.kind === 'notify' && q.state === 'waiting' && q.question === message);
  if (!open) relay.notify(message);
} catch {
  /* never get in the way */
}
process.exit(0);
