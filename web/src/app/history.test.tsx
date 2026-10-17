// @vitest-environment jsdom
// "Your practice so far": the list, the trend line and the sentence, with a pretend server, no server, and broken storage.
import rulesTempo from '@fixtures/feedback/rules-tempo.json';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, resetControls, type Topics } from '@/bus';
import type { Feedback, SongAnalysis } from '@/contracts';
import { History } from './History';
import { Practice } from './Practice';
import { LOCAL_KEY, SAVE_NOTE, stopSessionSaver } from './session-save';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = twinkle as unknown as SongAnalysis;
const otherSong: SongAnalysis = { ...song, song_id: 'upload-1a2b3c4d' };
const fresh = (): Feedback => structuredClone(rulesTempo) as unknown as Feedback;
const forget = <K extends keyof Topics>(topic: K) => bus.emit(topic, undefined as unknown as Topics[K]);

let container: HTMLDivElement;
let root: Root;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => $(id)?.textContent ?? null;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
const emit = <K extends keyof Topics>(topic: K, value: Topics[K]) => act(async () => void bus.emit(topic, value));
const mount = (ui = <History />) => act(async () => root.render(ui));
async function until(check: () => unknown, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const runItems = () => [...container.querySelectorAll<HTMLElement>('[data-testid="history-run"]')];
const started = () => runItems().map((li) => li.getAttribute('data-started'));
/** The y of each point on the trend line, oldest first. */
const trendY = () => ($('history-trend-line')?.getAttribute('points') ?? '').split(' ').map((p) => Number(p.split(',')[1]));

const T0 = Date.parse('2026-10-10T10:00:00Z');
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();

interface ServerRow {
  id: string;
  song_id: string;
  tempo_ratio: number;
  started_at: string;
  ended_at: string | null;
  summary: Record<string, unknown> | null;
}
const row = (id: string, minute: number, ratio: number, songId = 'demo-twinkle'): ServerRow => ({
  id,
  song_id: songId,
  tempo_ratio: 1,
  started_at: at(minute),
  ended_at: at(minute + 2),
  summary: { verdict: ratio < 0.97 ? 'dragging' : ratio > 1.03 ? 'rushing' : 'steady', played_bpm: ratio * 100, target_bpm: 100, ratio, issues: 1, source: 'rules' },
});

let sessions: ServerRow[];
let calls: Array<{ method: string; url: string }>;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A pretend server that remembers sessions: newest first on the way out, like the real one. */
function fakeServer(opts: { down?: boolean } = {}) {
  let n = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (opts.down) throw new TypeError('Failed to fetch');
    if (method === 'GET' && url.startsWith('/api/sessions')) {
      const songId = new URL(url, 'http://x').searchParams.get('song_id');
      return reply([...sessions].filter((s) => s.song_id === songId).sort((a, b) => b.started_at.localeCompare(a.started_at)));
    }
    const body = init?.body ? JSON.parse(init.body as string) : {};
    if (url === '/api/sessions') {
      const made = { id: `new-${++n}`, song_id: body.song_id, tempo_ratio: body.tempo_ratio, started_at: new Date().toISOString(), ended_at: null, summary: null };
      sessions.push(made);
      return reply({ id: made.id }, 201);
    }
    if (url.endsWith('/end')) {
      const made = sessions.find((s) => url.includes(s.id));
      if (made) Object.assign(made, { ended_at: new Date().toISOString(), summary: body.summary });
    }
    return reply({});
  });
}

/** Runs kept in this browser, oldest first by minute. */
const keepLocal = (runs: Array<{ minute: number; ratio: number; id?: string; songId?: string }>) =>
  localStorage.setItem(
    LOCAL_KEY,
    JSON.stringify(
      runs.map((r) => ({ key: `local-${r.minute}`, id: r.id, songId: r.songId ?? 'demo-twinkle', startedAt: T0 + r.minute * 60_000, ratio: r.ratio, playedBpm: r.ratio * 100, targetBpm: 100, verdict: r.ratio < 0.97 ? 'dragging' : 'steady', issues: 1 })),
    ),
  );

beforeEach(async () => {
  sessions = [];
  calls = [];
  localStorage.clear();
  resetControls();
  forget('feedback');
  bus.emit('analysis', song);
  bus.emit('practice', { state: 'idle' });
  vi.stubGlobal('fetch', fakeServer());
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stopSessionSaver();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the panel', () => {
  it('has a heading, one sentence, and nothing else before the first run', async () => {
    await mount();
    await settle();
    expect($('history')).not.toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('Your practice so far');
    expect(text('history-message')).toBe('Practice once to start your history');
    expect($('history-runs')).toBeNull();
    expect($('history-trend')).toBeNull();
    expect($('history-save-note')).toBeNull();
  });

  it('asks for a song when none is loaded, and does not ask the server', async () => {
    forget('analysis');
    await mount();
    await settle();
    expect(text('history-message')).toBe('Load a song to see your practice history.');
    expect(calls).toEqual([]);
  });
});

describe('the list and the sentence', () => {
  it('puts server and local runs together, newest first, with each run only once', async () => {
    sessions = [row('s1', 10, 0.8), row('s2', 30, 0.9)];
    keepLocal([{ minute: 30, ratio: 0.9, id: 's2' }, { minute: 20, ratio: 0.85 }, { minute: 40, ratio: 1.0 }]);
    await mount();
    await until(() => runItems().length === 4, 'four runs');
    expect(started()).toEqual([at(40), at(30), at(20), at(10)]);
    expect(runItems()[1].textContent).toMatch(/played about 90 BPM, the song is 100 BPM: a bit slow$/);
    expect(runItems()[0].textContent).toMatch(/: played about 100 BPM, the song is 100 BPM: nice and steady$/);
  });

  it('only shows runs of the loaded song', async () => {
    sessions = [row('s1', 10, 0.8), row('x1', 20, 0.7, 'upload-1a2b3c4d')];
    keepLocal([{ minute: 30, ratio: 0.9, songId: 'upload-1a2b3c4d' }]);
    await mount();
    await until(() => runItems().length === 1, 'one run');
    expect(started()).toEqual([at(10)]);
    await emit('analysis', otherSong);
    await until(() => started().join() === [at(30), at(20)].join(), "the other song's runs");
    expect(calls.some((c) => c.url === '/api/sessions?song_id=upload-1a2b3c4d')).toBe(true);
  });

  it('says you are getting steadier and draws a line that moves toward the dashed one', async () => {
    sessions = [0.7, 0.75, 0.8, 0.95, 0.98, 1.0].map((r, i) => row(`s${i}`, i * 10, r));
    await mount();
    await until(() => runItems().length === 6, 'six runs');
    expect(text('history-message')).toBe("You are getting steadier: your last 3 runs were closer to the song's tempo than your first 3");
    expect($('history-trend')!.tagName.toLowerCase()).toBe('svg');
    expect($('history-trend')!.getAttribute('data-points')).toBe('6');
    expect($('history-trend-ideal')!.getAttribute('stroke-dasharray')).toBeTruthy();
    const mid = Number($('history-trend-ideal')!.getAttribute('y1'));
    const y = trendY();
    expect(y).toHaveLength(6);
    expect(Math.abs(y[0] - mid)).toBeGreaterThan(Math.abs(y[5] - mid)); // the first run was far from 1.0, the last one is on it
    expect(y[0]).toBeGreaterThan(mid); // slow runs sit below the dashed line
  });

  it('says so, kindly, when the last runs were further from the tempo', async () => {
    sessions = [1.0, 0.98, 0.95, 0.8, 0.75, 0.7].map((r, i) => row(`s${i}`, i * 10, r));
    await mount();
    await until(() => runItems().length === 6, 'six runs');
    expect(text('history-message')).toMatch(/^Your last 3 runs were a bit further from the song's tempo than your first 3\./);
    const mid = Number($('history-trend-ideal')!.getAttribute('y1'));
    const y = trendY();
    expect(Math.abs(y[5] - mid)).toBeGreaterThan(Math.abs(y[0] - mid));
  });

  it('with one run shows a welcome and a single dot', async () => {
    sessions = [row('s1', 5, 0.9)];
    await mount();
    await until(() => runItems().length === 1, 'one run');
    expect(text('history-message')).toBe('Nice, your first run is saved. Practice again to see how you are doing.');
    expect($('history-trend')!.getAttribute('data-points')).toBe('1');
    expect($('history-trend-line')).toBeNull();
    expect(container.querySelectorAll('[data-testid="history-trend"] circle')).toHaveLength(1);
  });

  it('shows the 10 newest runs in the list but looks at 20 for the trend', async () => {
    sessions = Array.from({ length: 25 }, (_, i) => row(`s${i}`, i, 0.9));
    await mount();
    await until(() => runItems().length === 10, 'ten runs');
    expect(started()[0]).toBe(at(24));
    expect($('history-trend')!.getAttribute('data-points')).toBe('20');
  });
});

describe('with no server', () => {
  it('still shows the runs kept in this browser', async () => {
    vi.stubGlobal('fetch', fakeServer({ down: true }));
    keepLocal([{ minute: 1, ratio: 0.7 }, { minute: 2, ratio: 0.8 }, { minute: 3, ratio: 0.9 }, { minute: 4, ratio: 0.95 }, { minute: 5, ratio: 0.99 }, { minute: 6, ratio: 1.0 }]);
    await mount();
    await settle();
    expect(runItems()).toHaveLength(6);
    expect(started()[0]).toBe(at(6));
    expect(text('history-message')).toMatch(/^You are getting steadier/);
    expect($('history-trend')).not.toBeNull();
    expect($('history-save-note')).toBeNull();
  });

  it('keeps the runs it already had when a later refresh finds the server down', async () => {
    sessions = [row('s1', 10, 0.8)];
    await mount();
    await until(() => runItems().length === 1, 'the server run');
    vi.stubGlobal('fetch', fakeServer({ down: true }));
    await emit('analysis', otherSong);
    await emit('analysis', song);
    await settle();
    expect(runItems()).toHaveLength(1);
  });

  it('treats a server that answers with something else as no server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(twinkle)));
    keepLocal([{ minute: 1, ratio: 0.9 }]);
    await mount();
    await settle();
    expect(runItems()).toHaveLength(1);
  });

  it('survives storage that throws, using the server only', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    sessions = [row('s1', 10, 0.8)];
    await mount();
    await until(() => runItems().length === 1, 'the server run');
    expect(text('history-message')).toMatch(/first run is saved/);
  });

  it('survives storage that throws and no server: an empty history, no crash', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.stubGlobal('fetch', fakeServer({ down: true }));
    await mount();
    await settle();
    expect(text('history-message')).toBe('Practice once to start your history');
  });
});

describe('after a practice run', () => {
  it('saves the run, refreshes the list, and shows it once (the server copy and the local copy are one run)', async () => {
    await mount();
    await settle();
    expect(runItems()).toHaveLength(0);
    await emit('feedback', fresh());
    await until(() => calls.filter((c) => c.method === 'POST').length === 3, 'the three saving requests');
    await until(() => sessions[0]?.summary, 'the run to be closed');
    await until(() => runItems().length === 1 && runItems()[0].textContent!.includes('90 BPM'), 'the run on screen');
    await settle();
    expect(runItems()).toHaveLength(1);
    expect(text('history-message')).toBe('Nice, your first run is saved. Practice again to see how you are doing.');
    expect($('history-save-note')).toBeNull();
    expect(sessions[0].summary).toEqual({ verdict: 'dragging', played_bpm: 90, target_bpm: 100, ratio: 0.9, issues: 2, source: 'rules' });
    // the server was asked for the list again once the save was done
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('does not save feedback that was already on the bus when the panel opened', async () => {
    bus.emit('feedback', fresh());
    await mount();
    await settle();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(runItems()).toHaveLength(0);
  });

  it('still saves a run that ends while the panel is not on screen (another tab)', async () => {
    await mount();
    await act(async () => root.render(<p>another tab</p>));
    await emit('feedback', fresh());
    await until(() => calls.filter((c) => c.method === 'POST').length === 3, 'the saving requests');
    await mount();
    await until(() => runItems().length === 1, 'the run when the panel comes back');
  });

  it('shows the plain note, keeps the run on screen, and leaves the feedback card alone when the server is down', async () => {
    vi.stubGlobal('fetch', fakeServer({ down: true }));
    await mount(
      <>
        <Practice />
        <History />
      </>,
    );
    await emit('feedback', fresh());
    await until(() => $('history-save-note'), 'the note');
    expect(text('history-save-note')).toBe(SAVE_NOTE);
    expect($('history-save-note')!.getAttribute('role')).toBe('status');
    expect(container.querySelector('[data-testid="feedback-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="feedback-tempo"]')!.textContent).toBe('You played about 90 BPM; the song is 100 BPM: a bit slow');
    expect(container.querySelector('[data-testid="feedback-coaching"]') ?? container.querySelector('[data-testid="feedback-coaching-pending"]')).not.toBeNull();
    // the run is in the list from this browser's copy
    expect(runItems()).toHaveLength(1);
    expect(text('history-message')).toBe('Nice, your first run is saved. Practice again to see how you are doing.');
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY)!)).toHaveLength(1);
  });
});
