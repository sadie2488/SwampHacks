// End-to-end check of the walking skeleton in a real Chrome. Run it with: node scripts/e2e.mjs
// (that starts the server, the website and the TouchDesigner relay, runs this file, and shuts them down).
// It uses made-up camera and microphone data (?fake=1), so it needs no hardware.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const RELAY = process.env.E2E_RELAY ?? 'ws://localhost:9980';
const MAPPINGS = join(ROOT, 'web', 'src', 'modules', 'mappings', 'mappings.yaml');
const T = { timeout: 90_000 };

let browser;
let page;
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => page.getByTestId(id);
const topic = (name) => page.evaluate((n) => window.__music.bus.last(n), name);
const control = async (id) => (await topic('controls'))?.[id];
async function until(what, fn, ms = 10_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${what} (last value: ${JSON.stringify(last)})`);
}
const emitSignals = (id, kind, values, gap = 40) =>
  page.evaluate(async ([sid, k, vals, g]) => {
    for (const v of vals) {
      window.__music.sendSignal({ id: sid, kind: k, value: v, confidence: 1 });
      await new Promise((r) => setTimeout(r, g));
    }
  }, [id, kind, values, gap]);

before(async () => {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const context = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource.*404/i.test(m.text())) problems.push(`console error: ${m.text()}`);
  });
  await page.goto(`${BASE}/?fake=1`);
});
after(async () => {
  await browser?.close();
});

test('the page opens with the four tabs', T, async () => {
  for (const id of ['tab-learn', 'tab-play', 'tab-create', 'tab-lab']) await $(id).waitFor({ state: 'visible', timeout: 15_000 });
});

test('the demo song loads and shows tempo, key and time signature', T, async () => {
  await $('use-demo').click();
  await until('analysis summary', async () => (await $('analysis-tempo').textContent())?.includes('100'));
  assert.match(await $('analysis-key').textContent(), /C\s*major/i);
  assert.match(await $('analysis-time-signature').textContent(), /4\s*\/\s*4/);
});

test('sheet music is drawn from the notes', T, async () => {
  await $('sheet-ready').waitFor({ state: 'attached', timeout: 30_000 });
  const count = Number((await $('sheet-note-count').textContent()).match(/\d+/)?.[0]);
  assert.ok(count >= 40, `expected about 42 melody notes, got ${count}`);
  assert.ok((await $('sheet').locator('svg').count()) > 0, 'no SVG inside the sheet');
});

test('play starts the song and the position moves', T, async () => {
  await $('btn-play').click();
  await until('state playing', async () => /playing/i.test(await $('transport-state').textContent()));
  const t0 = (await topic('transport')).positionSec;
  await sleep(1500);
  const t1 = (await topic('transport')).positionSec;
  assert.ok(t1 - t0 > 0.8, `position should advance about 1.5 s, moved ${(t1 - t0).toFixed(2)}`);
});

test('slowing down changes the speed, keeps playing, and the tempo label follows', T, async () => {
  await $('btn-tempo-down').click();
  await until('tempo label 0.9', async () => /0\.9/.test(await $('tempo-value').textContent()));
  const tr = await until('transport tempo 0.9', async () => {
    const x = await topic('transport');
    return Math.abs(x.tempo - 0.9) < 0.01 ? x : null;
  });
  assert.ok(tr.playing, 'should still be playing');
  if (tr.bpm !== undefined) assert.ok(Math.abs(tr.bpm - 90) < 1, `bpm should be about 90, got ${tr.bpm}`);
  const a = (await topic('transport')).positionSec;
  await sleep(1500);
  const b = (await topic('transport')).positionSec;
  assert.ok(b - a > 1.0 && b - a < 1.6, `at 0.9x about 1.35 song seconds should pass in 1.5 s, got ${(b - a).toFixed(2)}`);
});

test('raising the pitch updates the label and the engine', T, async () => {
  await $('btn-pitch-up').click();
  await until('pitch label', async () => /\b1\b/.test(await $('pitch-value').textContent()));
  assert.equal((await topic('transport')).pitch, 1);
  assert.equal(await control('playback.pitch'), 1);
});

test('pause stops the song, and loop toggles', T, async () => {
  await $('btn-pause').click();
  await until('state paused', async () => /paused/i.test(await $('transport-state').textContent()));
  const a = (await topic('transport')).positionSec;
  await sleep(700);
  assert.equal((await topic('transport')).positionSec, a, 'position must hold still while paused');
  await $('btn-loop').click();
  await until('loop on', async () => (await control('playback.loop')) === true);
  await $('btn-loop').click();
  await until('loop off', async () => (await control('playback.loop')) === false);
});

test('the Command Lab lists every signal and control, with no errors from the starter mappings', T, async () => {
  await $('tab-lab').click();
  await $('meter-vision.hand.right.height').waitFor({ state: 'visible', timeout: 10_000 });
  for (const id of ['meter-audio.clap', 'meter-vision.hand.left.fist', 'meter-audio.keyword.slower', 'control-playback.tempo', 'control-create.instrument']) {
    await $(id).waitFor({ state: 'attached', timeout: 5_000 });
  }
  const issues = (await topic('issues')) ?? [];
  assert.deepEqual(issues.filter((i) => i.level === 'error'), [], 'the starter mappings should have no errors');
  assert.ok((await page.locator('[data-testid^="rule-"]').count()) > 0, 'rules should be listed');
});

test('a made-up hand movement drives the tempo through the mapping file', T, async () => {
  await page.evaluate(() => window.__music.sendCommand('playback.tempo', 'button', { how: 'set', value: 1 }));
  await emitSignals('vision.hand.right.height', 'slider', Array(30).fill(0.95));
  const tempo = await until('tempo follows the hand', async () => {
    const t = await control('playback.tempo');
    return t > 1.3 ? t : null;
  }, 8_000);
  assert.ok(tempo <= 1.5);
  await emitSignals('vision.hand.right.height', 'slider', Array(40).fill(0.05));
  await until('tempo follows the hand back down', async () => (await control('playback.tempo')) < 0.7, 8_000);
});

test('a made-up clap toggles play and pause through the mapping file', T, async () => {
  const before = (await topic('transport')).playing;
  await $('fake-audio.clap').click();
  await until('clap flips playing', async () => (await topic('transport')).playing === !before);
  await sleep(800); // clap rule has a cooldown
  await $('fake-audio.clap').click();
  await until('second clap flips back', async () => (await topic('transport')).playing === before);
});

test('editing the mapping file applies instantly, with no page reload', T, async () => {
  const original = readFileSync(MAPPINGS, 'utf8');
  const count = () => page.locator('[data-testid^="rule-"]').count();
  const n0 = await count();
  try {
    writeFileSync(MAPPINGS, `${original.trimEnd()}\n\n- name: e2e temporary rule\n  mode: any\n  when: audio.snap\n  do: playback.volume\n  how: nudge\n  step: 0.1\n`);
    await until('new rule appears', async () => (await count()) === n0 + 1, 15_000);
  } finally {
    writeFileSync(MAPPINGS, original);
  }
  await until('rule disappears after restore', async () => (await count()) === n0, 15_000);
});

test('a typo in the mapping file gives a friendly message and the other rules keep working', T, async () => {
  const original = readFileSync(MAPPINGS, 'utf8');
  try {
    writeFileSync(MAPPINGS, `${original.trimEnd()}\n\n- name: e2e typo rule\n  mode: any\n  when: audio.clapp\n  do: playback.toggle\n  how: trigger\n`);
    const issue = await until('an issue about the typo', async () => ((await topic('issues')) ?? []).find((i) => /clapp/.test(`${i.where} ${i.message}`)), 15_000);
    assert.equal(issue.level, 'error');
    assert.match(issue.message, /audio\.clap\b/, 'should suggest the right name');
    assert.match((await $('lab-issues').textContent()) ?? '', /clapp/);
    const before = (await topic('transport')).playing;
    await sleep(700);
    await $('fake-audio.clap').click();
    await until('the good clap rule still works', async () => (await topic('transport')).playing === !before);
  } finally {
    writeFileSync(MAPPINGS, original);
  }
  await until('typo cleared after restore', async () => !((await topic('issues')) ?? []).some((i) => /clapp/.test(`${i.where} ${i.message}`)), 15_000);
});

test('made-up camera data flows into signals and the Lab meters', T, async () => {
  await $('btn-enable-vision').click();
  await until('vision status running', async () => /running|fake|made-up/i.test((await $('status-vision').textContent()) ?? ''), 15_000);
  await until('a vision signal arrives', async () => (await topic('signal'))?.id?.startsWith('vision.'), 15_000);
  const text = await $('meter-vision.hand.right.height').textContent();
  assert.doesNotMatch(text ?? '', /no data yet/i, 'the meter should show live values');
});

// Real camera mode (no ?fake=1), using Chrome's built-in fake camera device, so a person can always see themselves.
async function withRealCameraPage(blockTrackingModels, fn) {
  const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  const pageProblems = [];
  p.on('pageerror', (e) => pageProblems.push(e.message));
  if (blockTrackingModels) await p.route(/jsdelivr|storage\.googleapis/, (route) => route.abort());
  try {
    await p.goto(`${BASE}/`);
    await fn(p);
    assert.deepEqual(pageProblems, []);
  } finally {
    await context.close();
  }
}
const previewState = (p) =>
  p.evaluate(() => {
    const v = document.querySelector('[data-testid="camera-preview-video"]');
    return v ? { width: v.videoWidth, playing: !v.paused && v.readyState >= 2, live: v.srcObject?.getVideoTracks().every((t) => t.readyState === 'live') } : null;
  });

test('real camera: you can see yourself on the Learn tab, without opening the Command Lab', T, async () => {
  await withRealCameraPage(false, async (p) => {
    await p.getByTestId('btn-enable-vision').click();
    const s = await until('the preview shows live camera pictures', async () => {
      const x = await previewState(p);
      return x && x.width > 0 && x.playing && x.live ? x : null;
    }, 20_000);
    assert.ok(s.width >= 320);
    await p.getByTestId('camera-preview-overlay').waitFor({ state: 'attached' });
    // the picture stays when you switch tabs
    await p.getByTestId('tab-create').click();
    assert.ok((await previewState(p))?.playing, 'the preview should stay on every tab');
    await p.getByTestId('tab-learn').click();
    await p.getByTestId('btn-enable-vision').click(); // turn it off again
    await until('the preview disappears when the camera is off', async () => (await previewState(p)) === null, 8_000);
  });
});

test('real camera: if hand tracking cannot load, you still see yourself and are told why', T, async () => {
  await withRealCameraPage(true, async (p) => {
    await p.getByTestId('btn-enable-vision').click();
    await until('a plain-words message that tracking could not start', async () => /tracking could not start/i.test((await p.getByTestId('status-vision').textContent()) ?? ''), 40_000);
    const s = await previewState(p);
    assert.ok(s && s.width > 0 && s.playing && s.live, `the camera picture must stay on screen, got ${JSON.stringify(s)}`);
    await p.getByTestId('btn-enable-vision').click();
    await until('turning it off really stops the camera', async () => (await previewState(p)) === null, 8_000);
  });
});

test('made-up microphone data produces pitch frames and notes', T, async () => {
  await $('btn-enable-audio').click();
  await until('audio status running', async () => /running|fake|made-up/i.test((await $('status-audio-live').textContent()) ?? ''), 15_000);
  await until('pitch frames', async () => (await topic('pitch'))?.midi != null, 15_000);
  await until('performance events', async () => (await topic('performance'))?.type, 15_000);
});

test('frames for TouchDesigner reach the relay over a real WebSocket', T, async () => {
  const frames = [];
  const ws = new WebSocket(RELAY);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`could not connect to the relay at ${RELAY}. Is bridge/relay.mjs running?`));
  });
  ws.onmessage = (m) => frames.push(JSON.parse(String(m.data)));
  await $('btn-enable-td').click();
  try {
    await until('10 frames at the relay', async () => frames.length >= 10, 15_000);
  } finally {
    ws.close();
  }
  const f = frames.at(-1);
  assert.equal(f.version, 1);
  assert.equal(typeof f.audio.rms, 'number');
  assert.ok(f.hands && typeof f.hands === 'object');
  assert.match((await $('status-touchdesigner').textContent()) ?? '', /./);
});

test('Create mode: a hummed melody becomes a layer that plays in a loop', { timeout: 120_000 }, async () => {
  await $('tab-create').click();
  await $('btn-add-layer').click();
  await $('btn-record').click();
  const hum = async () => {
    await $('btn-fake-hum').click();
    await sleep(2500);
  };
  // the loop has a count-in bar, then records for the loop length; hum several times so frames land inside the take
  await sleep(2200);
  for (let i = 0; i < 4; i++) await hum();
  const notes = await until(
    'notes in the first layer',
    async () => {
      const n = Number((await $('layer-0-notes').textContent())?.match(/\d+/)?.[0] ?? 0);
      return n > 0 ? n : null;
    },
    40_000,
  );
  assert.ok(notes >= 2, `the hummed melody has several notes, got ${notes}`);
  await $('btn-stop-loop').click();
});

test('the app falls back to the built-in demo when the server is down', T, async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  await p.route('**/api/**', (route) => route.abort());
  await p.goto(`${BASE}/?fake=1`);
  await p.getByTestId('use-demo').click();
  await p.getByTestId('offline-notice').waitFor({ state: 'visible', timeout: 15_000 });
  await p.getByTestId('sheet-ready').waitFor({ state: 'attached', timeout: 30_000 });
  assert.match(await p.getByTestId('analysis-tempo').textContent(), /100/);
  await context.close();
});

test('no errors appeared in the browser during the whole run', T, async () => {
  assert.deepEqual(problems, []);
});
