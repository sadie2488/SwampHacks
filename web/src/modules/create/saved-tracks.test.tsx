// @vitest-environment jsdom
// Saving and opening tracks on the Create screen, in a fake page: the part on its own with a pretend server,
// then the whole panel with no server at all (tracks kept on this computer).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, resetControls, type Stop } from '@/bus';
import type { CommandEvent, Note } from '@/contracts';
import type { ListResult, OpenResult, SaveResult, TrackSummary } from './api';
import { STORAGE_KEY } from './api';
import { startController } from './controller';
import { fakeHumFrames } from './fake-hum';
import type { LoopEngine, LoopHooks } from './engine';
import { CreatePanel, start } from './index';
import { initialState, type Layer } from './layers';
import { SavedTracks, type SavedTracksApi } from './saved-tracks';
import { layersToPayload, payloadToLayers, type TrackPayload } from './serialize';
import { createStore } from './store';

const engineCalls = vi.hoisted(() => ({ hooks: undefined as LoopHooks | undefined, starts: [] as unknown[], stops: 0 }));
vi.mock('./tone-engine', () => ({
  createToneEngine: () => ({
    syncLayers() {},
    setMasterVolume() {},
    startLoop(opts: unknown, hooks?: LoopHooks) {
      engineCalls.starts.push(opts);
      engineCalls.hooks = hooks;
    },
    stopLoop() {
      engineCalls.stops++;
      engineCalls.hooks = undefined;
    },
    dispose() {},
  }),
}));
vi.mock('@/bus', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/bus')>()), resumeAudio: vi.fn(async () => {}) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (beat: number, pitch = 60): Note => ({ pitch, onset_sec: beat * 0.6, duration_sec: 0.6, onset_beat: beat, duration_beat: 1 });
const humLayer = (n: number, notes: Note[] = [note(0), note(1, 64)]): Layer => ({ id: `layer-${n}`, name: `Layer ${n}`, kind: 'hum', instrument: 'piano', volume: 0.8, effects: 'none', muted: false, notes });
const payloadOf = (layers: Layer[], name = 'Saved one', bpm = 100): TrackPayload => layersToPayload(layers, bpm, name);
const summary = (over: Partial<TrackSummary> = {}): TrackSummary => ({ id: 's1', name: 'Saved one', tempo_bpm: 100, created_at: '2026-03-04T12:00:00Z', layer_count: 2, local: false, ...over });
const opened = (layers: Layer[], name = 'Saved one'): OpenResult => ({ ok: true, track: payloadToLayers(payloadOf(layers, name))! });

function makeApi(over: Partial<SavedTracksApi> = {}) {
  const api = {
    saveTrack: vi.fn(async (p: TrackPayload): Promise<SaveResult> => ({ ok: true, id: 's9', name: p.name, local: false })),
    listTracks: vi.fn(async (): Promise<ListResult> => ({ tracks: [] })),
    loadTrack: vi.fn(async (): Promise<OpenResult> => opened([humLayer(1)])),
    ...over,
  };
  return api;
}

let container: HTMLDivElement;
let root: Root;
let stops: Stop[] = [];
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => $(id)?.textContent ?? '';
const click = (id: string) => act(async () => void $(id)!.click());
const typeName = (value: string) =>
  act(async () => {
    const input = $('input-track-name') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const render = (ui: React.ReactElement) => act(async () => root.render(ui));
const commands: string[] = [];

beforeEach(() => {
  resetControls();
  bus.emit('mode', 'create');
  commands.length = 0;
  stops = [bus.on('command', (c: CommandEvent) => void commands.push(c.command))];
  engineCalls.starts = [];
  engineCalls.stops = 0;
  engineCalls.hooks = undefined;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  stops.forEach((s) => s());
  container.remove();
  localStorage.clear();
});

/** A store with one recorded layer in it and a controller on it, like the real screen has. */
function liveStore(layers: Layer[] = []) {
  const store = createStore(initialState());
  const engine: LoopEngine = { syncLayers: vi.fn(), setMasterVolume: vi.fn(), startLoop: vi.fn(), stopLoop: vi.fn(), dispose: vi.fn() };
  stops.push(startController({ engine, store }));
  if (layers.length > 0) store.dispatch({ type: 'loadTrack', bpm: 100, bars: 2, layers });
  return { store, engine };
}

describe('saving', () => {
  it('has a name box that starts as "My track", and Save is off with nothing recorded', async () => {
    const { store } = liveStore();
    await render(<SavedTracks store={store} api={makeApi()} />);
    expect(($('input-track-name') as HTMLInputElement).value).toBe('My track');
    expect(($('btn-save-track') as HTMLButtonElement).disabled).toBe(true);
    expect($('btn-save-track')?.textContent).toBe('Save this track');
    expect(text('save-status')).toBe('');
  });

  it('Save turns on once something is recorded, and an empty layer is not enough', async () => {
    const { store } = liveStore();
    await render(<SavedTracks store={store} api={makeApi()} />);
    await act(async () => void store.dispatch({ type: 'addLayer' }));
    expect(($('btn-save-track') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => void store.dispatch({ type: 'loadTrack', bpm: 100, bars: 2, layers: [humLayer(1)] }));
    expect(($('btn-save-track') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the layers and the typed name, then says "Saved as <name>" and refreshes the list', async () => {
    const { store } = liveStore([humLayer(1), humLayer(2)]);
    const api = makeApi();
    await render(<SavedTracks store={store} api={api} />);
    expect(api.listTracks).toHaveBeenCalledTimes(1);
    await typeName('Sunny tune');
    await click('btn-save-track');
    expect(api.saveTrack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.saveTrack).mock.calls[0][0]).toEqual(payloadOf([humLayer(1), humLayer(2)], 'Sunny tune'));
    expect(text('save-status')).toBe('Saved as Sunny tune');
    expect(api.listTracks).toHaveBeenCalledTimes(2);
  });

  it('says plainly when it was kept on this computer only', async () => {
    const { store } = liveStore([humLayer(1)]);
    const api = makeApi({ saveTrack: vi.fn(async (p: TrackPayload): Promise<SaveResult> => ({ ok: true, id: 'local-1', name: p.name, local: true, reason: 'The server could not be reached.' })) });
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-save-track');
    expect(text('save-status')).toBe('Saved as My track on this computer only. The server could not be reached.');
  });

  it('shows the reason when saving fails, and the button works again', async () => {
    const { store } = liveStore([humLayer(1)]);
    const api = makeApi({ saveTrack: vi.fn(async (): Promise<SaveResult> => ({ ok: false, message: 'The server did not save this track. The name is too long.' })) });
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-save-track');
    expect(text('save-status')).toBe('The server did not save this track. The name is too long.');
    expect($('save-status')?.getAttribute('data-problem')).toBe('true');
    expect(($('btn-save-track') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores a second click while the first save is still going', async () => {
    const { store } = liveStore([humLayer(1)]);
    let finish!: (r: SaveResult) => void;
    const api = makeApi({ saveTrack: vi.fn(() => new Promise<SaveResult>((r) => (finish = r))) });
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-save-track');
    expect(text('save-status')).toBe('Saving…');
    expect(($('btn-save-track') as HTMLButtonElement).disabled).toBe(true);
    await click('btn-save-track');
    expect(api.saveTrack).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, id: 'x', name: 'My track', local: false }));
    expect(text('save-status')).toBe('Saved as My track');
  });
});

describe('the list', () => {
  it('shows each saved track with its name, tempo, layers and date, and Load and Play buttons', async () => {
    const { store } = liveStore();
    const tracks = [summary({ name: 'Newest', layer_count: 3 }), summary({ id: 's2', name: 'Older', tempo_bpm: 90, layer_count: 1 })];
    await render(<SavedTracks store={store} api={makeApi({ listTracks: vi.fn(async () => ({ tracks })) })} />);
    expect($('saved-tracks')?.hidden).toBe(false);
    expect(text('saved-track-0-name')).toBe('Newest');
    expect(text('saved-track-0')).toContain('100 beats per minute');
    expect(text('saved-track-0')).toContain('3 layers');
    expect(text('saved-track-0')).toContain('2026');
    expect(text('saved-track-1')).toContain('90 beats per minute');
    expect(text('saved-track-1')).toContain('1 layer');
    expect(text('saved-track-1')).not.toContain('1 layers');
    expect(text('btn-load-track-0')).toBe('Load');
    expect(text('btn-play-track-1')).toBe('Play');
    expect($('saved-track-2')).toBeNull();
    expect($('saved-track-0-local')).toBeNull();
    expect($('saved-tracks-empty')).toBeNull();
  });

  it('marks tracks that live only on this computer', async () => {
    const { store } = liveStore();
    const tracks = [summary({ id: 'local-1', local: true }), summary({ id: 's2' })];
    await render(<SavedTracks store={store} api={makeApi({ listTracks: vi.fn(async () => ({ tracks })) })} />);
    expect(text('saved-track-0-local')).toBe('saved on this computer only');
    expect($('saved-track-1-local')).toBeNull();
  });

  it('says when there are none, and shows the notice about the server', async () => {
    const { store } = liveStore();
    const api = makeApi({ listTracks: vi.fn(async () => ({ tracks: [], notice: 'The server could not be reached. Only tracks saved on this computer are shown.' })) });
    await render(<SavedTracks store={store} api={api} />);
    expect(text('saved-tracks-empty')).toBe('No saved tracks yet.');
    expect(text('tracks-notice')).toContain('Only tracks saved on this computer are shown');
    expect($('saved-tracks')?.hidden).toBe(true);
  });

  it('the refresh button asks again and shows the new list', async () => {
    const { store } = liveStore();
    const listTracks = vi.fn<() => Promise<ListResult>>().mockResolvedValueOnce({ tracks: [] }).mockResolvedValueOnce({ tracks: [summary({ name: 'Just arrived' })] });
    await render(<SavedTracks store={store} api={makeApi({ listTracks })} />);
    expect($('saved-track-0')).toBeNull();
    await click('btn-refresh-tracks');
    expect(listTracks).toHaveBeenCalledTimes(2);
    expect(text('saved-track-0-name')).toBe('Just arrived');
  });

  it('does not complain if the screen closes before the list arrives', async () => {
    const { store } = liveStore();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let arrive!: (r: ListResult) => void;
    await render(<SavedTracks store={store} api={makeApi({ listTracks: vi.fn(() => new Promise<ListResult>((r) => (arrive = r))) })} />);
    await act(async () => root.render(<div />));
    await act(async () => arrive({ tracks: [summary()] }));
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('loading', () => {
  const listed = (over: Partial<SavedTracksApi> = {}) => makeApi({ listTracks: vi.fn(async () => ({ tracks: [summary()] })), ...over });

  it('puts the saved layers in place of the current ones, with no warning when nothing is unsaved', async () => {
    const { store } = liveStore();
    const api = listed({ loadTrack: vi.fn(async () => opened([humLayer(1), humLayer(2, [note(2)])], 'Saved one')) });
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-load-track-0');
    expect($('load-warning')).toBeNull();
    expect(store.getState().layers.map((l) => l.id)).toEqual(['layer-1', 'layer-2']);
    expect(text('save-status')).toBe('Opened Saved one');
    expect((($('input-track-name')) as HTMLInputElement).value).toBe('Saved one');
    expect(commands).not.toContain('create.loop.play');
    expect(store.getState().phase).toBe('idle');
  });

  it('asks what to do first when there are unsaved layers, and Keep leaves them alone', async () => {
    const mine = humLayer(1, [note(5, 72)]);
    const { store } = liveStore([mine]);
    const api = listed();
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-load-track-0');
    expect(text('load-warning')).toContain('not saved');
    expect(text('load-warning')).toContain('replace');
    expect(api.loadTrack).not.toHaveBeenCalled();
    await click('btn-cancel-load');
    expect($('load-warning')).toBeNull();
    expect(store.getState().layers[0].notes).toEqual(mine.notes);
    expect(api.loadTrack).not.toHaveBeenCalled();
  });

  it('replaces them after the person says yes', async () => {
    const { store } = liveStore([humLayer(1, [note(5, 72)])]);
    const api = listed({ loadTrack: vi.fn(async () => opened([humLayer(1, [note(0, 55)])])) });
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-load-track-0');
    await click('btn-confirm-load');
    expect($('load-warning')).toBeNull();
    expect(store.getState().layers[0].notes[0].pitch).toBe(55);
  });

  it('does not warn about layers that were just saved, but warns again after a change', async () => {
    const { store } = liveStore([humLayer(1)]);
    const api = listed();
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-save-track');
    await click('btn-load-track-0');
    expect($('load-warning')).toBeNull();
    expect(api.loadTrack).toHaveBeenCalledTimes(1);
    await act(async () => void store.dispatch({ type: 'setMuted', id: 'layer-1', muted: true }));
    await click('btn-load-track-0');
    expect($('load-warning')).not.toBeNull();
    expect(api.loadTrack).toHaveBeenCalledTimes(1);
  });

  it('does not warn when there is only an empty layer', async () => {
    const { store } = liveStore();
    store.dispatch({ type: 'addLayer' });
    await render(<SavedTracks store={store} api={listed()} />);
    await click('btn-load-track-0');
    expect($('load-warning')).toBeNull();
    expect(store.getState().layers[0].notes).toHaveLength(2);
  });

  it('says why when the track cannot be opened, and leaves the layers as they were', async () => {
    const mine = humLayer(1, [note(5, 72)]);
    const { store } = liveStore([mine]);
    store.dispatch({ type: 'selectLayer', id: 'layer-1' });
    const api = listed({ loadTrack: vi.fn(async (): Promise<OpenResult> => ({ ok: false, message: 'Could not open that track. The server took too long to answer.' })) });
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-load-track-0');
    await click('btn-confirm-load');
    expect(text('save-status')).toBe('Could not open that track. The server took too long to answer.');
    expect(store.getState().layers[0].notes).toEqual(mine.notes);
  });

  it('mentions notes that had to be left out', async () => {
    const { store } = liveStore();
    const track = payloadToLayers({ name: 'Rough', tempo_bpm: 100, layers: [{ name: 'a', notes: [note(0), { pitch: 'x' }, { pitch: 999 }] }] })!;
    await render(<SavedTracks store={store} api={listed({ loadTrack: vi.fn(async (): Promise<OpenResult> => ({ ok: true, track })) })} />);
    await click('btn-load-track-0');
    expect(text('save-status')).toBe('Opened Rough (2 notes could not be used and were left out)');
  });

  it('cannot be used during a take', async () => {
    const { store } = liveStore([humLayer(1)]);
    await render(<SavedTracks store={store} api={listed()} />);
    await act(async () => void store.dispatch({ type: 'recordStart' }));
    expect(($('btn-load-track-0') as HTMLButtonElement).disabled).toBe(true);
    expect(($('btn-play-track-0') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('playing', () => {
  const listed = (over: Partial<SavedTracksApi> = {}) => makeApi({ listTracks: vi.fn(async () => ({ tracks: [summary()] })), ...over });

  it('loads the track and starts the loop with the same command as the Play loop button', async () => {
    const { store, engine } = liveStore();
    await render(<SavedTracks store={store} api={listed()} />);
    await click('btn-play-track-0');
    expect(commands).toContain('create.loop.play');
    expect(store.getState().layers).toHaveLength(1);
    expect(store.getState().phase).toBe('playing');
    expect(engine.startLoop).toHaveBeenCalledWith({ countIn: false });
    expect(text('save-status')).toBe('Playing Saved one');
  });

  it('the command it sends is a button command, like the other buttons', async () => {
    const { store } = liveStore();
    const seen: CommandEvent[] = [];
    stops.push(bus.on('command', (c) => void seen.push(c)));
    await render(<SavedTracks store={store} api={listed()} />);
    await click('btn-play-track-0');
    expect(seen.find((c) => c.command === 'create.loop.play')).toMatchObject({ source: 'button', how: 'trigger' });
  });

  it('warns first about unsaved layers, then plays after the person agrees', async () => {
    const { store, engine } = liveStore([humLayer(1, [note(5, 72)])]);
    await render(<SavedTracks store={store} api={listed()} />);
    await click('btn-play-track-0');
    expect($('load-warning')).not.toBeNull();
    expect(engine.startLoop).not.toHaveBeenCalled();
    await click('btn-confirm-load');
    expect(engine.startLoop).toHaveBeenCalledWith({ countIn: false });
    expect(store.getState().phase).toBe('playing');
  });

  it('swaps a loop that is already playing for the new track', async () => {
    const { store, engine } = liveStore();
    const api = listed();
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-play-track-0');
    await click('btn-play-track-0');
    // the second press happened with the loop running: it was stopped, the layers swapped, and it started again
    expect(commands.filter((c) => c === 'create.loop.stop')).toHaveLength(1);
    expect(engine.stopLoop).toHaveBeenCalled();
    expect(engine.startLoop).toHaveBeenCalledTimes(2);
    expect(store.getState().phase).toBe('playing');
  });

  it('does not start anything when the track cannot be opened', async () => {
    const { store, engine } = liveStore();
    const api = listed({ loadTrack: vi.fn(async (): Promise<OpenResult> => ({ ok: false, message: 'That track is no longer saved on this computer.' })) });
    await render(<SavedTracks store={store} api={api} />);
    await click('btn-play-track-0');
    expect(engine.startLoop).not.toHaveBeenCalled();
    expect(commands).not.toContain('create.loop.play');
    expect(text('save-status')).toBe('That track is no longer saved on this computer.');
  });

  it('says so when Create mode is not active and it cannot play', async () => {
    const { store, engine } = liveStore();
    bus.emit('mode', 'learn');
    await render(<SavedTracks store={store} api={listed()} />);
    await click('btn-play-track-0');
    expect(engine.startLoop).not.toHaveBeenCalled();
    expect(text('save-status')).toContain('Create mode is not active');
    expect(store.getState().layers).toHaveLength(1);
  });

  it('wakes the audio on the click', async () => {
    const { resumeAudio } = await import('@/bus');
    const { store } = liveStore();
    await render(<SavedTracks store={store} api={listed()} />);
    vi.mocked(resumeAudio).mockClear();
    await click('btn-play-track-0');
    expect(resumeAudio).toHaveBeenCalled();
  });
});

describe('the whole Create screen with no server', () => {
  const clock = { now: 1000 };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  });
  afterEach(() => void vi.useRealTimers());

  const humFake = () =>
    act(async () => {
      engineCalls.hooks!.onGo(1000);
      for (const f of fakeHumFrames(0)) {
        clock.now = 1000 + f.t_ms;
        bus.emit('pitch', { ...f, t_ms: clock.now });
      }
      vi.advanceTimersByTime(500);
    });

  it('keeps a recorded track on this computer, lists it after "reloading", and plays it back', async () => {
    stops.push(start());
    await render(<CreatePanel />);

    // nothing recorded yet
    expect(($('input-track-name') as HTMLInputElement).value).toBe('My track');
    expect(($('btn-save-track') as HTMLButtonElement).disabled).toBe(true);
    expect($('saved-track-0')).toBeNull();

    // record the fake melody
    await click('btn-record');
    await humFake();
    await act(async () => engineCalls.hooks!.onPassEnd());
    expect(text('layer-0-notes')).toBe('3');
    expect(($('btn-save-track') as HTMLButtonElement).disabled).toBe(false);

    // save: the server is not there, so it stays on this computer
    await typeName('Hum one');
    await click('btn-save-track');
    expect(text('save-status')).toMatch(/^Saved as Hum one on this computer only\./);
    expect(text('saved-track-0-name')).toBe('Hum one');
    expect(text('saved-track-0-local')).toBe('saved on this computer only');
    expect(text('saved-track-0')).toContain('1 layer');
    const kept = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Array<{ name: string; layers: Array<{ notes: unknown[] }> }>;
    expect(kept).toHaveLength(1);
    expect(kept[0].layers[0].notes).toHaveLength(3);

    // reload the page: a new screen reads the list again from storage
    await act(async () => root.render(<div />));
    await render(<CreatePanel />);
    expect(text('saved-track-0-name')).toBe('Hum one');
    expect(text('tracks-notice')).toContain('Only tracks saved on this computer are shown');

    // stop the loop, then Play from the list
    await click('btn-stop-loop');
    engineCalls.starts = [];
    await click('btn-play-track-0');
    expect($('load-warning')).toBeNull(); // the layers were saved, so nothing is lost
    expect(commands).toContain('create.loop.play');
    expect(engineCalls.starts).toEqual([{ countIn: false }]);
    expect(text('save-status')).toBe('Playing Hum one');
    expect(text('layer-0-notes')).toBe('3');

    // a change after that (muting the layer) makes opening a track ask first
    await click('layer-0-mute');
    await click('btn-load-track-0');
    expect(text('load-warning')).toContain('not saved');
    await click('btn-cancel-load');
    expect($('load-warning')).toBeNull();
    expect(($('layer-0-mute') as HTMLInputElement).checked).toBe(true);
  });
});
