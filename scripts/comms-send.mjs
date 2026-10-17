#!/usr/bin/env node
// Send a file to the `comms` branch (commit -> pull --rebase -> push, with retry).
// Usage: node scripts/comms-send.mjs <path-on-comms> <local-file | -> [--append] [--message "text"]
//   --append adds to the end of the file (with a timestamp) instead of replacing it.
//   <path-on-comms> is one of:
//     comms/<person>-to-lead.md      comms/lead-to-<person>.md
//     briefs/<person>-<task>.md      updates/<person>-<task>-<time>.md
//     overrides.md
//   "-" as the local file reads the content from stdin.
// The comms branch lives in a separate working folder (.comms/) so your own branch is never touched.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const MAX_TRIES = 5;
const ALLOWED = [
  /^comms\/[a-z0-9_-]+-to-lead\.md$/i,
  /^comms\/lead-to-[a-z0-9_-]+\.md$/i,
  /^briefs\/[a-z0-9_.-]+\.md$/i,
  /^updates\/[a-z0-9_.-]+\.md$/i,
  /^overrides\.md$/,
];
// Keys and passwords never go in comms (the repo is public).
const SECRET = /(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|passwd|app[ _-]?password|api[ _-]?key|secret|token)\s*[:=]\s*\S{6,})/i;

const fail = (msg, fix) => {
  console.error(`comms-send: ${msg}`);
  if (fix) console.error(`  fix: ${fix}`);
  process.exit(1);
};

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...args) => {
  try {
    return { ok: true, out: git(cwd, ...args) };
  } catch (e) {
    return { ok: false, out: `${e.stderr || ''}${e.stdout || ''}`.trim() };
  }
};

// ---- args ----
const argv = process.argv.slice(2);
const mi = argv.indexOf('--message');
const message = mi >= 0 ? argv.splice(mi, 2)[1] : null;
const ai = argv.indexOf('--append');
const append = ai >= 0;
if (append) argv.splice(ai, 1);
const [target, source] = argv;
if (!target || !source) fail('missing arguments', 'node scripts/comms-send.mjs <path-on-comms> <local-file|-> [--message "text"]');
if (!ALLOWED.some((re) => re.test(target)) || target.includes('..')) {
  fail(`"${target}" is not an allowed comms path`, 'use comms/<person>-to-lead.md, comms/lead-to-<person>.md, briefs/<person>-<task>.md, updates/<person>-<task>-<time>.md or overrides.md');
}
let content;
try {
  content = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
} catch {
  fail(`cannot read "${source}"`, 'check the file path');
}
if (SECRET.test(content)) fail('the text looks like it contains a key or password; nothing was sent', 'remove the secret and send again (keys never go in comms)');
if (/co-authored-by|generated with/i.test(content) && !/\bno AI attribution\b/i.test(content)) {
  console.error('comms-send: note - text mentions AI credit wording; project rule is no AI attribution anywhere');
}

// ---- locate repo and the comms worktree ----
const top = tryGit(process.cwd(), 'rev-parse', '--show-toplevel');
if (!top.ok) fail('not inside the project folder', 'cd into the SwampHacks folder first');
const repo = top.out;
const wt = join(repo, '.comms');
const REMOTE = 'origin';

const remoteHas = () => tryGit(repo, 'ls-remote', '--exit-code', '--heads', REMOTE, 'comms').ok;

function ensureWorktree() {
  if (existsSync(join(wt, '.git'))) return;
  tryGit(repo, 'worktree', 'prune');
  const fetched = tryGit(repo, 'fetch', REMOTE, 'comms');
  if (fetched.ok) {
    const r = tryGit(repo, 'worktree', 'add', '-B', 'comms', wt, `${REMOTE}/comms`);
    if (!r.ok) fail(`could not set up the comms folder: ${r.out}`, 'delete the .comms folder and try again');
    return;
  }
  if (remoteHas()) fail(`could not download the comms branch: ${fetched.out}`, 'check your internet and GitHub login (gh auth status), then try again');
  // First ever message: create the branch with no shared history with main.
  const r = tryGit(repo, 'worktree', 'add', '--detach', wt);
  if (!r.ok) fail(`could not set up the comms folder: ${r.out}`, 'delete the .comms folder and try again');
  git(wt, 'checkout', '--orphan', 'comms');
  tryGit(wt, 'rm', '-rf', '--quiet', '.');
  writeFileSync(join(wt, 'README.md'), '# comms\n\nMessages between laptops. Never merged into main. One writer per file.\n');
  git(wt, 'add', 'README.md');
  git(wt, 'commit', '-q', '-m', 'Start comms branch');
}

ensureWorktree();

const dest = resolve(wt, target);
if (!dest.startsWith(resolve(wt))) fail('path escapes the comms folder');
mkdirSync(dirname(dest), { recursive: true });
if (append && remoteHas()) {
  // Get the latest copy first so an append never overwrites newer messages.
  const p = tryGit(wt, 'pull', '--rebase', '-q', REMOTE, 'comms');
  if (!p.ok) {
    tryGit(wt, 'rebase', '--abort');
    fail(`could not get the latest comms: ${p.out}`, 'check your internet and try again');
  }
}
const body = content.endsWith('\n') ? content : `${content}\n`;
if (append && existsSync(dest)) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  writeFileSync(dest, `${readFileSync(dest, 'utf8').replace(/\n*$/, '\n')}\n---\n*${stamp} UTC*\n\n${body}`);
} else {
  writeFileSync(dest, body);
}
git(wt, 'add', '--', target);

const status = git(wt, 'status', '--porcelain', '--', target);
if (status) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  git(wt, 'commit', '-q', '-m', message || `comms: ${target} (${stamp})`);
}

// ---- pull --rebase, push, retry ----
let lastErr = '';
for (let i = 1; i <= MAX_TRIES; i++) {
  if (remoteHas()) {
    const p = tryGit(wt, 'pull', '--rebase', '-q', REMOTE, 'comms');
    if (!p.ok) {
      tryGit(wt, 'rebase', '--abort');
      fail(`could not merge with the latest comms: ${p.out}`, 'someone else wrote to the same file; only one person may write each file. Ask the lead');
    }
  }
  const push = tryGit(wt, 'push', '-q', '-u', REMOTE, 'comms');
  if (push.ok) {
    console.log(`sent: ${target}`);
    process.exit(0);
  }
  lastErr = push.out;
  if (/authentication|denied|403|could not read|not found|permission/i.test(lastErr)) {
    fail('GitHub refused the push', 'sign in with `gh auth login` and make sure you have access to the repo');
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * i);
}
fail(`push failed after ${MAX_TRIES} tries: ${lastErr.split('\n')[0]}`, 'check your internet, then run the same command again (nothing is lost)');
