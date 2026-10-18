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
  // When a real database is configured but unreachable (for example its password is missing), the server answers the
  // saving routes with a plain 503 and the app falls back to this computer. The browser prints that as a console error.
  // Allow exactly that case; any other server error (5xx) anywhere is still a problem.
  const SAVING_ROUTES = /\/api\/(sessions|creations|songs|feedback-items)\b/;
  page.on('response', (r) => {
    if (r.status() >= 500 && !(r.status() === 503 && SAVING_ROUTES.test(r.url()))) problems.push(`server error ${r.status()} from ${new URL(r.url()).pathname}`);
  });
  page.on('console', (m) => {
    // MediaPipe prints the info line "Created TensorFlow Lite XNNPACK delegate for CPU" through console.error: not a problem
    if (m.type() === 'error' && !/favicon|Failed to load resource.*404|Failed to load resource.*503|TensorFlow Lite XNNPACK delegate/i.test(m.text())) problems.push(`console error: ${m.text()}`);
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
    // One rule with a typo next to one good rule: the typo is reported, the good rule still runs (the Play rules are
    // switched off since History replaced Play, so the good rule is written here too).
    writeFileSync(MAPPINGS, `${original.trimEnd()}\n\n- name: e2e typo rule\n  mode: any\n  when: audio.clapp\n  do: playback.toggle\n  how: trigger\n\n- name: e2e good rule\n  mode: any\n  when: audio.snap\n  do: playback.volume\n  how: nudge\n  step: -0.1\n`);
    const issue = await until('an issue about the typo', async () => ((await topic('issues')) ?? []).find((i) => /clapp/.test(`${i.where} ${i.message}`)), 15_000);
    assert.equal(issue.level, 'error');
    assert.match(issue.message, /audio\.clap\b/, 'should suggest the right name');
    assert.match((await $('lab-issues').textContent()) ?? '', /clapp/);
    await until('the good rule is listed', async () => (await page.locator('[data-testid^="rule-"]').count()) > 0, 15_000);
    await sleep(700);
    const before = await control('playback.volume');
    await $('fake-audio.snap').click();
    await until('the good rule next to the typo still works', async () => (await control('playback.volume')) < before - 0.05);
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
  if (blockTrackingModels) await p.route(/jsdelivr|storage\.googleapis|\/models\/.*\.task/, (route) => route.abort()); // local model copies too
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

test('practice with a made-up slow player: calibrate, play along, get feedback, coaching, history and a loop button', { timeout: 150_000 }, async () => {
  await $('tab-learn').click();
  await page.evaluate(() => window.__music.fakePractice({ pace: 0.9 })); // the made-up player drags by 10 percent
  const micOn = /running|made-up/i.test((await $('status-audio-live').textContent()) ?? '');
  if (!micOn) await $('btn-enable-audio').click();
  await until('microphone running', async () => /running|made-up/i.test((await $('status-audio-live').textContent()) ?? ''), 15_000);
  // make sure the demo song is loaded and paused at the start
  if (!(await topic('transport'))?.loaded) {
    await $('use-demo').click();
    await until('demo loaded', async () => (await topic('transport'))?.loaded, 15_000);
  }
  await $('btn-pause').click();
  await page.evaluate(() => window.__music.sendCommand('playback.tempo', 'button', { how: 'set', value: 1 }));

  await $('btn-calibrate').click();
  await until('the delay is measured', async () => /Delay measured: \d+/.test((await $('practice-latency').textContent()) ?? ''), 40_000);

  await $('btn-practice-start').click();
  await until('listening', async () => /listening|play along/i.test((await $('practice-status').textContent()) ?? ''), 15_000);
  await until('the song is playing', async () => (await topic('transport')).playing, 10_000);
  await sleep(9_000); // play along for a while
  await $('btn-pause').click(); // ends the run

  const fb = await until('feedback arrives', async () => (await topic('feedback')) ?? null, 40_000);
  assert.equal(fb.source, 'rules');
  assert.equal(fb.tempo.verdict, 'dragging', `a 10 percent slow player should be told they dragged, got ${JSON.stringify(fb.tempo)}`);
  assert.ok(fb.tempo.ratio > 0.8 && fb.tempo.ratio < 0.97, `ratio should be about 0.9, got ${fb.tempo.ratio}`);
  await $('feedback-card').waitFor({ state: 'visible', timeout: 10_000 });
  assert.ok(((await $('feedback-summary').textContent()) ?? '').length > 10);
  assert.ok(((await $('feedback-tempo').textContent()) ?? '').length > 5);
  // friendly coaching text arrives from the server (Gemini or the built-in tips), or from the local built-in sentence
  await until('coaching text', async () => ((await $('feedback-coaching').textContent().catch(() => '')) ?? '').length > 20, 30_000);
  // the run is saved and shows up in the history
  await until('the run appears in the history', async () => (await page.locator('[data-testid="history-runs"] li').count()) >= 1, 20_000);
  assert.ok(((await $('history-message').textContent()) ?? '').length > 5);
  // "loop this bar at 80%" sets up a slow loop
  const loopBtn = $('btn-loop-bar');
  if (await loopBtn.count()) {
    await loopBtn.click();
    await until('the loop button set the speed and loop', async () => (await control('playback.tempo')) === 0.8 && (await control('playback.loop')) === true, 8_000);
    await page.evaluate(() => {
      window.__music.sendCommand('playback.loop', 'button', { how: 'set', value: false });
      window.__music.sendCommand('playback.tempo', 'button', { how: 'set', value: 1 });
      window.__music.sendCommand('playback.pause', 'button', { how: 'trigger' });
    });
  }
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

test('Create mode: save the track, reload the page, and find it again', T, async () => {
  await $('input-track-name').fill('E2E melody');
  await $('btn-save-track').click();
  await until('saved', async () => /saved/i.test((await $('save-status').textContent()) ?? ''), 20_000);
  await page.reload();
  await $('tab-create').click();
  const item = await until('the saved track is listed', async () => ((await page.locator('[data-testid^="saved-track-"]').filter({ hasText: 'E2E melody' }).count()) > 0 ? true : null), 20_000);
  assert.ok(item);
  const index = await page.locator('[data-testid^="saved-track-"]').evaluateAll((els) => els.findIndex((e) => /E2E melody/.test(e.textContent ?? '')));
  assert.ok(index >= 0);
  await $(`btn-load-track-${index}`).click();
  // loading may ask first when there is unsaved work (a fresh page has none), then the layers appear
  const confirm = $('btn-confirm-load');
  if (await confirm.count()) await confirm.click();
  await until('the loaded track has notes', async () => Number((await $('layer-0-notes').textContent())?.match(/\d+/)?.[0] ?? 0) > 0, 15_000);
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

test('the entrance: enter with sound only, turn the records, open Learn', T, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await context.newPage();
  p.on('pageerror', (e) => problems.push(`page error (entrance): ${e.message}`));
  try {
    await p.goto(`${BASE}/?fake=1&intro=on`);
    await p.getByTestId('overture-entrance').waitFor({ state: 'visible', timeout: 20_000 });
    await p.getByTestId('entrance-enter-sound').click();
    await p.getByTestId('overture-menu').waitFor({ state: 'visible', timeout: 10_000 });
    const chosen = (mode) => p.getByTestId(`record-${mode}`).getAttribute('data-chosen');
    await until('Learn is the chosen record', async () => (await chosen('learn')) === 'true', 5_000);
    await p.keyboard.press('ArrowRight');
    await until('Play is chosen after one turn', async () => (await chosen('play')) === 'true', 5_000);
    await p.keyboard.press('ArrowLeft');
    await until('Learn is chosen again', async () => (await chosen('learn')) === 'true', 5_000);
    await p.getByTestId('record-learn').click();
    await p.getByTestId('overture-menu').waitFor({ state: 'detached', timeout: 10_000 });
    await p.getByTestId('use-demo').waitFor({ state: 'visible', timeout: 10_000 });
  } finally {
    await context.close();
  }
});

test('no errors appeared in the browser during the whole run', T, async () => {
  assert.deepEqual(problems, []);
});
