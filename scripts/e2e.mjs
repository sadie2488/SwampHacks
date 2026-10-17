#!/usr/bin/env node
// Starts the server, the website and the TouchDesigner relay, runs the browser test (tests/e2e/skeleton.e2e.mjs)
// in a real Chrome, then shuts everything down. Uses made-up camera and mic data, so no hardware is needed.
// Usage: node scripts/e2e.mjs [--keep]      (--keep leaves the servers running afterwards)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const children = [];

function start(name, cmd, args, cwd, env = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let tail = '';
  const keepTail = (d) => (tail = (tail + d).slice(-1500));
  child.stdout.on('data', keepTail);
  child.stderr.on('data', keepTail);
  child.on('exit', (code) => {
    if (!stopping && code) console.log(`[${name}] stopped early (exit ${code}). Last output:\n${tail}`);
  });
  children.push(child);
  return child;
}
let stopping = false;
function stopAll() {
  stopping = true;
  for (const c of children) {
    if (!c.pid || c.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else {
      try {
        process.kill(c.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
}
const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });
async function waitForPort(name, port, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${name} did not start on port ${port} within ${ms / 1000} s`);
}

process.on('SIGINT', () => (stopAll(), process.exit(130)));
try {
  const busy = [];
  for (const [name, port] of [['server', 8000], ['website', 5173], ['relay', 9980]]) if (await portOpen(port)) busy.push(`${name} (port ${port})`);
  if (busy.length) throw new Error(`These are already running, so I won't start another copy: ${busy.join(', ')}. Stop them first, or run the test directly: node --test tests/e2e/skeleton.e2e.mjs`);

  const dataDir = mkdtempSync(join(tmpdir(), 'music-e2e-data-'));
  console.log('starting the server, the website and the relay ...');
  start('server', 'uv', ['run', 'uvicorn', 'app.main:app', '--port', '8000'], join(ROOT, 'server'), { MUSIC_DATA_DIR: dataDir });
  start('website', process.execPath, [join(ROOT, 'web', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173', '--strictPort'], join(ROOT, 'web'));
  start('relay', process.execPath, [join(ROOT, 'bridge', 'relay.mjs'), '--ws-port', '9980', '--osc-port', '7000'], ROOT);
  await Promise.all([waitForPort('server', 8000), waitForPort('website', 5173), waitForPort('relay', 9980)]);
  console.log('all three are up. running the browser test ...\n');

  const run = spawnSync(process.execPath, ['--test', '--test-reporter=spec', join(ROOT, 'tests', 'e2e', 'skeleton.e2e.mjs')], { cwd: ROOT, stdio: 'inherit' });
  if (keep && run.status === 0) {
    console.log('\nleaving the servers running (press Ctrl+C to stop them): website http://localhost:5173');
    await new Promise(() => {});
  }
  stopAll();
  process.exit(run.status ?? 1);
} catch (e) {
  console.error(`\nend-to-end run failed: ${e.message}`);
  stopAll();
  process.exit(1);
}
