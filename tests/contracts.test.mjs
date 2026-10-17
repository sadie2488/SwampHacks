// The contract validator must accept the real contracts and fixtures, and catch mistakes.
// Each case copies the contracts into a scratch folder, breaks one thing on purpose, and expects a failure.
// Run: node --test "tests/**/*.test.mjs"
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function withCopy(change) {
  // scratch/ is git-ignored and inside the repo, so the copy finds ajv by walking up to the repo's node_modules
  mkdirSync(join(REPO, 'scratch'), { recursive: true });
  const dir = mkdtempSync(join(REPO, 'scratch', 'contracts-test-'));
  try {
    cpSync(join(REPO, 'contracts'), join(dir, 'contracts'), { recursive: true });
    cpSync(join(REPO, 'fixtures'), join(dir, 'fixtures'), { recursive: true });
    mkdirSync(join(dir, 'scripts'));
    cpSync(join(REPO, 'scripts', 'validate-contracts.mjs'), join(dir, 'scripts', 'validate-contracts.mjs'));
    change?.(dir);
    const r = spawnSync('node', [join(dir, 'scripts', 'validate-contracts.mjs')], { encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const edit = (dir, rel, fn) => {
  const file = join(dir, rel);
  writeFileSync(file, fn(readFileSync(file, 'utf8')));
};
const editJson = (dir, rel, fn) => edit(dir, rel, (t) => `${JSON.stringify(fn(JSON.parse(t)), null, 2)}\n`);

test('the real contracts and fixtures pass', () => {
  const r = withCopy();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /contracts ok/);
});

test('a fixture that breaks its contract is caught', () => {
  const r = withCopy((d) => editJson(d, 'fixtures/note-event/middle-c.json', (n) => ({ ...n, pitch: 999 })));
  assert.equal(r.code, 1);
  assert.match(r.out, /note-event\/middle-c\.json/);
});

test('a bad example that is accidentally valid is caught', () => {
  const r = withCopy((d) => cpSync(join(d, 'fixtures/note-event/middle-c.json'), join(d, 'fixtures/_invalid/note-event/oops.json')));
  assert.equal(r.code, 1);
  assert.match(r.out, /should have been rejected/);
});

test('a schema without a contract version is caught', () => {
  const r = withCopy((d) => editJson(d, 'contracts/signal.schema.json', (s) => { delete s['x-contract-version']; return s; }));
  assert.equal(r.code, 1);
  assert.match(r.out, /x-contract-version/);
});

test('a message schema without a version field is caught', () => {
  const r = withCopy((d) => editJson(d, 'contracts/feedback.schema.json', (s) => { delete s.properties.version; return s; }));
  assert.equal(r.code, 1);
  assert.match(r.out, /"version" field/);
});

test('duplicate signal and control ids are caught', () => {
  let r = withCopy((d) => editJson(d, 'contracts/signal-catalog.json', (c) => ({ ...c, signals: [...c.signals, c.signals[0]] })));
  assert.equal(r.code, 1); assert.match(r.out, /duplicate signal id/);
  r = withCopy((d) => editJson(d, 'contracts/control-catalog.json', (c) => ({ ...c, controls: [...c.controls, c.controls[0]] })));
  assert.equal(r.code, 1); assert.match(r.out, /duplicate control id/);
});

test('a database column pointing at a missing table is caught', () => {
  const r = withCopy((d) => editJson(d, 'contracts/db-schema.json', (s) => { s.tables[1].columns[1].references = 'nowhere.id'; return s; }));
  assert.equal(r.code, 1);
  assert.match(r.out, /nowhere\.id/);
});

test('mappings: a typo in a signal or control name is caught', () => {
  let r = withCopy((d) => edit(d, 'fixtures/mapping/starter.yaml', (t) => t.replace('audio.clap', 'audio.clapp')));
  assert.equal(r.code, 1); assert.match(r.out, /audio\.clapp/);
  r = withCopy((d) => edit(d, 'fixtures/mapping/starter.yaml', (t) => t.replace('playback.toggle', 'playback.togle')));
  assert.equal(r.code, 1); assert.match(r.out, /playback\.togle/);
});

test('mappings: a rule that uses the wrong kind of signal or control is caught', () => {
  // follow needs a slider; clap is a moment
  let r = withCopy((d) => edit(d, 'fixtures/mapping/starter.yaml', (t) => t.replace('when: vision.hand.right.height', 'when: audio.clap')));
  assert.equal(r.code, 1); assert.match(r.out, /"follow" needs a slider/);
  // toggle needs an on/off control; tempo is a value
  r = withCopy((d) => edit(d, 'fixtures/mapping/starter.yaml', (t) => t.replace('do: create.beat\n  how: toggle', 'do: playback.tempo\n  how: toggle')));
  assert.equal(r.code, 1); assert.match(r.out, /"toggle" needs an on\/off control/);
  // a control used in a mode where it doesn't exist
  r = withCopy((d) => edit(d, 'fixtures/mapping/starter.yaml', (t) => t.replace('mode: create\n  when: audio.snap', 'mode: play\n  when: audio.snap')));
  assert.equal(r.code, 1); assert.match(r.out, /doesn't exist in play mode/);
});

test('mappings: only_while must be a signal that can be held', () => {
  const r = withCopy((d) => edit(d, 'fixtures/mapping/starter.yaml', (t) => t.replace('only_while: vision.hand.left.fist', 'only_while: audio.clap')));
  assert.equal(r.code, 1);
  assert.match(r.out, /can't be held/);
});

test('mappings: two enabled rules fighting over the same signal and control are caught', () => {
  const r = withCopy((d) => edit(d, 'fixtures/mapping/starter.yaml', (t) => t.replace('- name: head tilt slows down        # switched off: it would fight with the hand-height rule above\n  enabled: false\n  mode: play\n  when: vision.head.tilt', '- name: second hand rule\n  mode: play\n  when: vision.hand.right.height')));
  assert.equal(r.code, 1);
  assert.match(r.out, /both use vision\.hand\.right\.height/);
});

test('song analysis: notes past the end of the song are caught', () => {
  const r = withCopy((d) => editJson(d, 'fixtures/song-analysis/twinkle.json', (s) => { s.duration_sec = 5; return s; }));
  assert.equal(r.code, 1);
  assert.match(r.out, /past the end|bad times/);
});
