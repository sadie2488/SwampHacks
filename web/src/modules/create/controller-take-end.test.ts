// How a take ends. By itself after one pass of the loop: the take is kept and everything stops. Early, by pressing
// Record again, Stop, or the fist gestures (record off): the take is thrown away and everything stops. Either way a
// take is never finished twice, and the 4-count shows one number per count-in click.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, resetControls, sendCommand, type Stop } from '@/bus';
import type { LoopEngine, LoopHooks } from './engine';
import { startController } from './controller';
import { fakeHumFrames } from './fake-hum';
import { initialState, type Action } from './layers';
import { createStore } from './store';

class FakeEngine implements LoopEngine {
  hooks?: LoopHooks;
  calls: string[] = [];
  syncLayers() {}
  setMasterVolume() {}
  startLoop(opts: { countIn: boolean }, hooks?: LoopHooks) {
    this.calls.push(opts.countIn ? 'start:countIn' : 'start');
    this.hooks = hooks;
  }
  stopLoop() {
    this.calls.push('stop');
  }
  dispose() {}
}

const TAKE_START = 10_000;
const TAIL_MS = 60;
let clock = 0;
let stopController: Stop | undefined;

/** 120 bpm, 2 bars: the default pass is 8 beats, 4000 ms; one count-in beat is 500 ms. */
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

/** The engine hears the end of the pass a little early; the controller waits for it plus the tail. */
function passEnds(engine: FakeEngine) {
  clock = TAKE_START + 3990;
  engine.hooks!.onPassEnd(TAKE_START + 4000);
  clock = TAKE_START + 4000 + TAIL_MS;
  vi.advanceTimersByTime(TAIL_MS + 20);
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

describe('Create 4-count', () => {
  it('shows 4, 3, 2, 1, one number per count-in click, when each click is heard', () => {
    const { store, engine } = setup();
    sendCommand('create.loop.record', 'button', { how: 'toggle' });
    expect(store.getState().phase).toBe('countIn');
    expect(store.getState().countBeat).toBeUndefined();
    const seen: number[] = [];
    store.subscribe((s) => {
      if (s.countBeat !== undefined && seen.at(-1) !== s.countBeat) seen.push(s.countBeat);
    });
    const hooks = engine.hooks!;
    // the engine announces each click about 100 ms before it sounds
    for (let beat = 0; beat < 4; beat++) {
      const heardAt = 8000 + beat * 500;
      clock = heardAt - 100;
      hooks.onCountBeat!(beat, heardAt);
      expect(seen).toHaveLength(beat); // not yet: the click has not sounded
      clock = heardAt;
      vi.advanceTimersByTime(100);
      expect(seen).toHaveLength(beat + 1);
    }
    expect(seen).toEqual([4, 3, 2, 1]);
    clock = TAKE_START;
    hooks.onGo(TAKE_START);
    expect(store.getState().phase).toBe('recording');
    expect(store.getState().countBeat).toBeUndefined();
  });

  it('a waiting number is dropped when the count-in is cancelled', () => {
    const { store, engine } = setup();
    sendCommand('create.loop.record', 'button', { how: 'toggle' });
    engine.hooks!.onCountBeat!(0, clock + 100);
    pressRecord();
    vi.runAllTimers();
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().countBeat).toBeUndefined();
  });
});

describe('Create take end', () => {
  it('ends by itself at the end of one loop pass, after a short tail: the take is kept and everything stops', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 3990;
    engine.hooks!.onPassEnd(TAKE_START + 4000);
    vi.advanceTimersByTime(TAIL_MS);
    expect(store.getState().phase).toBe('recording'); // still listening for the last notes
    clock = TAKE_START + 4000 + TAIL_MS;
    vi.advanceTimersByTime(20);
    expect(store.getState().phase).toBe('idle');
    expect(ends).toHaveLength(1);
    expect(store.getState().layers[0].notes.map((n) => n.pitch)).toEqual([55, 60, 67]);
    expect(store.getState().layers[0].loopBeats).toBe(8);
    expect(engine.calls).toEqual(['start:countIn', 'stop']); // the other layers and the metronome fall silent
    expect(bus.last('controls')?.['create.loop.record']).toBe(false);
  });

  it('Play after a finished take starts the loop with the new layer', () => {
    const { store, engine } = setup();
    startTakeAndHum(engine);
    passEnds(engine);
    sendCommand('create.loop.play', 'button', { how: 'trigger' });
    expect(store.getState().phase).toBe('playing');
    expect(engine.calls).toEqual(['start:countIn', 'stop', 'start']);
  });

  it('pressing Record again early throws the take away and stops everything', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 3000;
    pressRecord();
    expect(store.getState().phase).toBe('idle');
    expect(ends).toHaveLength(0);
    expect(store.getState().layers[0].notes).toEqual([]);
    expect(store.getState().message).toMatch(/stopped early/i);
    expect(engine.calls).toEqual(['start:countIn', 'stop']);
    expect(bus.last('controls')?.['create.loop.record']).toBe(false);
  });

  it('the left-fist gesture early throws the take away too', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 2500;
    leftFist();
    expect(store.getState().phase).toBe('idle');
    expect(ends).toHaveLength(0);
    expect(store.getState().layers[0].notes).toEqual([]);
    expect(engine.calls).toEqual(['start:countIn', 'stop']);
  });

  it('an early stop keeps what the layer already had', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    passEnds(engine);
    const kept = store.getState().layers[0].notes;
    expect(kept).toHaveLength(3);
    // record over the same layer, then give up part-way
    engine.calls = [];
    startTakeAndHum(engine);
    clock = TAKE_START + 1000;
    sendCommand('create.loop.stop', 'button', { how: 'trigger' });
    expect(store.getState().phase).toBe('idle');
    expect(ends).toHaveLength(1);
    expect(store.getState().layers[0].notes).toBe(kept);
    expect(engine.calls).toContain('stop');
  });

  it('a late pass end does nothing after an early stop', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    const hooks = engine.hooks!;
    clock = TAKE_START + 3000;
    leftFist();
    hooks.onPassEnd(TAKE_START + 4000);
    vi.runAllTimers();
    expect(ends).toHaveLength(0);
    expect(store.getState().layers[0].notes).toEqual([]);
    expect(store.getState().phase).toBe('idle');
  });

  it('a gesture during the tail wins: the waiting pass end is dropped and the take is thrown away', () => {
    const { store, engine, ends } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 3990;
    engine.hooks!.onPassEnd(TAKE_START + 4000);
    clock = TAKE_START + 4010;
    leftFist();
    vi.runAllTimers();
    expect(ends).toHaveLength(0);
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().layers[0].notes).toEqual([]);
  });

  it('the gesture and Record off at the same moment stop once', () => {
    const { store, engine } = setup();
    startTakeAndHum(engine);
    clock = TAKE_START + 3000;
    leftFist();
    sendCommand('create.loop.record', 'button', { how: 'set', value: false });
    vi.runAllTimers();
    expect(store.getState().phase).toBe('idle');
    expect(engine.calls).toEqual(['start:countIn', 'stop']);
  });
});

describe('Create hand pitch', () => {
  it('is on by default for the selected layer once it has notes, and works while stopped', () => {
    const { store, engine } = setup();
    startTakeAndHum(engine);
    passEnds(engine);
    const layer = store.getState().layers[0];
    expect(layer.handPitchEnabled).toBe(true);
    expect(store.getState().phase).toBe('idle');
    sendCommand('create.layer.pitch', 'gesture', { how: 'set', value: 3 });
    expect(store.getState().layers[0].pitchSemitones).toBe(3);
    sendCommand('create.layer.confirm_pitch', 'gesture', { how: 'trigger' });
    expect(store.getState().layers[0].pitchConfirmed).toBe(true);
    expect(store.getState().layers[0].notes.map((n) => n.pitch)).toEqual([58, 63, 70]);
  });

  it('does nothing in the middle of a take', () => {
    const { store, engine } = setup();
    startTakeAndHum(engine);
    passEnds(engine);
    startTakeAndHum(engine);
    sendCommand('create.layer.pitch', 'gesture', { how: 'set', value: 3 });
    expect(store.getState().layers[0].pitchSemitones).toBe(0);
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
    passEnds(engine);
    expect(store.getState().layers[0].startBar).toBe(6);
    expect(store.getState().layers[0].loopBeats).toBe(8);
  });
});
