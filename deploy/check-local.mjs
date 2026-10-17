#!/usr/bin/env node
// A check you can run on any computer with Node, no server needed:  node deploy/check-local.mjs
// It reads the files in deploy/ and prints PASS or FAIL for each thing. It changes nothing, calls no
// network, and never prints a value from an env file (only the NAMES in .env.example).
// It cannot prove the files work on a real server; it catches typos and drift between the files.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let failures = 0;
const pass = (m) => console.log(`PASS: ${m}`);
const fail = (m) => {
  failures += 1;
  console.log(`FAIL: ${m}`);
};
const skip = (m) => console.log(`SKIP: ${m}`);
const check = (ok, m) => (ok ? pass(m) : fail(m));

const readHere = (name) => readFileSync(join(here, name), 'utf8');
const stripComments = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
const includesAll = (text, parts) => parts.every((p) => text.includes(p));

const files = ['README.md', 'setup.sh', 'update.sh', 'swamphacks-server.service', 'Caddyfile', 'check-local.mjs'];
for (const f of files) check(existsSync(join(here, f)), `deploy/${f} exists`);
if (failures > 0) {
  console.log('\nSome files are missing, so the other checks are skipped.');
  process.exit(1);
}

const texts = Object.fromEntries(files.map((f) => [f, readHere(f)]));
const caddy = stripComments(texts['Caddyfile']);
const unit = stripComments(texts['swamphacks-server.service']);
const setup = texts['setup.sh'];
const update = texts['update.sh'];
const readme = texts['README.md'];

// ---- (a) shell scripts parse -----------------------------------------------------------------
function findBash() {
  const candidates = ['bash'];
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe');
  }
  for (const c of candidates) {
    const r = spawnSync(c, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (r.status === 0 && (r.stdout || '').trim() === 'ok') return c;
  }
  return null;
}
const bash = findBash();
for (const script of ['setup.sh', 'update.sh']) {
  if (!bash) {
    skip(`bash -n ${script} (no working bash on this computer)`);
    continue;
  }
  const r = spawnSync(bash, ['-n', script], { cwd: here, encoding: 'utf8' });
  check(r.status === 0, `bash -n ${script} (syntax)${r.status === 0 ? '' : ': ' + (r.stderr || '').trim()}`);
}
for (const script of ['setup.sh', 'update.sh']) {
  check(!texts[script].includes('\r'), `${script} uses plain line endings (no carriage returns)`);
  check(/^set -euo pipefail$/m.test(texts[script]), `${script} sets -euo pipefail`);
  check(texts[script].startsWith('#!/usr/bin/env bash'), `${script} starts with a bash shebang`);
}

// ---- (b) the key lines are there -------------------------------------------------------------
// Caddyfile
check(/^example\.com \{/m.test(caddy), 'Caddyfile: site address is the example.com placeholder');
check(caddy.includes('reverse_proxy 127.0.0.1:8000'), 'Caddyfile: proxies to 127.0.0.1:8000');
check(/handle \/api\/\*/.test(caddy), 'Caddyfile: only /api/* goes to the server');
check(caddy.includes('try_files {path} /index.html'), 'Caddyfile: single-page-app fallback to index.html');
check(caddy.includes('root * /opt/swamphacks/app/web/dist'), 'Caddyfile: serves web/dist from the app folder');
check(/encode zstd gzip/.test(caddy), 'Caddyfile: compression is on');
check(
  (caddy.match(/\{/g) ?? []).length === (caddy.match(/\}/g) ?? []).length,
  'Caddyfile: curly braces are balanced',
);
check(/camera=\(self\)/.test(caddy) && /microphone=\(self\)/.test(caddy), 'Caddyfile: Permissions-Policy keeps camera and microphone allowed');
check(/Strict-Transport-Security/.test(caddy) && /X-Content-Type-Options/.test(caddy), 'Caddyfile: has HSTS and nosniff headers');

const csp = caddy.match(/Content-Security-Policy(-Report-Only)?\s+"([^"]+)"/);
check(Boolean(csp), 'Caddyfile: has a Content Security Policy header');
if (csp) {
  pass(`Caddyfile: CSP mode is ${csp[1] ? 'REPORT-ONLY (warns, blocks nothing)' : 'ENFORCED'}`);
  const policy = csp[2];
  check(includesAll(policy, ["'wasm-unsafe-eval'", "worker-src 'self' blob:"]), 'Caddyfile: CSP allows WebAssembly and blob workers');
  // Every web address the camera module downloads from must be allowed to connect.
  const protocolPath = join(root, 'web', 'src', 'modules', 'vision', 'protocol.ts');
  if (existsSync(protocolPath)) {
    const hosts = [...new Set([...readFileSync(protocolPath, 'utf8').matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]))];
    const missing = hosts.filter((h) => !policy.includes(`https://${h}`));
    check(hosts.length > 0 && missing.length === 0, `Caddyfile: CSP allows the camera module's download hosts (${hosts.join(', ') || 'none found'})${missing.length ? '; missing: ' + missing.join(', ') : ''}`);
  } else {
    skip('Caddyfile: camera module protocol.ts not found');
  }
}

// Upload size: Caddy's limit must be above the server's own limit.
const configPath = join(root, 'server', 'app', 'config.py');
const configText = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
const serverLimit = configText.match(/MAX_UPLOAD_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
const caddyLimit = caddy.match(/max_size\s+(\d+)\s*(MB|MiB)/i);
if (serverLimit && caddyLimit) {
  const serverBytes = Number(serverLimit[1]) * 1024 * 1024;
  const caddyBytes = Number(caddyLimit[1]) * (caddyLimit[2].toLowerCase() === 'mib' ? 1024 * 1024 : 1_000_000);
  check(caddyBytes > serverBytes, `Caddyfile: upload limit (${caddyLimit[1]}${caddyLimit[2]}) is above the server's own ${serverLimit[1]} MiB limit`);
} else {
  fail('Caddyfile: could not compare the upload limit with MAX_UPLOAD_BYTES in server/app/config.py');
}

// Service file
check(unit.includes('EnvironmentFile=/etc/swamphacks/server.env'), 'service: reads keys from /etc/swamphacks/server.env');
const execStart = (unit.match(/^ExecStart=(.*)$/m) ?? [])[1] ?? '';
check(execStart.includes('--host 127.0.0.1') && execStart.includes('--port 8000') && execStart.includes('app.main:app'), 'service: uvicorn app.main:app on 127.0.0.1:8000');
check(!/0\.0\.0\.0/.test(unit), 'service: never listens on 0.0.0.0');
check(execStart.startsWith('/opt/swamphacks/app/server/.venv/bin/uvicorn'), 'service: runs uvicorn from the server virtual environment');
check(/^User=swamphacks$/m.test(unit), 'service: runs as the swamphacks user');
check(/^Restart=on-failure$/m.test(unit), 'service: restarts on failure');
check(/^NoNewPrivileges=true$/m.test(unit) && /^PrivateTmp=true$/m.test(unit), 'service: NoNewPrivileges and PrivateTmp are on');
check(
  /^Environment=MUSIC_DATA_DIR=\/var\/lib\/swamphacks\//m.test(unit) && /^StateDirectory=swamphacks$/m.test(unit) && /^ProtectSystem=strict$/m.test(unit),
  'service: data folder is inside the one writable state folder (ProtectSystem=strict is safe)',
);
check(!/MemoryDenyWriteExecute=true/.test(unit), 'service: MemoryDenyWriteExecute is not on (the audio library needs it off)');

// The three files agree with each other
check(/^APP_DIR=\$APP_HOME\/app$/m.test(setup) && /^APP_HOME=\/opt\/swamphacks$/m.test(setup), 'setup.sh: app folder is /opt/swamphacks/app (same as the service and Caddyfile)');
check(caddy.includes('127.0.0.1:8000') && execStart.includes('--host 127.0.0.1 --port 8000'), 'Caddyfile and service use the same address (127.0.0.1:8000)');

// setup.sh
check(/^REPO_URL="\$\{REPO_URL:-https:\/\/github\.com\/sadie2488\/SwampHacks\.git\}"/m.test(setup), 'setup.sh: repository address is a variable at the top, default sadie2488/SwampHacks');
check(/id -u/.test(setup) && /must run as root/i.test(setup), 'setup.sh: refuses to run if not root');
check(/ubuntu/.test(setup) && /\$os_id" = "ubuntu"/.test(setup), 'setup.sh: refuses to run if not Ubuntu');
check(/uv sync --no-dev/.test(setup) && /npx vite build/.test(setup), 'setup.sh: builds the website and installs the server with --no-dev');
check(/chmod 600 "\$ENV_FILE"/.test(setup) && /chown "\$APP_USER:\$APP_USER" "\$ENV_FILE"/.test(setup), 'setup.sh: key file is mode 600 and owned by the service user');
const envWriters = setup.split('\n').filter((l) => l.includes('$ENV_FILE') && /\b(printf|echo|tee|cat)\b/.test(l));
check(envWriters.length === 0, 'setup.sh: nothing writes text into the key file (it only creates it empty)');
check(/caddy validate/.test(setup) && /systemctl enable/.test(setup) && /swamphacks-server\.service/.test(setup), 'setup.sh: validates Caddy settings, installs the service, enables it');
check(/NODE_MAJOR/.test(setup) && /deb\.nodesource\.com/.test(setup) && /cloudsmith\.io\/public\/caddy/.test(setup) && /astral\.sh\/uv/.test(setup), 'setup.sh: installs Node, Caddy and uv');
check(/useradd/.test(setup) && /swamphacks/.test(setup), 'setup.sh: creates the swamphacks user');

// update.sh
check(/git .*fetch/.test(update) && /npx vite build/.test(update) && /uv sync --no-dev/.test(update), 'update.sh: pulls, rebuilds the website, syncs server dependencies');
check(/systemctl restart "\$SERVICE"/.test(update) && /api\/health/.test(update), 'update.sh: restarts the service and checks /api/health');
check(/OK:/.test(update) && /journalctl -u "\$SERVICE" -n 30/.test(update), 'update.sh: prints OK, or the last 30 log lines');

// Nothing in deploy/ talks to Vultr, holds a secret, or carries a tool credit
const scanned = files.filter((f) => f !== 'check-local.mjs');
for (const f of scanned) {
  const t = texts[f];
  if (f !== 'README.md') {
    check(!/vultr-cli|api\.vultr\.com|curl[^\n]*vultr\.com/i.test(t), `${f}: no Vultr command or API call`);
  }
  check(!/postgres(ql)?:\/\/[^\s/:@]+:[^\s@]+@/i.test(t) && !/AIza[0-9A-Za-z_-]{20,}/.test(t) && !/-----BEGIN [A-Z ]*PRIVATE KEY/.test(t), `${f}: no key or password inside`);
  check(!/co-authored-by|generated with|noreply@anthropic/i.test(t), `${f}: no tool credit`);
}
check(readdirSync(here).every((f) => !/^\.env/.test(f)), 'deploy/: no .env file');

// web/dist must stay out of git
const ignored = spawnSync('git', ['check-ignore', '-q', 'web/dist/index.html'], { cwd: root });
if (ignored.error) skip('git check-ignore web/dist (git not found)');
else check(ignored.status === 0, 'web/dist is ignored by git (the built website is never committed)');

// ---- (c) the README covers every key name ----------------------------------------------------
const examplePath = join(root, '.env.example');
if (!existsSync(examplePath)) {
  fail('.env.example not found, so key names could not be compared');
} else {
  // Only the NAMES are read from this file. Values are never kept or printed.
  const exampleNames = [...readFileSync(examplePath, 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  const block = (configText.match(/ENV_VAR_NAMES\s*=\s*\(([\s\S]*?)\n\)/) ?? [])[1] ?? '';
  const serverNames = new Set([...block.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]));
  check(exampleNames.length > 0 && serverNames.size > 0, `found ${exampleNames.length} names in .env.example and ${serverNames.size} the server loads`);
  const notMentioned = exampleNames.filter((n) => !readme.includes(n));
  check(notMentioned.length === 0, `README mentions every name in .env.example${notMentioned.length ? '; missing: ' + notMentioned.join(', ') : ''}`);
  const readmeLines = readme.split('\n');
  const notLoaded = exampleNames.filter((n) => !serverNames.has(n));
  for (const n of notLoaded) {
    const explained = readmeLines.some((l) => l.includes(n) && /never|not on this server|leave out|do not/i.test(l));
    check(explained, `README explains why ${n} is left off the server (the server never loads it)`);
  }
  const keptOff = exampleNames.filter((n) => serverNames.has(n) && readmeLines.some((l) => l.includes(n) && /No \(leave out\)|\*\*No, do not set it\*\*/.test(l)));
  pass(`names the server loads but the README keeps off it on purpose: ${keptOff.join(', ') || 'none'}`);
  const needed = exampleNames.filter((n) => serverNames.has(n) && !keptOff.includes(n));
  pass(`names to put in the server's key file: ${needed.join(', ')}`);
}

// README must carry the promised sections
const sections = [
  ['cost estimate', /Cost estimate/i, /\$100/, /per hour/i, /per month/i],
  ['Auth0 settings', /Allowed Callback URLs/, /Allowed Logout URLs/, /Allowed Web Origins/],
  ['health check', /\/api\/health/],
  ['teardown', /Teardown checklist/i, /docs\/vultr\.md/],
  ['rollback', /roll back/i, /update\.sh 1a2b3c4/],
  ['untested list', /What is NOT tested/i],
  ['firewall ports', /22/, /80/, /443/],
  ['domain placeholder', /example\.com/],
];
for (const [label, ...patterns] of sections) {
  check(patterns.every((p) => p.test(readme)), `README has: ${label}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
