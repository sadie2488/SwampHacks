// Checks the frames against the REAL contract (contracts/td-message.schema.json), using the repo's JSON Schema checker.
// The frames come from three places: the shared fake data, the relay's sample frame, and frames made by the website's own
// buildFrame() code (loaded straight from web/src, which Node can read because that file only has type-only imports).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { SAMPLE_FRAME } from './selftest.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

// ajv lives in the repo's top-level node_modules (run "npm ci" at the top of the repo once)
let Ajv2020;
try {
  Ajv2020 = createRequire(new URL('package.json', root))('ajv/dist/2020').default;
} catch (err) {
  throw new Error(`Could not load ajv from the top of the repo (${err.message}). Run "npm ci" in the repo's top folder once, then try again.`);
}
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(read('contracts/td-message.schema.json'));
const problems = () => (validate.errors || []).map((e) => `${e.instancePath || '(top)'} ${e.message}`).join('; ');
const assertValid = (frame, label) => assert.ok(validate(frame), `${label} is not a valid td-message: ${problems()}`);

test('the shared fake frames are valid, and the known-bad one is rejected (so the checker really checks)', () => {
  for (const name of readdirSync(new URL('fixtures/td-message/', root))) assertValid(read(`fixtures/td-message/${name}`), name);
  assert.equal(validate(read('fixtures/_invalid/td-message/bands-too-short.json')), false);
  assert.equal(validate({ ...SAMPLE_FRAME, version: 2 }), false);
  assert.equal(validate({ ...SAMPLE_FRAME, audio: { ...SAMPLE_FRAME.audio, rms: 1.5 } }), false);
});

test('the relay self-test frame is valid', () => {
  assertValid(SAMPLE_FRAME, 'SAMPLE_FRAME');
});

test('frames made by the website code (buildFrame and the tracker) are valid in many situations', async (t) => {
  let frameModule;
  try {
    frameModule = await import(new URL('web/src/modules/touchdesigner/frame.ts', root).href);
  } catch (err) {
    t.skip(`this Node version can't load TypeScript files directly (${err.code || err.message}); the website's own tests still cover the frames`);
    return;
  }
  const { buildFrame, createTracker, emptyState } = frameModule;
  assertValid(buildFrame(emptyState(), 0), 'empty state');

  let clock = 0;
  const tracker = createTracker(() => clock);
  const slider = (id, value) => ({ version: 1, id, kind: 'slider', value, t_ms: clock });
  const moment = (id, state) => ({ version: 1, id, kind: 'moment', state, t_ms: clock });
  tracker.setMode('create');
  tracker.setControls({ 'visual.intensity': 0.7 });
  tracker.onTransport({ bpm: 120, beatPhase: 0.4 });
  const seen = [];
  for (let step = 0; step < 120; step++) {
    clock = step * 33;
    const wave = (Math.sin(step / 7) + 1) / 2;
    tracker.onPitch({ midi: step % 17 === 0 ? null : 48 + wave * 24, rms: wave * 1.3 }); // 1.3 on purpose: too loud must be clamped
    if (step % 10 === 0) tracker.onSignal(moment('audio.onset', 'start'));
    if (step < 60) {
      tracker.onSignal(slider('vision.hand.left.x', wave));
      tracker.onSignal(slider('vision.hand.left.height', 1 - wave));
    }
    tracker.onSignal(slider('vision.hand.right.x', 1 - wave));
    tracker.onSignal(slider('vision.hand.right.height', wave));
    tracker.onSignal(slider('vision.hands.distance', wave));
    if (step === 20) tracker.onSignal(moment('vision.hand.left.fist', 'start'));
    if (step === 40) tracker.onSignal(moment('vision.hand.left.fist', 'end'));
    if (step === 30) tracker.onSignal(moment('vision.hand.right.pinch', 'start'));
    const frame = tracker.frame();
    assertValid(frame, `frame ${step}`);
    seen.push(frame);
  }
  assert.ok(seen.some((f) => f.hands.left === null) && seen.some((f) => f.hands.left !== null), 'the left hand should come and go');
  assert.ok(seen.some((f) => f.audio.onset) && seen.some((f) => !f.audio.onset));
  assert.ok(seen.some((f) => f.hands.left?.fist) && seen.some((f) => f.hands.right?.pinch === 1));
  assert.ok(seen.some((f) => f.audio.pitch_midi === null));
  assert.ok(seen.every((f) => f.audio.rms <= 1));
});
