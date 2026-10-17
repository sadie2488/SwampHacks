// The CI check scripts, run against throwaway repos with good and bad pull requests.
// Run: node --test "tests/**/*.test.mjs"
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CI = (name) => join(REPO, 'scripts', 'ci', `${name}.mjs`);
const OWN = JSON.parse(readFileSync(join(REPO, 'ownership.json'), 'utf8'));

const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function makeRepo({ claims = {}, withOwnership = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-test-'));
  git(dir, ['init', '-q', '-b', 'main']);
  if (withOwnership) writeFileSync(join(dir, 'ownership.json'), JSON.stringify({ ...OWN, claims }, null, 2));
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  commit(dir, 'Start', {});
  return dir;
}

function commit(dir, message, files, { author = ['Sarah', 'sarah@example.com'], committer = author } = {}) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, ['add', '-A', '-f']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', message], {
    GIT_AUTHOR_NAME: author[0], GIT_AUTHOR_EMAIL: author[1], GIT_COMMITTER_NAME: committer[0], GIT_COMMITTER_EMAIL: committer[1],
  });
}

// make a branch off main with one change; returns the env the CI scripts expect
function pr(dir, branch, files, message = 'Add a thing', opts = {}) {
  const base = git(dir, ['rev-parse', 'main']);
  git(dir, ['checkout', '-q', '-b', branch.replace(/\//g, '-') + Math.random().toString(36).slice(2, 6), 'main']);
  commit(dir, message, files, opts);
  const head = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', 'main']);
  return { BASE_SHA: base, HEAD_SHA: head, BRANCH: branch, PR_BODY: '', PR_TITLE: 'Add a thing', EVENT_NAME: 'pull_request' };
}

const run = (script, dir, env) => {
  const r = spawnSync('node', [CI(script)], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

// ---------------- ownership ----------------
test('ownership: a lane branch may change its own folders', () => {
  const d = makeRepo();
  try {
    const e = pr(d, 'lane-c/sadie/C1-tracking', { 'web/src/modules/vision/track.ts': 'x' });
    assert.equal(run('check-ownership', d, e).code, 0);
  } finally { cleanup(d); }
});

test('ownership: a lane branch is stopped from other lanes, lead-only files, and deletes there', () => {
  const d = makeRepo();
  try {
    let r = run('check-ownership', d, pr(d, 'lane-c/sadie/C1-tracking', { 'web/src/app/App.tsx': 'x' }));
    assert.equal(r.code, 1); assert.match(r.out, /outside lane "lane-c"/);
    r = run('check-ownership', d, pr(d, 'lane-c/sadie/C1-tracking', { 'contracts/signal.schema.json': '{}' }));
    assert.equal(r.code, 1); assert.match(r.out, /lead-only/);
    r = run('check-ownership', d, pr(d, 'lane-c/sadie/C1-tracking', { '.env.example': 'X=' }));
    assert.equal(r.code, 1); assert.match(r.out, /lead-only/);
    r = run('check-ownership', d, pr(d, 'lane-c/sadie/C1-tracking', { 'tasks.json': '{}' }));
    assert.equal(r.code, 1);
    // deleting a file that belongs to another lane is also a change to that lane
    commit(d, 'Seed', { 'web/src/app/old.ts': 'x' });
    const base = git(d, ['rev-parse', 'HEAD']);
    git(d, ['checkout', '-q', '-b', 'del']); git(d, ['rm', '-q', 'web/src/app/old.ts']); commit(d, 'Remove old', {});
    const head = git(d, ['rev-parse', 'HEAD']);
    r = run('check-ownership', d, { BASE_SHA: base, HEAD_SHA: head, BRANCH: 'lane-c/sadie/C1-tracking' });
    assert.equal(r.code, 1); assert.match(r.out, /old\.ts/);
  } finally { cleanup(d); }
});

test('ownership: bad branch names fail with a fix; comms is never merged', () => {
  const d = makeRepo();
  try {
    let r = run('check-ownership', d, pr(d, 'feature/cool-thing', { 'README.md': 'y' }));
    assert.equal(r.code, 1); assert.match(r.out, /must start with a lane name/);
    r = run('check-ownership', d, pr(d, 'comms', { 'README.md': 'y' }));
    assert.equal(r.code, 1); assert.match(r.out, /never merged/);
  } finally { cleanup(d); }
});

test('ownership: lead branches may change lead files and unclaimed lanes, but not a claimed lane', () => {
  const d = makeRepo({ claims: { commands: { person: 'veda', branch: 'commands/veda/L1-x', since: 'now' } } });
  try {
    assert.equal(run('check-ownership', d, pr(d, 'lead/L2', { 'docs/plan.md': 'p', 'web/src/modules/playback/a.ts': 'x' })).code, 0);
    const r = run('check-ownership', d, pr(d, 'lead/L1', { 'web/src/modules/mappings/mappings.yaml': 'x' }));
    assert.equal(r.code, 1); assert.match(r.out, /belongs to veda/);
  } finally { cleanup(d); }
});

test('ownership: a written override line lets a change through and is reported', () => {
  const d = makeRepo();
  try {
    const e = pr(d, 'lane-c/sadie/C1-tracking', { 'web/src/app/App.tsx': 'x' });
    const r = run('check-ownership', d, { ...e, PR_BODY: 'Needs the shell.\nOverride: web/src/app/** | approved by Lalitha' });
    assert.equal(r.code, 0); assert.match(r.out, /Override used/);
  } finally { cleanup(d); }
});

test('ownership: with no rules on the base branch yet, nothing is enforced', () => {
  const d = makeRepo({ withOwnership: false });
  try {
    assert.equal(run('check-ownership', d, pr(d, 'whatever', { 'README.md': 'y' })).code, 0);
  } finally { cleanup(d); }
});

// ---------------- AI credit ----------------
test('attribution: clean commits and PR text pass', () => {
  const d = makeRepo();
  try {
    assert.equal(run('check-attribution', d, pr(d, 'lane-c/sadie/C1-tracking', { 'web/src/modules/vision/a.ts': '// tracks hands\n' })).code, 0);
  } finally { cleanup(d); }
});

test('attribution: any AI credit in a commit, author, committer, PR title or PR body fails', () => {
  const d = makeRepo();
  try {
    const f = { 'web/src/modules/vision/a.ts': 'x' };
    const trailer = 'Add thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>';
    for (const [label, e] of [
      ['co-author trailer', pr(d, 'lane-c/s/C1', f, trailer)],
      ['generated-with line', pr(d, 'lane-c/s/C1', f, 'Add thing\n\nGenerated with Claude Code')],
      ['robot emoji', pr(d, 'lane-c/s/C1', f, '🤖 Add thing')],
      ['session link', pr(d, 'lane-c/s/C1', f, 'Add thing\n\nClaude-Session: https://claude.ai/code/session_x')],
      ['AI author name', pr(d, 'lane-c/s/C1', f, 'Add thing', { author: ['Claude', 'a@example.com'] })],
      ['AI author email', pr(d, 'lane-c/s/C1', f, 'Add thing', { author: ['Sarah', 'noreply@anthropic.com'] })],
      ['AI committer', pr(d, 'lane-c/s/C1', f, 'Add thing', { committer: ['Claude Code', 'c@example.com'] })],
    ]) {
      const r = run('check-attribution', d, e);
      assert.equal(r.code, 1, `${label} should fail`);
    }
    const clean = pr(d, 'lane-c/s/C1', f);
    assert.equal(run('check-attribution', d, { ...clean, PR_BODY: '🤖 Generated with [Claude Code](https://claude.com/claude-code)' }).code, 1, 'PR body');
    assert.equal(run('check-attribution', d, { ...clean, PR_TITLE: 'Co-Authored-By: Claude' }).code, 1, 'PR title');
  } finally { cleanup(d); }
});

test('attribution: a credit line added to worker code fails, but the rules text in lead files does not', () => {
  const d = makeRepo();
  try {
    let r = run('check-attribution', d, pr(d, 'lane-c/s/C1', { 'web/src/modules/vision/a.ts': '// Generated with Claude Code\n' }));
    assert.equal(r.code, 1); assert.match(r.out, /a\.ts/);
    r = run('check-attribution', d, pr(d, 'lead/0.2', { 'docs/rules.md': 'Never add noreply@anthropic.com or "Generated with Claude Code".\n' }));
    assert.equal(r.code, 0);
  } finally { cleanup(d); }
});

test('attribution: a human co-author is fine on main (squash merges) but not on a pull request', () => {
  const d = makeRepo();
  try {
    const e = pr(d, 'lane-c/s/C1', { 'web/src/modules/vision/a.ts': 'x' }, 'Add thing\n\nCo-authored-by: Shayaan <s@example.com>');
    assert.equal(run('check-attribution', d, { ...e, EVENT_NAME: 'push' }).code, 0);
    assert.equal(run('check-attribution', d, e).code, 1);
  } finally { cleanup(d); }
});

test('attribution: a person-approved override line is honoured', () => {
  const d = makeRepo();
  try {
    const e = pr(d, 'lane-c/s/C1', { 'web/src/modules/vision/a.ts': 'x' }, 'Add thing\n\nCo-authored-by: Shayaan <s@example.com>');
    assert.equal(run('check-attribution', d, { ...e, PR_BODY: 'Override: attribution | approved by Lalitha' }).code, 0);
  } finally { cleanup(d); }
});

// ---------------- files ----------------
test('files: big files, media, weights, datasets and secrets are rejected; normal files pass', () => {
  const d = makeRepo();
  try {
    const bad = {
      'big.txt': 'x'.repeat(6 * 1024 * 1024),
      'clips/take1.wav': 'RIFF',
      'weights/model.pt': 'x',
      'data/songs.csv': 'a,b',
      'models/best.bin': 'x',
      'server/.env': 'KEY=1',
      'id_rsa': 'x',
      'dump.zip': 'x',
    };
    for (const [path, content] of Object.entries(bad)) {
      const r = run('check-files', d, pr(d, 'lane-a/s/A1', { [path]: content }));
      assert.equal(r.code, 1, `${path} should be rejected`);
    }
    const ok = { 'web/src/a.ts': 'x', '.env.example': 'KEY=', 'server/app/models/user.py': 'class User: pass\n', 'docs/pic.png': 'x'.repeat(1000) };
    assert.equal(run('check-files', d, pr(d, 'lead/x', ok)).code, 0);
    const e = pr(d, 'lane-a/s/A1', { 'data/songs.csv': 'a,b' });
    assert.equal(run('check-files', d, { ...e, PR_BODY: 'Override: data/songs.csv | approved by Lalitha' }).code, 0);
  } finally { cleanup(d); }
});
