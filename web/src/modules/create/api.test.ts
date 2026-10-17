import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/contracts';
import { listTracks, loadTrack, LOCAL_PREFIX, MAX_LOCAL_TRACKS, saveTrack, STORAGE_KEY, TIMEOUT_MS, type ApiDeps } from './api';
import type { TrackPayload } from './serialize';

const note: Note = { pitch: 60, onset_sec: 0, duration_sec: 0.6, onset_beat: 0, duration_beat: 1 };
const payload = (name = 'My track'): TrackPayload => ({
  name,
  tempo_bpm: 100,
  layers: [{ name: 'Layer 1', kind: 'hum', instrument: 'piano', volume: 0.8, effect: 'none', muted: false, notes: [note] }],
});

/** A tiny in-memory stand-in for localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage & { data: Map<string, string> };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const stored = (store: { data: Map<string, string> }): Array<{ id: string; name: string }> => JSON.parse(store.data.get(STORAGE_KEY) ?? '[]') as Array<{ id: string; name: string }>;

let storage: ReturnType<typeof memoryStorage>;
let fetchFn: ReturnType<typeof vi.fn>;
const deps = (extra: Partial<ApiDeps> = {}): ApiDeps => ({ fetchFn: fetchFn as unknown as ApiDeps['fetchFn'], storage: () => storage, now: () => new Date('2026-03-04T12:00:00Z'), ...extra });

beforeEach(() => {
  storage = memoryStorage();
  fetchFn = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('saveTrack', () => {
  it('posts the track to the server and reports where it went', async () => {
    fetchFn.mockResolvedValue(json(201, { id: 'abc', name: 'My track', tempo_bpm: 100, layer_count: 1, created_at: '2026-03-04T12:00:00Z' }));
    const result = await saveTrack(payload(), deps());
    expect(result).toEqual({ ok: true, id: 'abc', name: 'My track', local: false });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/creations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(payload());
    expect(storage.data.size).toBe(0);
  });

  it('keeps the track on this computer when the database is down (503)', async () => {
    fetchFn.mockResolvedValue(json(503, { detail: 'database is down' }));
    const result = await saveTrack(payload('Tune'), deps());
    expect(result).toMatchObject({ ok: true, local: true, name: 'Tune' });
    expect(result.ok && result.reason).toMatch(/not ready/);
    expect(stored(storage)).toHaveLength(1);
    expect(stored(storage)[0].id.startsWith(LOCAL_PREFIX)).toBe(true);
  });

  it('keeps the track on this computer when the server cannot be reached', async () => {
    fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await saveTrack(payload(), deps());
    expect(result).toMatchObject({ ok: true, local: true, reason: 'The server could not be reached.' });
    expect(stored(storage)[0].name).toBe('My track');
  });

  it.each([404, 405, 500, 502, 504, 429, 401])('falls back to this computer for status %i', async (status) => {
    fetchFn.mockResolvedValue(json(status, { detail: 'x' }));
    expect(await saveTrack(payload(), deps())).toMatchObject({ ok: true, local: true });
  });

  it('falls back when the answer is not the kind the server gives (a web page, no id)', async () => {
    fetchFn.mockResolvedValueOnce(new Response('<html>hi</html>', { status: 200 }));
    expect(await saveTrack(payload(), deps())).toMatchObject({ ok: true, local: true });
    fetchFn.mockResolvedValueOnce(json(201, { nothing: true }));
    expect(await saveTrack(payload(), deps())).toMatchObject({ ok: true, local: true });
    expect(stored(storage)).toHaveLength(2);
  });

  it('gives up waiting after ten seconds and keeps the track on this computer', async () => {
    vi.useFakeTimers();
    fetchFn.mockImplementation(() => new Promise(() => {})); // never answers, and ignores being cancelled
    const pending = saveTrack(payload(), deps());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result).toMatchObject({ ok: true, local: true, reason: 'The server took too long to answer.' });
  });

  it('cancels the request when the time is up', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchFn.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    const pending = saveTrack(payload(), deps({ timeoutMs: 50 }));
    await vi.advanceTimersByTimeAsync(50);
    expect(signal?.aborted).toBe(true);
    expect(await pending).toMatchObject({ ok: true, local: true, reason: 'The server took too long to answer.' });
  });

  it('shows the server reason when it refuses the track, and does not save it locally', async () => {
    fetchFn.mockResolvedValue(json(422, { detail: 'The layers are too big (at most 1536 KB)' }));
    const result = await saveTrack(payload(), deps());
    expect(result).toEqual({ ok: false, message: 'The server did not save this track. The layers are too big (at most 1536 KB)' });
    expect(storage.data.size).toBe(0);
  });

  it('never shows a raw error object from the server', async () => {
    fetchFn.mockResolvedValue(json(422, { detail: [{ loc: ['body'], msg: 'x', type: 'y' }] }));
    const result = await saveTrack(payload(), deps());
    expect(result).toEqual({ ok: false, message: 'The server did not save this track. The server did not accept that.' });
  });

  it('says so when neither the server nor this computer can keep it', async () => {
    fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    const throwing = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } } as unknown as Storage;
    const result = await saveTrack(payload(), deps({ storage: () => throwing }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/could not be reached.*would not keep the track on this computer/);
  });

  it('copes when localStorage is missing, or throws just by being touched', async () => {
    fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    for (const getter of [() => null, () => undefined, () => { throw new DOMException('denied', 'SecurityError'); }]) {
      const result = await saveTrack(payload(), deps({ storage: getter }));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toMatch(/would not keep the track/);
    }
  });

  it('lets old tracks go when the storage is full, so the new one fits', async () => {
    fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    const tight = memoryStorage();
    tight.setItem = (k: string, v: string) => {
      if ((JSON.parse(v) as unknown[]).length > 2) throw new DOMException('full', 'QuotaExceededError');
      tight.data.set(k, v);
    };
    for (const name of ['A', 'B', 'C', 'D']) await saveTrack(payload(name), deps({ storage: () => tight }));
    expect(stored(tight).map((t) => t.name)).toEqual(['D', 'C']);
  });

  it('keeps only the newest tracks on this computer', async () => {
    fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    for (let i = 0; i < MAX_LOCAL_TRACKS + 5; i++) await saveTrack(payload(`T${i}`), deps());
    const names = stored(storage).map((t) => t.name);
    expect(names).toHaveLength(MAX_LOCAL_TRACKS);
    expect(names[0]).toBe(`T${MAX_LOCAL_TRACKS + 4}`);
  });

  it('cleans the name before sending', async () => {
    fetchFn.mockResolvedValue(json(201, { id: 'a', name: 'My track' }));
    await saveTrack(payload('   '), deps());
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string).name).toBe('My track');
  });
});

describe('listTracks', () => {
  const serverRows = [
    { id: 's1', name: 'Old', tempo_bpm: 90, created_at: '2026-01-01T00:00:00Z', layer_count: 2 },
    { id: 's2', name: 'New', tempo_bpm: 100, created_at: '2026-03-01T00:00:00Z', layer_count: 1 },
  ];

  it('lists the server tracks, newest first', async () => {
    fetchFn.mockResolvedValue(json(200, serverRows));
    const result = await listTracks(deps());
    expect(result.notice).toBeUndefined();
    expect(result.tracks.map((t) => [t.id, t.local])).toEqual([['s2', false], ['s1', false]]);
    expect(result.tracks[0]).toMatchObject({ name: 'New', tempo_bpm: 100, layer_count: 1 });
  });

  it('merges in the tracks saved on this computer and marks them', async () => {
    fetchFn.mockResolvedValueOnce(json(503, { detail: 'down' })).mockResolvedValueOnce(json(200, serverRows));
    await saveTrack(payload('Mine'), deps());
    const merged = await listTracks(deps());
    expect(merged.tracks.map((t) => [t.name, t.local])).toEqual([['Mine', true], ['New', false], ['Old', false]]);
    expect(merged.tracks[0].layer_count).toBe(1);
  });

  it('still shows this computer\'s tracks, with a notice, when the server is down', async () => {
    fetchFn.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await saveTrack(payload('Mine'), deps());
    const result = await listTracks(deps());
    expect(result.tracks.map((t) => t.name)).toEqual(['Mine']);
    expect(result.notice).toBe('The server could not be reached. Only tracks saved on this computer are shown.');
  });

  it('gives an empty list and a notice when nothing works at all', async () => {
    fetchFn.mockResolvedValue(json(503, { detail: 'down' }));
    const result = await listTracks(deps({ storage: () => { throw new Error('no storage'); } }));
    expect(result.tracks).toEqual([]);
    expect(result.notice).toMatch(/not ready/);
  });

  it('drops junk rows and fixes odd ones', async () => {
    fetchFn.mockResolvedValue(json(200, [null, 5, 'x', { name: 'no id' }, { id: '' }, { id: 7, name: 42, tempo_bpm: 'fast', created_at: 3, layer_count: -1 }, { id: 'ok', name: 'Fine\u0000 one' }]));
    const result = await listTracks(deps());
    expect(result.tracks).toEqual([
      { id: '7', name: 'Untitled', tempo_bpm: undefined, created_at: '', layer_count: undefined, local: false },
      { id: 'ok', name: 'Fine one', tempo_bpm: undefined, created_at: '', layer_count: undefined, local: false },
    ]);
  });

  it('treats a list that is not a list as a server problem', async () => {
    fetchFn.mockResolvedValue(json(200, { not: 'a list' }));
    const result = await listTracks(deps());
    expect(result.tracks).toEqual([]);
    expect(result.notice).toMatch(/could not be understood/);
  });

  it('ignores stored data that has been damaged', async () => {
    fetchFn.mockResolvedValue(json(200, []));
    for (const text of ['not json', '{"a":1}', '[1,2,3]', '[{"id":"s1"}]', 'null']) {
      storage.data.set(STORAGE_KEY, text);
      expect((await listTracks(deps())).tracks).toEqual([]);
    }
  });
});

describe('loadTrack', () => {
  const full = { id: 's1', name: 'Tune', tempo_bpm: 110, created_at: '2026-03-01T00:00:00Z', layers: payload().layers };

  it('opens a server track', async () => {
    fetchFn.mockResolvedValue(json(200, full));
    const result = await loadTrack({ id: 's1', local: false }, deps());
    expect(fetchFn.mock.calls[0][0]).toBe('/api/creations/s1');
    expect(result.ok && result.track).toMatchObject({ name: 'Tune', bpm: 110, layers: [{ id: 'layer-1', instrument: 'piano' }] });
  });

  it('puts an unusual id safely into the address', async () => {
    fetchFn.mockResolvedValue(json(200, full));
    await loadTrack('a/b?c', deps());
    expect(fetchFn.mock.calls[0][0]).toBe('/api/creations/a%2Fb%3Fc');
  });

  it('opens a track saved on this computer without asking the server', async () => {
    fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    const saved = await saveTrack(payload('Mine'), deps());
    fetchFn.mockClear();
    const result = await loadTrack({ id: saved.ok ? saved.id : '', local: true }, deps());
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.ok && result.track.name).toBe('Mine');
  });

  it('says so when a local track has gone', async () => {
    const result = await loadTrack(`${LOCAL_PREFIX}gone`, deps());
    expect(result).toEqual({ ok: false, message: 'That track is no longer saved on this computer.' });
  });

  it.each([
    [404, /saving service was not found/],
    [503, /not ready/],
    [500, /ran into a problem/],
  ])('explains status %i in plain words', async (status, words) => {
    fetchFn.mockResolvedValue(json(status, { detail: 'secret internals' }));
    const result = await loadTrack('s1', deps());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(words);
    expect(!result.ok && result.message).not.toMatch(/secret internals/);
  });

  it('explains a network failure and a timeout', async () => {
    fetchFn.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await loadTrack('s1', deps())).toEqual({ ok: false, message: 'Could not open that track. The server could not be reached.' });
    vi.useFakeTimers();
    fetchFn.mockImplementationOnce(() => new Promise(() => {}));
    const pending = loadTrack('s1', deps());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, message: 'Could not open that track. The server took too long to answer.' });
  });

  it('refuses a saved track that is junk, and tidies one that is half junk', async () => {
    fetchFn.mockResolvedValueOnce(json(200, { id: 's1', layers: 'nope' }));
    expect((await loadTrack('s1', deps())).ok).toBe(false);
    fetchFn.mockResolvedValueOnce(json(200, { id: 's1', layers: [{ notes: [{ pitch: 'x' }, { ...note }] }] }));
    const result = await loadTrack('s1', deps());
    expect(result.ok && result.track.layers[0].notes).toHaveLength(1);
    expect(result.ok && result.track.skippedNotes).toBe(1);
  });
});
