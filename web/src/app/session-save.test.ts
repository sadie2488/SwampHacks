// @vitest-environment jsdom
// Saving a practice run: what is sent, when, and what happens when the server (or this browser's storage) is not there.
import rulesTempo from '@fixtures/feedback/rules-tempo.json';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, resetControls, sendCommand, type Topics } from '@/bus';
import type { Feedback, SongAnalysis } from '@/contracts';
import { buildSaveBodies, getSaveState, LOCAL_KEY, LOCAL_LIMIT, parseCentsOff, readLocalRuns, SAVE_NOTE, saveFeedback, startSessionSaver, stopSessionSaver } from './session-save';

const song = twinkle as unknown as SongAnalysis;
const fresh = (): Feedback => structuredClone(rulesTempo) as unknown as Feedback;
const forget = <K extends keyof Topics>(topic: K) => bus.emit(topic, undefined as unknown as Topics[K]);
const settle = () => new Promise((r) => setTimeout(r, 5));
async function until(check: () => unknown, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${what}`);
}

interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}
let calls: Call[];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A pretend server. `fail` turns single steps into errors. */
function fakeServer(fail: Partial<Record<'create' | 'samples' | 'end', number | 'network'>> = {}) {
  let n = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const call: Call = { method, url, body: init?.body ? JSON.parse(init.body as string) : undefined, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    const step = method === 'POST' && url === '/api/sessions' ? 'create' : url.endsWith('/samples') ? 'samples' : url.endsWith('/end') ? 'end' : null;
    const broken = step ? fail[step] : undefined;
    if (broken === 'network') throw new TypeError('Failed to fetch');
    if (broken) return reply({ detail: 'The history database is not available.' }, broken);
    if (step === 'create') return reply({ id: `server-${++n}` }, 201);
    return reply({});
  });
}

const posts = () => calls.filter((c) => c.method === 'POST');
/** How many saves had finished before the test began (the counter only goes up). */
let base = 0;

beforeEach(() => {
  base = getSaveState().syncVersion;
  calls = [];
  localStorage.clear();
  resetControls();
  forget('feedback');
  bus.emit('analysis', song);
  bus.emit('practice', { state: 'idle' });
  vi.stubGlobal('fetch', fakeServer());
});

afterEach(() => {
  stopSessionSaver();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseCentsOff', () => {
  it('reads sharp as plus and flat as minus', () => {
    expect(parseCentsOff('The 4th note was about 30 cents sharp.')).toBe(30);
    expect(parseCentsOff('You were flat by 12.5 cents on the high note')).toBe(-12.5);
  });
  it('skips sentences without a number of cents or a direction', () => {
    expect(parseCentsOff('In bar 3 the C was a bit sharp: aim a touch lower.')).toBeNull();
    expect(parseCentsOff('The note was 30 cents off')).toBeNull();
    expect(parseCentsOff(undefined)).toBeNull();
  });
});

describe('buildSaveBodies', () => {
  it('builds the three requests for a run', () => {
    expect(buildSaveBodies(fresh(), { songId: 'demo-twinkle', tempoRatio: 0.8, latencyOffsetMs: 84 })).toEqual({
      session: { song_id: 'demo-twinkle', tempo_ratio: 0.8, latency_offset_ms: 84 },
      samples: {
        samples: [
          { metric: 'played_bpm', value: 90 },
          { metric: 'target_bpm', value: 100 },
          { metric: 'tempo_ratio', value: 0.9 },
          { metric: 'issue_count', value: 2 },
          { metric: 'pitch_cents_off', value: 30, song_time_sec: 1.8 },
        ],
      },
      end: { summary: { verdict: 'dragging', played_bpm: 90, target_bpm: 100, ratio: 0.9, issues: 2, source: 'rules' } },
    });
  });

  it('copes with feedback that has no tempo and no issues', () => {
    const bodies = buildSaveBodies({ version: 1, song_id: 'a', source: 'rules', summary: 'ok' }, { songId: 'a', tempoRatio: 1 });
    expect(bodies.samples.samples).toEqual([{ metric: 'issue_count', value: 0 }]);
    expect(JSON.parse(JSON.stringify(bodies.end))).toEqual({ summary: { issues: 0, source: 'rules' } });
    expect(bodies.session).toEqual({ song_id: 'a', tempo_ratio: 1 });
  });

  it('works the ratio out when the feedback has none, and skips pitch issues without cents', () => {
    const fb = fresh();
    delete fb.tempo!.ratio;
    fb.issues = [{ kind: 'pitch', message: 'In bar 2 the G was a bit flat: aim a touch higher.' }];
    const samples = buildSaveBodies(fb, { songId: 'a', tempoRatio: 1 }).samples.samples;
    expect(samples.find((s) => s.metric === 'tempo_ratio')?.value).toBe(0.9);
    expect(samples.map((s) => s.metric)).toEqual(['played_bpm', 'target_bpm', 'tempo_ratio', 'issue_count']);
  });

  it('keeps numbers the server would refuse out of the requests', () => {
    const fb = fresh();
    fb.tempo = { target_bpm: Number.NaN, played_bpm: 90, verdict: 'steady' };
    const bodies = buildSaveBodies(fb, { songId: 'a', tempoRatio: 9, latencyOffsetMs: 99999 });
    expect(bodies.session).toEqual({ song_id: 'a', tempo_ratio: 1 });
    expect(bodies.samples.samples.map((s) => s.metric)).toEqual(['played_bpm', 'issue_count', 'pitch_cents_off']);
    expect(bodies.samples.samples.every((s) => Number.isFinite(s.value))).toBe(true);
  });

  it('never sends more samples than the server takes', () => {
    const fb = fresh();
    fb.issues = Array.from({ length: 700 }, () => ({ kind: 'pitch' as const, message: 'about 10 cents sharp' }));
    expect(buildSaveBodies(fb, { songId: 'a', tempoRatio: 1 }).samples.samples.length).toBeLessThanOrEqual(500);
  });
});

describe('saving new feedback', () => {
  it('saves exactly one run: create, samples, end, with the song, speed and delay of that moment', async () => {
    startSessionSaver();
    sendCommand('playback.tempo', 'button', { how: 'set', value: 0.8 });
    bus.emit('practice', { state: 'listening', latencyOffsetMs: 84 });
    bus.emit('practice', { state: 'done', message: 'That is the end.' }); // a later message without the delay
    bus.emit('feedback', fresh());
    await until(() => getSaveState().syncVersion > base, 'the save to finish');

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/sessions', 'POST /api/sessions/server-1/samples', 'POST /api/sessions/server-1/end']);
    expect(calls[0].body).toEqual({ song_id: 'demo-twinkle', tempo_ratio: 0.8, latency_offset_ms: 84 });
    expect(calls[1].body).toEqual(buildSaveBodies(fresh(), { songId: 'demo-twinkle', tempoRatio: 0.8, latencyOffsetMs: 84 }).samples);
    expect(calls[2].body).toEqual({ summary: { verdict: 'dragging', played_bpm: 90, target_bpm: 100, ratio: 0.9, issues: 2, source: 'rules' } });
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(getSaveState().note).toBeNull();
    await settle();
    expect(calls).toHaveLength(3);
  });

  it('does not save the same feedback twice, but saves the next run', async () => {
    startSessionSaver();
    startSessionSaver(); // starting again must not add a second listener
    const first = fresh();
    bus.emit('feedback', first);
    bus.emit('feedback', first);
    await until(() => getSaveState().syncVersion >= base + 1, 'the first save');
    expect(posts()).toHaveLength(3);

    bus.emit('feedback', { ...fresh(), summary: 'Second run.' });
    await until(() => getSaveState().syncVersion >= base + 2, 'the second save');
    expect(posts()).toHaveLength(6);
    expect(readLocalRuns('demo-twinkle')).toHaveLength(2);
  });

  it('does not save feedback that was already there when the listener started (a replay)', async () => {
    bus.emit('feedback', fresh());
    startSessionSaver();
    await settle();
    expect(calls).toEqual([]);
    expect(readLocalRuns()).toEqual([]);
    expect(getSaveState().note).toBeNull();
  });

  it('leaves the delay out when none was measured, and uses the song of the feedback when no song is loaded', async () => {
    forget('analysis');
    startSessionSaver();
    bus.emit('feedback', fresh());
    await until(() => getSaveState().syncVersion > base, 'the save');
    expect(calls[0].body).toEqual({ song_id: 'demo-twinkle', tempo_ratio: 1 });
  });

  it('keeps a copy in this browser with the server id once the run is stored', async () => {
    startSessionSaver();
    bus.emit('feedback', fresh());
    await until(() => getSaveState().syncVersion > base, 'the save');
    expect(readLocalRuns('demo-twinkle')).toEqual([expect.objectContaining({ id: 'server-1', songId: 'demo-twinkle', playedBpm: 90, targetBpm: 100, ratio: 0.9, verdict: 'dragging', issues: 2 })]);
    expect(readLocalRuns('upload-00000000')).toEqual([]);
  });

  it('adds the sign-in token to the requests only when there is one', async () => {
    const { setSessionAuth } = await import('./session-save');
    setSessionAuth(() => 'abc');
    await saveFeedback(fresh(), { songId: 'demo-twinkle', tempoRatio: 1 });
    expect(calls.every((c) => c.headers.Authorization === 'Bearer abc')).toBe(true);
    calls.length = 0;
    setSessionAuth(() => {
      throw new Error('signed out');
    });
    await saveFeedback(fresh(), { songId: 'demo-twinkle', tempoRatio: 1 });
    expect(calls).toHaveLength(3);
    expect(calls.some((c) => 'Authorization' in c.headers)).toBe(false);
    setSessionAuth(null);
  });
});

describe('when saving goes wrong', () => {
  it.each([
    ['the server cannot be reached', { create: 'network' }, 1],
    ['the database is down (503)', { create: 503 }, 1],
    ['the run cannot be closed', { end: 500 }, 3],
  ] as const)('shows the plain note and still keeps the local copy when %s', async (_name, fail, requests) => {
    vi.stubGlobal('fetch', fakeServer(fail));
    startSessionSaver();
    bus.emit('feedback', fresh());
    await until(() => getSaveState().syncVersion > base, 'the save to give up');
    expect(getSaveState().note).toBe(SAVE_NOTE);
    expect(SAVE_NOTE).toBe("Couldn't save this run: your progress isn't being stored right now");
    expect(calls).toHaveLength(requests);
    expect(readLocalRuns('demo-twinkle')).toHaveLength(1);
    expect(readLocalRuns('demo-twinkle')[0]).toMatchObject({ ratio: 0.9, verdict: 'dragging' });
  });

  it('does not complain when only the extra measurements fail: the run itself is stored', async () => {
    vi.stubGlobal('fetch', fakeServer({ samples: 500 }));
    startSessionSaver();
    bus.emit('feedback', fresh());
    await until(() => getSaveState().syncVersion > base && calls.length >= 3, 'the save and all three requests');
    expect(getSaveState().note).toBeNull();
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['sessions', 'samples', 'end']);
  });

  it('treats a server that answers with something else as not saved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(twinkle)));
    startSessionSaver();
    bus.emit('feedback', fresh());
    await until(() => getSaveState().syncVersion > base, 'the save to give up');
    expect(getSaveState().note).toBe(SAVE_NOTE);
  });

  it('gives up on a server that never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
      startSessionSaver();
      bus.emit('feedback', fresh());
      await vi.advanceTimersByTimeAsync(9000);
      expect(getSaveState().note).toBe(SAVE_NOTE);
      expect(readLocalRuns()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the note after a save that works', async () => {
    vi.stubGlobal('fetch', fakeServer({ create: 'network' }));
    startSessionSaver();
    bus.emit('feedback', fresh());
    await until(() => getSaveState().note === SAVE_NOTE, 'the note');
    vi.stubGlobal('fetch', fakeServer());
    bus.emit('feedback', fresh());
    await until(() => getSaveState().note === null, 'the note to go');
  });

  it('survives storage that throws (blocked, full or switched off) and still saves to the server', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    startSessionSaver();
    bus.emit('feedback', fresh());
    // With storage broken the "saved" counter can tick before the last request goes out, so wait for all three.
    await until(() => getSaveState().syncVersion > base && posts().length >= 3, 'the save and all three requests');
    expect(getSaveState().note).toBeNull();
    expect(posts()).toHaveLength(3);
    expect(readLocalRuns()).toEqual([]);
  });

  it('survives a browser that refuses to hand out storage at all', async () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied', 'SecurityError');
      },
    });
    try {
      startSessionSaver();
      bus.emit('feedback', fresh());
      await until(() => getSaveState().syncVersion > base && posts().length >= 3, 'the save and all three requests');
      expect(getSaveState().note).toBeNull();
      expect(posts()).toHaveLength(3);
      expect(readLocalRuns()).toEqual([]);
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real);
      else delete (window as { localStorage?: unknown }).localStorage;
    }
  });

  it('survives a saved copy that is broken', async () => {
    localStorage.setItem(LOCAL_KEY, '{not json');
    expect(readLocalRuns()).toEqual([]);
    localStorage.setItem(LOCAL_KEY, JSON.stringify([null, 4, { key: 'x' }, { key: 'k', songId: 'demo-twinkle', startedAt: 5, ratio: 0.9 }]));
    expect(readLocalRuns()).toEqual([{ key: 'k', songId: 'demo-twinkle', startedAt: 5, ratio: 0.9 }]);
  });

  it('never throws out of saveFeedback', async () => {
    vi.stubGlobal('fetch', undefined);
    await expect(saveFeedback(fresh(), { songId: 'demo-twinkle', tempoRatio: 1 })).resolves.toBeUndefined();
    await expect(saveFeedback(null as unknown as Feedback, { songId: 'demo-twinkle', tempoRatio: 1 })).resolves.toBeUndefined();
  });
});

describe('the copy kept in this browser', () => {
  it('keeps only the last 20 runs', async () => {
    vi.stubGlobal('fetch', fakeServer({ create: 'network' }));
    for (let i = 0; i < LOCAL_LIMIT + 5; i++) await saveFeedback({ ...fresh(), summary: `Run ${i}` }, { songId: 'demo-twinkle', tempoRatio: 1 });
    expect(readLocalRuns()).toHaveLength(LOCAL_LIMIT);
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY)!)).toHaveLength(LOCAL_LIMIT);
  });
});
