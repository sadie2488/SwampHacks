// The Save / list / open calls use the fetch the app hands in (the one that adds the login token), or plain fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/contracts';
import { serverApi } from './saved-tracks';
import type { TrackPayload } from './serialize';

const note: Note = { pitch: 60, onset_sec: 0, duration_sec: 0.6, onset_beat: 0, duration_beat: 1 };
const payload: TrackPayload = {
  name: 'My track',
  tempo_bpm: 100,
  layers: [{ name: 'Layer 1', kind: 'hum', instrument: 'piano', volume: 0.8, effect: 'none', muted: false, notes: [note] }],
};
const created = () => new Response(JSON.stringify({ id: 'abc', name: 'My track', created_at: '2026-03-04T12:00:00Z' }), { status: 201 });

let globalFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  globalFetch = vi.fn(() => Promise.resolve(created()));
  vi.stubGlobal('fetch', globalFetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('serverApi', () => {
  it('sends save, list and open through the fetch it was given', async () => {
    const given = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(created()));
    const api = serverApi(given);
    expect(await api.saveTrack(payload)).toEqual({ ok: true, id: 'abc', name: 'My track', local: false });
    await api.listTracks();
    await api.loadTrack({ id: 'abc', local: false });
    expect(given.mock.calls.map((c) => c[0])).toEqual(['/api/creations', '/api/creations', '/api/creations/abc']);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("uses the page's plain fetch when nothing is handed in", async () => {
    expect(await serverApi().saveTrack(payload)).toMatchObject({ ok: true, local: false });
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch.mock.calls[0][0]).toBe('/api/creations');
  });
});
