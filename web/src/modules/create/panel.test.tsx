// @vitest-environment jsdom
// The Create screen: the "Snap to the key" box and the one-line summary of a take, in a fake page.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, resetControls, type Stop } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { fakeHumFrames } from './fake-hum';
import type { LoopHooks } from './engine';
import { CreatePanel, start } from './index';

const fakeEngine = vi.hoisted(() => ({ hooks: undefined as LoopHooks | undefined }));
vi.mock('./tone-engine', () => ({
  createToneEngine: () => ({
    syncLayers() {},
    setMasterVolume() {},
    startLoop(_opts: unknown, hooks?: LoopHooks) {
      fakeEngine.hooks = hooks;
    },
    stopLoop() {
      fakeEngine.hooks = undefined;
    },
    dispose() {},
  }),
}));
vi.mock('@/bus', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/bus')>()), resumeAudio: vi.fn(async () => {}) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = (id: string, key?: SongAnalysis['key']): SongAnalysis => ({
  version: 1,
  song_id: id,
  duration_sec: 10,
  tempo_bpm: 100,
  key: key as SongAnalysis['key'],
  time_signature: { numerator: 4, denominator: 4 },
  parts: [],
});

let container: HTMLDivElement;
let root: Root;
let stopCreate: Stop | undefined;
let n = 0;
let clock = 0;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const snap = () => $('toggle-snap') as HTMLInputElement;
const click = (id: string) => act(async () => void $(id)!.click());
const emitAnalysis = (a: SongAnalysis) => act(async () => void bus.emit('analysis', a));

/** Hum the fake melody: the page clock moves to each frame's time before the frame arrives. */
const humFake = () =>
  act(async () => {
    fakeEngine.hooks!.onGo(1000);
    for (const f of fakeHumFrames(0)) {
      clock = 1000 + f.t_ms;
      bus.emit('pitch', { ...f, t_ms: clock });
    }
    vi.advanceTimersByTime(500);
  });

beforeEach(async () => {
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  resetControls();
  bus.emit('mode', 'create');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => root.unmount());
  stopCreate?.();
  stopCreate = undefined;
  container.remove();
});

const render = () => act(async () => root.render(<CreatePanel />));

describe('Snap to the key', () => {
  it('is there, labelled, and off when no song is loaded', async () => {
    await render();
    expect(snap()).not.toBeNull();
    expect(snap().type).toBe('checkbox');
    expect(container.textContent).toContain('Snap to the key');
    expect($('take-summary')).toBeNull();
  });

  it('turns on by itself when a song with a key is loaded, and off for a song without one', async () => {
    await render();
    await emitAnalysis(song(`panel-${++n}`, { tonic: 'C', mode: 'major' }));
    expect(snap().checked).toBe(true);
    await emitAnalysis(song(`panel-${++n}`));
    expect(snap().checked).toBe(false);
  });

  it('is already on when the screen opens after a song was loaded', async () => {
    bus.emit('analysis', song(`panel-${++n}`, { tonic: 'F', mode: 'major' }));
    await render();
    expect(snap().checked).toBe(true);
  });

  it('can be switched by the person, and the same song arriving again does not undo that', async () => {
    const a = song(`panel-${++n}`, { tonic: 'C', mode: 'major' });
    await render();
    await emitAnalysis(a);
    await click('toggle-snap');
    expect(snap().checked).toBe(false);
    await emitAnalysis(a);
    expect(snap().checked).toBe(false);
    await click('toggle-snap');
    expect(snap().checked).toBe(true);
  });
});

describe('take summary', () => {
  // the "note you are humming" label clears itself on a timer; run that timer inside the test
  beforeEach(() => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => void vi.useRealTimers());

  it('shows the notes and the key after a take, and hides the old line when a new take starts', async () => {
    stopCreate = start();
    await render();
    await emitAnalysis(song(`panel-${++n}`, { tonic: 'C', mode: 'major' }));
    expect($('take-summary')).toBeNull();

    await click('btn-record');
    await humFake();
    // the take ends when the loop pass ends
    await act(async () => fakeEngine.hooks!.onPassEnd());
    expect($('take-summary')?.textContent).toBe('3 notes, key of C major');
    expect(snap().checked).toBe(true);

    await click('btn-record');
    expect($('take-summary')).toBeNull();
  });

  it('still shows a summary with no song loaded', async () => {
    stopCreate = start();
    await render();
    await emitAnalysis(song(`panel-${++n}`));
    expect(snap().checked).toBe(false);
    await click('btn-record');
    await humFake();
    await act(async () => fakeEngine.hooks!.onPassEnd());
    expect($('take-summary')?.textContent).toMatch(/^3 notes/);
  });
});
