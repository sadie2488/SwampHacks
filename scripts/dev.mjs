#!/usr/bin/env node
// One command to run the whole app on this computer: the server, the website, and the TouchDesigner relay.
//   node scripts/dev.mjs              start all three
//   node scripts/dev.mjs --no-relay   skip the TouchDesigner relay
// Then open http://localhost:5173/  (add ?fake=1 to use made-up camera and microphone data).
// Press Ctrl+C to stop everything. Needs: npm ci in web/ and bridge/, and uv sync in server/ (the /start check tells you).
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const noRelay = process.argv.includes('--no-relay');
const children = [];
let stopping = false;

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, 'localhost');
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });

function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) out.write(`[${name}] ${l}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) console.log(`[${name}] stopped${code ? ` (exit ${code})` : ''}. ${name === 'server' ? 'Did you run "uv sync" inside the server folder?' : name === 'web' ? 'Did you run "npm ci" inside the web folder?' : 'Did you run "npm ci" inside the bridge folder?'}`);
  });
  children.push(child);
}

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (!c.pid || c.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
}
process.on('SIGINT', () => (stopAll(), process.exit(0)));
process.on('SIGTERM', () => (stopAll(), process.exit(0)));

const wanted = [['server', 8000], ['website', 5173], ...(noRelay ? [] : [['relay', 9980]])];
const busy = [];
for (const [name, port] of wanted) if (await portOpen(port)) busy.push(`${name} (port ${port})`);
if (busy.length) {
  console.error(`Already running on this computer: ${busy.join(', ')}. Stop that first (or close the other window), then try again.`);
  process.exit(1);
}

start('server', 'uv', ['run', 'uvicorn', 'app.main:app', '--port', '8000'], join(ROOT, 'server'));
start('web', process.execPath, [join(ROOT, 'web', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173', '--strictPort'], join(ROOT, 'web'));
if (!noRelay) start('relay', process.execPath, [join(ROOT, 'bridge', 'relay.mjs'), '--ws-port', '9980', '--log'], ROOT);

console.log('\nStarting. When it says "ready", open:  http://localhost:5173/');
console.log('No camera or microphone handy? Use:     http://localhost:5173/?fake=1');
console.log('Press Ctrl+C here to stop everything.\n');
await new Promise(() => {});
