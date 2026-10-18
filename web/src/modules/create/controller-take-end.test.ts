// How a take ends: by itself after one pass of the default loop, or early by pressing Record again or the
// left-fist gesture (record off). Whichever comes first wins, and a take is never finished twice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, resetControls, sendCommand, type Stop } from '@/bus';
import type { LoopEngine, LoopHooks } from './engine';
import { startController } from './controller';
import { fakeHumFrames } from './fake-hum';
import { initialState, type Action } from './layers';
import { createStore } from './store';

class FakeEngine implements LoopEngine {
  hooks?: LoopHooks;
  syncLayers() {}
  setMasterVolume() {}
  startLoop(_opts: { countIn: boolean }, hooks?: LoopHooks) {
    this.hooks = hooks;
  }
  stopLoop() {}
  dispose() {}
}

const TAKE_START = 10_000;
const TAIL_MS = 60;
let clock = 0;
let stopController: Stop | undefined;

/** 120 bpm, 2 bars: the default pass is 8 beats, 4000 ms. */
function setup() {
  clock = 5000;
  const store = createStore(initialState({ bpm: 120, bars: 2 }));
  const engine = new FakeEngine();
  const ends: Action[] = [];
  const dispatch = store.dispatch.bind(store);
  store.dispatch = (a) => {
    if (a.type === 'recordEnd') ends.push(a);
    return dispatch(a);
  };
  stopController = startController({ engine, store, now: () => clock, inputLatencyMs: 0, tailMs: TAIL_MS });
  return { store, engine, ends };
}

/** Press Record, finish the count-in, and hum the fake melody (about 2 seconds). */
function startTakeAndHum(engine: FakeEngine) {
  sendCommand('create.loop.record', 'button', { how: 'toggle' });
  clock = TAKE_START;
  engine.hooks!.onGo(TAKE_START);
  for (const f of fakeHumFrames(0)) {
    clock = TAKE_START + f.t_ms;
    bus.emit('pitch', f);
  }
}

const pressRecord = () => sendCommand('create.loop.record', 'button', { how: 'toggle' });
const leftFist = () => sendCommand('create.loop.record', 'gesture', { how: 'trigger', value: false });

beforeEach(() => {
  vi.useFakeTimers();
  resetControls();
  bus.emit('mode', 'create');
});
afterEach(() => {
  stopController?.();
  stopController = undefined;
  vi.useRealTimers();
});

describe('Create take end', () => {
  it('ends by itself at the end of one loop pass, after a short tail', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 3990;
    engine.hooks!.onPassEnd(TAKE_START + 4000);
    vi.advanceTimersByTime(TAIL_MS);
    expect(store.getState().phase).toBe('recording'); // still listening for the last notes
    clock = TAKE_START + 4000 + TAIL_MS;
    vi.advanceTimersByTime(20);
    expect(store.getState().phase).toBe('playing');
    expect(ends).toHaveLength(1);
    expect(store.getState().layers[0].notes.map((n) => n.pitch)).toEqual([55, 60, 67]);
    expect(store.getState().layers[0].loopBeats).toBe(8);
  });

  it('ends early when Record is pressed again, with the loop length from the elapsed time in whole bars', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 3000; // 3 s at 120 bpm is 6 beats: the part-filled second bar is kept
    pressRecord();
    expect(store.getState().phase).toBe('playing');
    expect(ends).toHaveLength(1);
    expect(store.getState().layers[0].notes).toHaveLength(3);
    expect(store.getState().layers[0].loopBeats).toBe(8);
  });

  it('ends early on the left-fist gesture, with the loop length from the elapsed time in whole bars', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 2500; // 5 beats: one beat past the bar line counts as a late press, so one bar
    leftFist();
    expect(store.getState().phase).toBe('playing');
    expect(ends).toHaveLength(1);
    expect(store.getState().layers[0].loopBeats).toBe(4);
  });

  it('a late pass end does nothing after an early stop', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    const hooks = engine.hooks!;
    clock = TAKE_START + 3000;
    leftFist();
    hooks.onPassEnd(TAKE_START + 4000);
    vi.runAllTimers();
    expect(ends).toHaveLength(1);
    expect(store.getState().layers[0].loopBeats).toBe(8);
  });

  it('a gesture during the tail wins and the waiting pass end is dropped', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 3990;
    engine.hooks!.onPassEnd(TAKE_START + 4000);
    clock = TAKE_START + 4010;
    leftFist();
    expect(ends).toHaveLength(1);
    vi.runAllTimers();
    expect(ends).toHaveLength(1);
    expect(store.getState().phase).toBe('playing');
    expect(store.getState().layers[0].loopBeats).toBe(8);
  });

  it('the gesture and Record off at the same moment finish the take once', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 3000;
    leftFist();
    sendCommand('create.loop.record', 'button', { how: 'set', value: false });
    vi.runAllTimers();
    expect(ends).toHaveLength(1);
    expect(store.getState().phase).toBe('playing');
  });
});

describe('Create take start bar', () => {
  it('the layer keeps the loop-clock bar its take started on, so it plays back in the same place', () => {
    const { store, engine } = setup();
    sendCommand('create.loop.record', 'button', { how: 'toggle' });
    clock = TAKE_START;
    engine.hooks!.onGo(TAKE_START, 6);
    for (const f of fakeHumFrames(0)) {
      clock = TAKE_START + f.t_ms;
      bus.emit('pitch', f);
    }
    clock = TAKE_START + 3000;
    leftFist();
    expect(store.getState().layers[0].startBar).toBe(6);
    expect(store.getState().layers[0].loopBeats).toBe(8);
  });
});
