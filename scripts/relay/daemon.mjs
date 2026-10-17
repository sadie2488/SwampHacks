#!/usr/bin/env node
// The always-on part of the email relay (main laptop only). Every few seconds it:
//   1. emails any question nobody answered at the keyboard within 3 minutes
//   2. reads new "[MUSIC]" emails from the allowed addresses and files them for the lead (answers, commands, confirmations)
// Start it in the background:  node scripts/relay/daemon.mjs        (add --once to check one time and exit)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './core.mjs';
import { loadConfig } from './lib.mjs';
import { FileStore } from './store.mjs';
import { explainMailError, makeGmail } from './transport.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const once = process.argv.includes('--once');
const stamp = () => new Date().toLocaleTimeString();
const log = (m) => console.log(`[${stamp()}] ${m}`);

let config;
try {
  config = loadConfig(join(root, 'relay.private.json'));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const store = new FileStore(process.env.RELAY_STATE_DIR || join(root, 'scratch', 'relay'));
const { transport, mailbox } = makeGmail(config);
const relay = createRelay({ config, store, transport, mailbox, log });

log(`email relay running as ${config.gmailAddress}; listening for ${config.allowed.length} allowed address(es); max ${config.maxPerHour} emails an hour`);
let delay = 15_000;
for (;;) {
  try {
    await relay.tick();
    delay = 15_000;
  } catch (e) {
    log(explainMailError(e));
    delay = 60_000; // be gentle after an error
    if (once) process.exit(1);
  }
  if (once) break;
  await new Promise((r) => setTimeout(r, delay));
}
