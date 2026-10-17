#!/usr/bin/env node
// Runs every automatic check at the same time and prints one short table. Much faster than running them one by one.
//   node scripts/check.mjs             all the quick checks (about a minute)
//   node scripts/check.mjs --build     also build the website
//   node scripts/check.mjs --e2e       also run the real-Chrome test afterwards (starts and stops the servers itself)
//   node scripts/check.mjs web server  only those groups (groups: root hooks contracts web server relay)
// Exit code 0 = everything passed. A failing check prints the end of its own output so you can see why.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const only = args.filter((a) => !a.startsWith('--'));
const node = process.execPath;
const web = join(ROOT, 'web');
const bin = (pkg, file) => join(web, 'node_modules', pkg, file);

// group, label, command, args, folder
const JOBS = [
  ['root', 'Project tests (CI checks, relay, vultr, secrets)', node, ['--test', 'tests/**/*.test.mjs'], ROOT],
  ['hooks', 'Safety hooks self-test', node, ['scripts/hook-selftest.mjs'], ROOT],
  ['contracts', 'Contracts and fake data', node, ['scripts/validate-contracts.mjs'], ROOT],
  ['web', 'Website types', node, [bin('typescript', 'bin/tsc'), '--noEmit'], web],
  ['web', 'Website unit tests', node, [bin('vitest', 'vitest.mjs'), 'run'], web],
  ['server', 'Server lint', 'uv', ['run', '--quiet', 'ruff', 'check', '.'], join(ROOT, 'server')],
  ['server', 'Server tests', 'uv', ['run', '--quiet', 'pytest', '-q'], join(ROOT, 'server')],
  ['relay', 'TouchDesigner relay tests', node, ['--test'], join(ROOT, 'bridge')],
  ['relay', 'TouchDesigner relay self-test', node, ['relay.mjs', '--selftest'], join(ROOT, 'bridge')],
];
if (flags.has('--build')) JOBS.push(['web', 'Website build', node, [bin('vite', 'bin/vite.js'), 'build'], web]);

const picked = JOBS.filter((j) => !only.length || only.includes(j[0]));
if (!picked.length) {
  console.error(`No such group. Groups: ${[...new Set(JOBS.map((j) => j[0]))].join(', ')}`);
  process.exit(2);
}

const run = ([group, label, cmd, cmdArgs, cwd]) =>
  new Promise((resolve) => {
    const t0 = Date.now();
    let out = '';
    const child = spawn(cmd, cmdArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ group, label, ok: false, secs: 0, out: `could not start: ${e.message}` }));
    child.on('close', (code) => resolve({ group, label, ok: code === 0, secs: (Date.now() - t0) / 1000, out }));
  });

const started = Date.now();
console.log(`Running ${picked.length} checks at the same time ...`);
const results = await Promise.all(picked.map(run));
console.log('');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.secs.toFixed(0).padStart(3)}s  ${r.label}`);
const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  console.log(`\n--- ${r.label}: last lines ---`);
  console.log(r.out.trim().split('\n').slice(-25).join('\n'));
}
console.log(`\n${failed.length ? `${failed.length} FAILED` : 'ALL PASSED'} in ${((Date.now() - started) / 1000).toFixed(0)}s`);

let code = failed.length ? 1 : 0;
if (flags.has('--e2e') && !failed.length) {
  console.log('\nNow the real-Chrome test ...');
  const e2e = spawn(node, ['scripts/e2e.mjs'], { cwd: ROOT, stdio: 'inherit' });
  code = await new Promise((r) => e2e.on('close', (c) => r(c ?? 1)));
}
process.exit(code);
