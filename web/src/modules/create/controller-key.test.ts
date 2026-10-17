// Create mode and keys: a finished take is moved into the song's key when "Snap to the key" is on, and the take gets a one-line summary.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bus, resetControls, sendCommand, type PitchFrame, type Stop } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { startController } from './controller';
import type { LoopEngine, LoopHooks } from './engine';
import { fakeHumFrames } from './fake-hum';
import { currentLayer, initialState, type Layer } from './layers';
import { createSettings, takeSummaryText, type SettingsStore } from './settings';
import { createStore } from './store';
import { track } from './synthetic-hum';

class FakeEngine implements LoopEngine {
  hooks?: LoopHooks;
  syncLayers(_layers: readonly Layer[]) {}
  setMasterVolume() {}
  startLoop(_opts: { countIn: boolean }, hooks?: LoopHooks) {
    this.hooks = hooks;
  }
  stopLoop() {
    this.hooks = undefined;
  }
  dispose() {}
}

const song = (id: string, key?: SongAnalysis['key']): SongAnalysis => ({
  version: 1,
  song_id: id,
  duration_sec: 10,
  tempo_bpm: 100,
  key: key as SongAnalysis['key'],
  time_signature: { numerator: 4, denominator: 4 },
  parts: [],
});
const cMajor = { tonic: 'C', mode: 'major' } as const;

let clock = 0;
let stopController: Stop | undefined;

function setup(settings: SettingsStore = createSettings()) {
  clock = 5000;
  const store = createStore(initialState());
  const engine = new FakeEngine();
  stopController = startController({ engine, store, settings, now: () => clock, inputLatencyMs: 0, tailMs: 0 });
  return { store, engine, settings };
}

function hum(frames: PitchFrame[], startAt: number) {
  for (const f of frames) {
    clock = startAt + f.t_ms;
    bus.emit('pitch', f);
  }
}

/** Press Record, finish the count-in, hum these frames, end the pass. */
function recordTake(engine: FakeEngine, frames: PitchFrame[]) {
  sendCommand('create.loop.record', 'button', { how: 'toggle' });
  clock = 5000;
  engine.hooks!.onGo(5000);
  hum(frames, 5000);
  engine.hooks!.onPassEnd();
}

/** Steady notes, 360 ms each with a short pause between them. */
const steady = (pitches: number[]) => track(pitches.flatMap((midi) => [{ midi, ms: 360 }, { gap: 100 }]));
const layerPitches = (store: ReturnType<typeof setup>['store']) => currentLayer(store.getState())!.notes.map((n) => n.pitch);

beforeEach(() => {
  resetControls();
  bus.emit('mode', 'create');
});
afterEach(() => {
  stopController?.();
  stopController = undefined;
});

describe('snap to the key', () => {
  it('moves out-of-key notes into the song key and says how many it moved', () => {
    bus.emit('analysis', song('snap-1', cMajor));
    const { store, engine, settings } = setup();
    expect(settings.getState().snap).toBe(true);
    recordTake(engine, steady([60, 61, 64, 67, 66, 62]));
    expect(layerPitches(store)).toEqual([60, 60, 64, 67, 65, 62]);
    expect(settings.getState().take).toEqual({ notes: 6, key: cMajor, moved: 2 });
    expect(takeSummaryText(settings.getState().take!)).toBe('6 notes, key of C major, 2 moved into the key');
  });

  it('shows "3 notes, key of C major" for the fake hum with a C major song', () => {
    bus.emit('analysis', song('snap-2', cMajor));
    const { engine, settings } = setup();
    recordTake(engine, fakeHumFrames(0));
    expect(takeSummaryText(settings.getState().take!)).toBe('3 notes, key of C major');
  });

  it('keeps the usual "Recorded N notes" message', () => {
    bus.emit('analysis', song('snap-3', cMajor));
    const { store, engine } = setup();
    recordTake(engine, steady([60, 61, 64]));
    expect(store.getState().message).toBe('Recorded 3 notes');
  });

  it('leaves the notes as hummed when snapping is turned off, but still names the key of the take', () => {
    bus.emit('analysis', song('snap-4', cMajor));
    const { store, engine, settings } = setup();
    settings.set({ snap: false });
    recordTake(engine, steady([60, 62, 64, 65, 67, 61, 60]));
    expect(layerPitches(store)).toEqual([60, 62, 64, 65, 67, 61, 60]);
    expect(settings.getState().take).toMatchObject({ notes: 7, moved: 0 });
    expect(settings.getState().take!.key).toBeDefined();
  });

  it('is off with no song loaded: the take stays as hummed', () => {
    bus.emit('analysis', song('snap-5')); // a song without a key
    const { store, engine, settings } = setup();
    expect(settings.getState().snap).toBe(false);
    recordTake(engine, steady([60, 62, 64, 65, 67, 61, 60]));
    expect(layerPitches(store)).toEqual([60, 62, 64, 65, 67, 61, 60]);
  });

  it('can be turned on with no song: the key is guessed from the take', () => {
    bus.emit('analysis', song('snap-6'));
    const { store, engine, settings } = setup();
    settings.set({ snap: true });
    recordTake(engine, steady([60, 62, 64, 65, 67, 65, 64, 62, 61, 60]));
    expect(layerPitches(store)).toEqual([60, 62, 64, 65, 67, 65, 64, 62, 60, 60]);
    expect(settings.getState().take).toEqual({ notes: 10, key: { tonic: 'C', mode: 'major' }, moved: 1 });
  });

  it('follows a song that arrives later, and clears the summary when a new take starts', () => {
    const { engine, settings } = setup();
    expect(settings.getState().snap).toBe(false);
    bus.emit('analysis', song('snap-7', { tonic: 'G', mode: 'major' }));
    expect(settings.getState()).toMatchObject({ snap: true, songKey: { tonic: 'G', mode: 'major' } });
    recordTake(engine, steady([67, 69, 71, 72]));
    expect(settings.getState().take?.key).toEqual({ tonic: 'G', mode: 'major' });
    sendCommand('create.loop.record', 'button', { how: 'toggle' });
    expect(settings.getState().take).toBeUndefined();
  });

  it('works with no analysis at all: the fake hum still becomes three notes', () => {
    const { store, engine, settings } = setup();
    recordTake(engine, fakeHumFrames(0));
    expect(layerPitches(store)).toEqual([55, 60, 67]);
    expect(settings.getState().take?.notes).toBe(3);
    expect(takeSummaryText(settings.getState().take!)).toMatch(/^3 notes/);
  });

  it('an empty take is summarised as no notes', () => {
    bus.emit('analysis', song('snap-8', cMajor));
    const { engine, settings } = setup();
    recordTake(engine, track([{ gap: 1000 }]));
    expect(settings.getState().take).toMatchObject({ notes: 0, moved: 0 });
  });
});
