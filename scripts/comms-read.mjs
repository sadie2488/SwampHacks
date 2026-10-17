#!/usr/bin/env node
// Read a message from the `comms` branch, optionally waiting for it to appear or change.
// Usage: node scripts/comms-read.mjs <path-or-prefix> [--list] [--wait <seconds>] [--changed]
//   <path-or-prefix>  exact file (comms/lead-to-sadie.md) or a prefix (briefs/sadie-)
//   --list            print matching file names only
//   --wait N          keep checking every 15 s for up to N seconds
//   --changed         with --wait: only return once a match is new or different from now
// Exit codes: 0 found, 3 nothing yet (timed out), 1 error.
import { execFileSync } from 'node:child_process';

const fail = (msg, fix) => {
  console.error(`comms-read: ${msg}`);
  if (fix) console.error(`  fix: ${fix}`);
  process.exit(1);
};
const run = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tryRun = (...args) => {
  try {
    return run(...args).trim();
  } catch {
    return null;
  }
};

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const listOnly = flag('--list');
const changed = flag('--changed');
const wi = argv.indexOf('--wait');
const waitSecs = wi >= 0 ? Number(argv.splice(wi, 2)[1]) || 0 : 0;
const [prefix] = argv;
if (!prefix) fail('missing path', 'node scripts/comms-read.mjs <path-or-prefix> [--list] [--wait seconds] [--changed]');

const top = tryRun('rev-parse', '--show-toplevel');
if (!top) fail('not inside the project folder', 'cd into the SwampHacks folder first');
process.chdir(top);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const REF = 'origin/comms';

function snapshot() {
  if (tryRun('fetch', '-q', 'origin', 'comms') === null && tryRun('rev-parse', '--verify', REF) === null) return null;
  const names = tryRun('ls-tree', '-r', '--name-only', REF);
  if (names === null) return null;
  return names
    .split('\n')
    .filter((n) => n && n.startsWith(prefix))
    .map((n) => ({
      name: n,
      blob: tryRun('rev-parse', `${REF}:${n}`),
      time: Number(tryRun('log', '-1', '--format=%ct', REF, '--', n)) || 0,
    }))
    .sort((a, b) => b.time - a.time);
}

const baseline = changed ? new Map((snapshot() || []).map((f) => [f.name, f.blob])) : new Map();
const deadline = Date.now() + waitSecs * 1000;
for (;;) {
  const files = snapshot();
  const fresh = (files || []).filter((f) => !changed || baseline.get(f.name) !== f.blob);
  if (fresh.length) {
    if (listOnly) {
      console.log(fresh.map((f) => f.name).join('\n'));
    } else {
      const f = fresh[0];
      console.log(`# ${f.name}\n`);
      console.log(run('show', `${REF}:${f.name}`));
    }
    process.exit(0);
  }
  if (Date.now() >= deadline) {
    console.error(files === null ? 'comms-read: no messages yet (the comms branch does not exist)' : 'comms-read: nothing matching yet');
    process.exit(3);
  }
  sleep(15000);
}
