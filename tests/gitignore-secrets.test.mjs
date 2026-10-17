// Keys must never reach git. Run: node --test "tests/**/*.test.mjs"
// Builds a throwaway repo with the project's real .gitignore, drops fake secret files in every plausible
// place, and proves git ignores them while still tracking the .example templates.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isSecretPath } from '../.claude/hooks/lib.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const SECRET_FILES = [
  '.env', '.env.local', '.env.production', '.env.development.local', '.env.txt', '.env.backup',
  'server/.env', 'web/.env.local', 'deep/er/.env',
  'relay.private.json', 'other.private.json',
  'keys/server.pem', 'keys/tls.key', 'dump.p12', 'cert.pfx',
  'id_rsa', 'id_ed25519', '.ssh/config', '.aws/credentials',
  'credentials.json', 'secrets.json', 'service-account-prod.json',
];
const TRACKED_OK = ['.env.example', 'server/.env.example', 'web/src/main.ts', 'README.md'];
// The subset the Claude hooks also refuse to read or write (credentials.json etc. are git-ignored but not hook-guarded)
const HOOK_GUARDED = SECRET_FILES.filter((f) => !/^(credentials|secrets)\.json$|^service-account|\.private\.json$/.test(f) || f === 'relay.private.json');

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-test-'));
  copyFileSync(join(REPO, '.gitignore'), join(dir, '.gitignore'));
  git(dir, 'init', '-q');
  for (const f of [...SECRET_FILES, ...TRACKED_OK]) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), 'FAKE_KEY=not-a-real-secret\n');
  }
  return dir;
}

test('git ignores every secrets file', () => {
  const dir = makeRepo();
  try {
    for (const f of SECRET_FILES) {
      assert.doesNotThrow(() => git(dir, 'check-ignore', '-q', f), `${f} should be ignored by git`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('git status and git add -A never pick up a secrets file, but do pick up the templates', () => {
  const dir = makeRepo();
  try {
    const seen = git(dir, 'status', '--porcelain', '--untracked-files=all').split('\n').map((l) => l.slice(3).replace(/\/$/, ''));
    for (const f of SECRET_FILES) assert.ok(!seen.includes(f), `${f} must not show up in git status`);
    git(dir, 'add', '-A');
    const staged = git(dir, 'diff', '--cached', '--name-only').split('\n');
    for (const f of SECRET_FILES) assert.ok(!staged.includes(f), `${f} must not be staged by git add -A`);
    for (const f of TRACKED_OK) assert.ok(staged.includes(f), `${f} should still be tracked`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a plain `git add` of an ignored secrets file is refused by git', () => {
  const dir = makeRepo();
  try {
    assert.throws(() => git(dir, 'add', '.env'), /ignored/i);
    assert.throws(() => git(dir, 'add', 'server/.env'), /ignored/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no secrets file is tracked in this repository', () => {
  const tracked = git(REPO, 'ls-files').split('\n').filter(Boolean);
  const bad = tracked.filter((f) => isSecretPath(f));
  assert.deepEqual(bad, [], `secrets files are tracked: ${bad.join(', ')}`);
});

test('the Claude hooks recognise the same secrets files that git ignores', () => {
  for (const f of HOOK_GUARDED) assert.ok(isSecretPath(f), `${f} should be guarded by the hooks`);
  for (const f of TRACKED_OK) assert.ok(!isSecretPath(f), `${f} should stay readable`);
});
