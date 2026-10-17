import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, resetControls, sendCommand, type ModuleStatus, type PitchFrame, type Stop } from '@/bus';
import type { LoopEngine, LoopHooks } from './engine';
import { startController } from './controller';
import { fakeHumFrames } from './fake-hum';
import { currentLayer, initialState, type Layer } from './layers';
import { buildBeatNotes } from './music';
import { createStore } from './store';

/** A stand-in for the sound engine that just writes down what it was asked to do. */
class FakeEngine implements LoopEngine {
  calls: string[] = [];
  layers: readonly Layer[] = [];
  hooks?: LoopHooks;
  master = -1;
  disposed = false;
  syncLayers(layers: readonly Layer[]) {
    this.layers = layers;
  }
  setMasterVolume(v: number) {
    this.master = v;
  }
  startLoop(opts: { countIn: boolean }, hooks?: LoopHooks) {
    this.calls.push(opts.countIn ? 'start:countIn' : 'start');
    this.hooks = hooks;
  }
  stopLoop() {
    this.calls.push('stop');
    this.hooks = undefined;
  }
  dispose() {
    this.disposed = true;
  }
}

let clock = 0;
let stopController: Stop | undefined;
let statuses: ModuleStatus[] = [];
let stopStatus: Stop | undefined;

function setup() {
  clock = 5000;
  const store = createStore(initialState());
  const engine = new FakeEngine();
  stopController = startController({ engine, store, now: () => clock, inputLatencyMs: 0, tailMs: 0 });
  return { store, engine };
}

/** Send pitch frames as if they arrived live: the clock moves to each frame's time first. */
function hum(frames: PitchFrame[], startAt: number) {
  for (const f of frames) {
    clock = startAt + f.t_ms;
    bus.emit('pitch', f);
  }
}

const controls = () => bus.last('controls') ?? {};
const send = (command: string, extra: Parameters<typeof sendCommand>[2] = {}) => sendCommand(command, 'button', extra);

/** Press Record, finish the count-in, hum the fake melody, and end the pass. */
function recordFakeTake(engine: FakeEngine, humAt = 5000) {
  send('create.loop.record', { how: 'toggle' });
  clock = humAt;
  engine.hooks!.onGo(humAt);
  hum(fakeHumFrames(0), humAt);
  engine.hooks!.onPassEnd();
}

beforeEach(() => {
  resetControls();
  bus.emit('mode', 'create');
  statuses = [];
  stopStatus = bus.on('status', (s) => s.module === 'create' && statuses.push(s));
});
afterEach(() => {
  stopController?.();
  stopStatus?.();
  stopController = undefined;
});

describe('create controller: only while in create mode', () => {
  it('ignores commands in other modes', () => {
    const { store } = setup();
    bus.emit('mode', 'learn');
    send('create.layer.add', { how: 'trigger' });
    send('create.loop.record', { how: 'toggle' });
    expect(store.getState().layers).toEqual([]);
    expect(store.getState().phase).toBe('idle');
  });

  it('stops the loop when you leave create mode', () => {
    const { store, engine } = setup();
    send('create.beat', { how: 'toggle' });
    expect(store.getState().phase).toBe('playing');
    bus.emit('mode', 'play');
    expect(store.getState().phase).toBe('idle');
    expect(engine.calls.at(-1)).toBe('stop');
  });
});

describe('create controller: layers', () => {
  it('create.layer.add adds an empty layer and makes it current', () => {
    const { store, engine } = setup();
    send('create.layer.add', { how: 'trigger' });
    send('create.layer.add', { how: 'trigger' });
    expect(store.getState().layers.map((l) => l.name)).toEqual(['Layer 1', 'Layer 2']);
    expect(currentLayer(store.getState())?.name).toBe('Layer 2');
    expect(engine.layers).toHaveLength(2);
  });

  it('sets instrument, volume and effect on the current layer', () => {
    const { store } = setup();
    send('create.layer.add', { how: 'trigger' });
    send('create.instrument', { how: 'set', value: 'bass' });
    send('create.layer.volume', { how: 'set', value: 0.4 });
    send('create.effects', { how: 'set', value: 'delay' });
    expect(currentLayer(store.getState())).toMatchObject({ instrument: 'bass', volume: 0.4, effects: 'delay' });
  });

  it('applies a choice even when the control already holds that value (picking it for a different layer)', () => {
    const { store } = setup();
    send('create.layer.add', { how: 'trigger' });
    send('create.instrument', { how: 'set', value: 'synth' });
    send('create.layer.add', { how: 'trigger' });
    send('create.instrument', { how: 'set', value: 'bass' });
    expect(controls()['create.instrument']).toBe('bass');
    store.dispatch({ type: 'selectLayer', id: store.getState().layers[0].id });
    send('create.instrument', { how: 'set', value: 'bass' }); // the control does not change, the layer must
    expect(store.getState().layers.map((l) => l.instrument)).toEqual(['bass', 'bass']);
  });

  it('nudges the volume from the layer\'s own volume and keeps it between 0 and 1', () => {
    const { store } = setup();
    send('create.layer.add', { how: 'trigger' });
    send('create.layer.volume', { how: 'set', value: 0.5 });
    send('create.layer.volume', { how: 'nudge', value: 0.2 });
    expect(currentLayer(store.getState())?.volume).toBeCloseTo(0.7);
    send('create.layer.volume', { how: 'nudge', value: 0.9 });
    expect(currentLayer(store.getState())?.volume).toBe(1);
  });

  it('ignores an instrument or effect it does not know', () => {
    const { store } = setup();
    send('create.layer.add', { how: 'trigger' });
    send('create.instrument', { how: 'set', value: 'banjo' });
    send('create.effects', { how: 'set', value: 'chorus' });
    expect(currentLayer(store.getState())).toMatchObject({ instrument: 'piano', effects: 'none' });
  });

  it('follows the overall volume control', () => {
    const { engine } = setup();
    send('playback.volume', { how: 'set', value: 0.3 });
    expect(engine.master).toBeCloseTo(0.3);
  });
});

describe('create controller: record', () => {
  it('counts in, listens, turns the hum into notes in the current layer, and keeps looping', () => {
    const { store, engine } = setup();
    send('create.layer.add', { how: 'trigger' });
    send('create.loop.record', { how: 'toggle' });
    expect(store.getState().phase).toBe('countIn');
    expect(engine.calls).toEqual(['start:countIn']);
    expect(controls()['create.loop.record']).toBe(true);

    engine.hooks!.onGo(6000);
    expect(store.getState().phase).toBe('recording');
    hum(fakeHumFrames(0), 6000);
    engine.hooks!.onPassEnd();

    const s = store.getState();
    expect(s.phase).toBe('playing');
    const layer = s.layers[0];
    expect(layer.notes.map((n) => n.pitch)).toEqual([55, 60, 67]);
    for (const n of layer.notes) expect(n.onset_beat! % 0.25).toBeCloseTo(0, 6);
    expect(layer.notes.at(-1)!.onset_sec + layer.notes.at(-1)!.duration_sec).toBeLessThanOrEqual(4.8 + 1e-6);
    expect(engine.calls).toEqual(['start:countIn']);
    expect(engine.layers[0].notes).toBe(layer.notes);
    expect(controls()['create.loop.record']).toBe(false);
  });

  it('makes a layer by itself when you record with none', () => {
    const { store, engine } = setup();
    recordFakeTake(engine);
    expect(store.getState().layers).toHaveLength(1);
    expect(store.getState().layers[0].notes).toHaveLength(3);
  });

  it('listens only after the count-in', () => {
    const { store, engine } = setup();
    send('create.loop.record', { how: 'toggle' });
    hum(fakeHumFrames(0), 5000); // hummed during the count-in
    engine.hooks!.onGo(8000);
    engine.hooks!.onPassEnd();
    expect(store.getState().layers[0].notes).toEqual([]);
  });

  it('ignores pitch frames when not recording', () => {
    const { store } = setup();
    hum(fakeHumFrames(0), 5000);
    expect(store.getState().layers).toEqual([]);
  });

  it('turning Record off in the middle ends the take and keeps what was hummed', () => {
    const { store, engine } = setup();
    send('create.loop.record', { how: 'toggle' });
    engine.hooks!.onGo(5000);
    hum(fakeHumFrames(0).slice(0, 63), 5000); // the first two notes (about 1.3 s)
    send('create.loop.record', { how: 'toggle' });
    expect(store.getState().layers[0].notes.map((n) => n.pitch)).toEqual([55, 60]);
    expect(store.getState().phase).toBe('playing');
    expect(controls()['create.loop.record']).toBe(false);
  });

  it('can record again right away (the record control goes back to off after a take)', () => {
    const { store, engine } = setup();
    recordFakeTake(engine);
    expect(store.getState().phase).toBe('playing');
    send('create.loop.record', { how: 'toggle' });
    expect(store.getState().phase).toBe('countIn');
    expect(engine.calls).toEqual(['start:countIn', 'start:countIn']);
  });

  it('a set command with an explicit true or false works too', () => {
    const { store } = setup();
    send('create.loop.record', { how: 'set', value: true });
    expect(store.getState().phase).toBe('countIn');
    send('create.loop.record', { how: 'set', value: false });
    expect(store.getState().phase).toBe('idle');
  });

  it('stopping during the count-in cancels the take and changes nothing', () => {
    const { store, engine } = setup();
    send('create.loop.record', { how: 'toggle' });
    send('create.loop.record', { how: 'toggle' });
    expect(store.getState().phase).toBe('idle');
    expect(engine.calls).toEqual(['start:countIn', 'stop']);
    expect(controls()['create.loop.record']).toBe(false);
    engine.hooks?.onGo(1); // a late engine callback must not bring it back
    expect(store.getState().phase).toBe('idle');
  });

  it('a take with no microphone sound says so and leaves the layer alone', () => {
    const { store, engine } = setup();
    send('create.loop.record', { how: 'toggle' });
    engine.hooks!.onGo(5000);
    engine.hooks!.onPassEnd();
    expect(store.getState().layers[0].notes).toEqual([]);
    expect(store.getState().message).toMatch(/microphone/i);
    // nothing to play, so the loop clock is stopped too
    expect(store.getState().phase).toBe('idle');
    expect(engine.calls.at(-1)).toBe('stop');
  });

  it('a take that heard only silence says no hum was heard', () => {
    const { store, engine } = setup();
    send('create.loop.record', { how: 'toggle' });
    engine.hooks!.onGo(5000);
    hum([{ t_ms: 0, midi: null, confidence: 0, rms: 0 }], 5000);
    engine.hooks!.onPassEnd();
    expect(store.getState().message).toMatch(/no hum/i);
  });

  it('puts a second take into a second layer and keeps the first', () => {
    const { store, engine } = setup();
    recordFakeTake(engine);
    send('create.layer.add', { how: 'trigger' });
    recordFakeTake(engine, 9000);
    const s = store.getState();
    expect(s.layers.map((l) => l.notes.length)).toEqual([3, 3]);
    expect(s.layers[0].notes).not.toBe(s.layers[1].notes);
  });
});

describe('create controller: stop and play', () => {
  it('create.loop.stop silences the loop', () => {
    const { store, engine } = setup();
    recordFakeTake(engine);
    send('create.loop.stop', { how: 'trigger' });
    expect(store.getState().phase).toBe('idle');
    expect(engine.calls.at(-1)).toBe('stop');
    expect(store.getState().layers[0].notes).toHaveLength(3);
  });

  it('create.loop.stop in the middle of a take stops it but keeps the notes', () => {
    const { store, engine } = setup();
    send('create.loop.record', { how: 'toggle' });
    engine.hooks!.onGo(5000);
    hum(fakeHumFrames(0).slice(0, 63), 5000);
    send('create.loop.stop', { how: 'trigger' });
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().layers[0].notes).toHaveLength(2);
    expect(controls()['create.loop.record']).toBe(false);
  });

  it('create.loop.stop during the count-in cancels it', () => {
    const { store, engine } = setup();
    send('create.loop.record', { how: 'toggle' });
    send('create.loop.stop', { how: 'trigger' });
    expect(store.getState().phase).toBe('idle');
    expect(engine.calls.at(-1)).toBe('stop');
    expect(controls()['create.loop.record']).toBe(false);
  });

  it('plays the loop again from the top after a stop', () => {
    const { store, engine } = setup();
    recordFakeTake(engine);
    send('create.loop.stop', { how: 'trigger' });
    send('create.loop.play', { how: 'trigger' });
    expect(store.getState().phase).toBe('playing');
    expect(engine.calls.at(-1)).toBe('start');
  });

  it('does not play when there is nothing to hear', () => {
    const { store, engine } = setup();
    send('create.layer.add', { how: 'trigger' });
    send('create.loop.play', { how: 'trigger' });
    expect(store.getState().phase).toBe('idle');
    expect(engine.calls).toEqual([]);
  });
});

describe('create controller: instrument change keeps the notes', () => {
  it('re-plays the layer with the new instrument and keeps every note', () => {
    const { store, engine } = setup();
    recordFakeTake(engine);
    send('create.loop.stop', { how: 'trigger' });
    const before = store.getState().layers[0].notes;
    send('create.instrument', { how: 'set', value: 'pluck' });
    const layer = store.getState().layers[0];
    expect(layer.instrument).toBe('pluck');
    expect(layer.notes).toBe(before);
    expect(engine.layers[0].instrument).toBe('pluck');
    expect(store.getState().phase).toBe('playing');
    expect(engine.calls.at(-1)).toBe('start');
  });

  it('does not restart a loop that is already playing', () => {
    const { engine } = setup();
    recordFakeTake(engine);
    const calls = engine.calls.length;
    send('create.instrument', { how: 'set', value: 'bass' });
    expect(engine.calls.length).toBe(calls);
    expect(engine.layers[0].instrument).toBe('bass');
  });
});

describe('create controller: beat', () => {
  it('beat on adds a drum layer and starts the loop; beat off removes it and stops', () => {
    const { store, engine } = setup();
    send('create.beat', { how: 'toggle' });
    expect(controls()['create.beat']).toBe(true);
    const beat = store.getState().layers.find((l) => l.kind === 'beat')!;
    expect(beat.instrument).toBe('drums');
    expect(beat.notes).toEqual(buildBeatNotes(100, 2));
    expect(store.getState().phase).toBe('playing');
    expect(engine.calls).toEqual(['start']);

    send('create.beat', { how: 'toggle' });
    expect(controls()['create.beat']).toBe(false);
    expect(store.getState().layers).toEqual([]);
    expect(store.getState().phase).toBe('idle');
    expect(engine.calls).toEqual(['start', 'stop']);
  });

  it('beat off keeps the loop going when a hummed layer is still there', () => {
    const { store, engine } = setup();
    recordFakeTake(engine);
    send('create.beat', { how: 'set', value: true });
    send('create.beat', { how: 'set', value: false });
    expect(store.getState().phase).toBe('playing');
    expect(store.getState().layers).toHaveLength(1);
    expect(engine.calls).toEqual(['start:countIn']);
  });

  it('an explicit on while already on changes nothing', () => {
    const { store } = setup();
    send('create.beat', { how: 'set', value: true });
    send('create.beat', { how: 'set', value: true });
    expect(store.getState().layers).toHaveLength(1);
  });
});

describe('create controller: status in plain words', () => {
  it('reports what is going on', () => {
    const { engine } = setup();
    send('create.layer.add', { how: 'trigger' });
    send('create.loop.record', { how: 'toggle' });
    engine.hooks!.onGo(5000);
    hum(fakeHumFrames(0), 5000);
    engine.hooks!.onPassEnd();
    send('create.layer.add', { how: 'trigger' });
    send('create.beat', { how: 'toggle' });
    const texts = statuses.map((s) => s.message);
    expect(texts).toContain('Get ready: counting in one bar');
    expect(texts).toContain('Recording: hum now');
    expect(texts.some((t) => /^Loop playing, 1 layer\b/.test(t ?? ''))).toBe(true);
    expect(texts.at(-1)).toBe('Loop playing, 2 layers. Recorded 3 notes');
    expect(statuses.every((s) => s.module === 'create')).toBe(true);
  });

  it('says the sound failed instead of crashing when the engine throws', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore(initialState());
    const engine = new FakeEngine();
    engine.startLoop = () => {
      throw new Error('no audio');
    };
    stopController = startController({ engine, store, now: () => clock });
    send('create.loop.record', { how: 'toggle' });
    expect(store.getState().phase).toBe('idle');
    expect(statuses.at(-1)?.state).toBe('error');
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
    expect(controls()['create.loop.record']).toBe(false);
  });
});

describe('create controller: stopping the module', () => {
  it('stops listening and shuts the engine down', () => {
    const { store, engine } = setup();
    stopController!();
    stopController = undefined;
    send('create.layer.add', { how: 'trigger' });
    expect(store.getState().layers).toEqual([]);
    expect(engine.disposed).toBe(true);
  });
});
