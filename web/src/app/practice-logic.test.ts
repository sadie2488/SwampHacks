import { afterEach, describe, expect, it, vi } from 'vitest';
import rulesTempo from '@fixtures/feedback/rules-tempo.json';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import type { Feedback, SongAnalysis } from '@/contracts';
import { barRangeSec, barsText, builtInCoaching, cleanBars, coachingFor, coachingIn, fetchCoaching, loopTarget, practiceWords, tempoLine } from './practice-logic';

const song = twinkle as unknown as SongAnalysis;
const fresh = (): Feedback => structuredClone(rulesTempo) as unknown as Feedback;
const answerWith = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.useRealTimers());

describe('bars to song seconds (Twinkle: 4/4 at 100 BPM, one bar = 2.4 s)', () => {
  it('uses the downbeats', () => {
    expect(barRangeSec(song, [1, 2])).toEqual([0, 4.8]);
    expect(barRangeSec(song, [3, 3])).toEqual([4.8, 7.2]);
    expect(barRangeSec(song, [5, 6])).toEqual([9.6, 14.4]);
  });

  it('ends the last bar at the end of the song and refuses bars past it', () => {
    expect(barRangeSec(song, [12, 12])).toEqual([26.4, 28.8]);
    expect(barRangeSec(song, [11, 20])).toEqual([24, 28.8]);
    expect(barRangeSec(song, [13, 14])).toBeNull();
  });

  it('falls back to the beats and the time signature when there are no downbeats', () => {
    const noDownbeats = { ...song, downbeats: undefined };
    expect(barRangeSec(noDownbeats, [1, 2])).toEqual([0, 4.8]);
    expect(barRangeSec(noDownbeats, [4, 4])).toEqual([7.2, 9.6]);
    // 3/4: three beats make a bar
    const waltz = { ...noDownbeats, time_signature: { numerator: 3, denominator: 4 as const } };
    expect(barRangeSec(waltz, [2, 2])).toEqual([1.8, 3.6]);
  });

  it('falls back to the tempo when there are no beats either', () => {
    const bare = { ...song, downbeats: undefined, beats: undefined };
    expect(barRangeSec(bare, [1, 1])).toEqual([0, 2.4]);
    expect(barRangeSec(bare, [3, 4])).toEqual([4.8, 9.6]);
  });

  it('keeps going at the same spacing when the downbeat list is shorter than the song', () => {
    const short = { ...song, downbeats: [0, 2.4, 4.8], duration_sec: 28.8 };
    expect(barRangeSec(short, [4, 4])).toEqual([7.2, 9.6]);
  });

  it('puts the bars in order and ignores anything that is not a pair of numbers', () => {
    expect(cleanBars([2, 1])).toEqual([1, 2]);
    expect(cleanBars([0, 2])).toEqual([1, 2]);
    expect(cleanBars([1.7, 2.2])).toEqual([1, 2]);
    expect(cleanBars([1])).toBeNull();
    expect(cleanBars('1-2')).toBeNull();
    expect(cleanBars([1, Number.NaN])).toBeNull();
    expect(barRangeSec(song, [2, 1])).toEqual([0, 4.8]);
    expect(barRangeSec(song, 'bars 1-2')).toBeNull();
    expect(barRangeSec(undefined, [1, 2])).toBeNull();
  });

  it('writes the bars the way a person would', () => {
    expect(barsText([3, 3])).toBe('bar 3');
    expect(barsText([1, 2])).toBe('bars 1-2');
  });
});

describe('plain-words lines', () => {
  it('describes the tempo', () => {
    expect(tempoLine({ target_bpm: 100, played_bpm: 90, ratio: 0.9, verdict: 'dragging' })).toBe('You played about 90 BPM; the song is 100 BPM: a bit slow');
    expect(tempoLine({ target_bpm: 100, played_bpm: 112.4, verdict: 'rushing' })).toBe('You played about 112 BPM; the song is 100 BPM: a bit fast');
    expect(tempoLine({ target_bpm: 100, played_bpm: 70, ratio: 0.7, verdict: 'dragging' })).toBe('You played about 70 BPM; the song is 100 BPM: quite slow');
    expect(tempoLine({ target_bpm: 100, played_bpm: 100, verdict: 'steady' })).toBe('You played about 100 BPM; the song is 100 BPM: nice and steady');
  });

  it('shows the practice message, or a plain sentence for the state', () => {
    expect(practiceWords({ state: 'listening', message: 'Listening: play now' })).toBe('Listening: play now');
    expect(practiceWords({ state: 'calibrating' })).toBe('Listening for your claps...');
    expect(practiceWords({ state: 'listening' })).toBe('Listening to you play...');
    expect(practiceWords({ state: 'done' })).toMatch(/All done/);
    expect(practiceWords({ state: 'error' })).toMatch(/microphone/);
    expect(practiceWords(undefined)).toBe('Ready when you are.');
  });
});

describe('the built-in coaching sentence', () => {
  it('is built from the facts: a strength, the main fix, and the next step', () => {
    expect(builtInCoaching(fresh())).toBe(
      'Nice work: every note was in the right order. Your speed ran a little slow, which is really common. Play bars 1-2 at 80% speed, then bring it up to 100%.',
    );
  });

  it('copes with very little: the same tone as the canned tips', () => {
    const bare: Feedback = { version: 1, song_id: 'x', source: 'rules', summary: 'You played.' };
    expect(builtInCoaching(bare)).toBe('Good effort. Keep a steady beat. Try again at a slower tempo, around 80% speed.');
  });

  it('uses the first issue when the tempo was fine, and suggests the trouble bars when there is no next step', () => {
    const f: Feedback = {
      version: 1,
      song_id: 'x',
      source: 'rules',
      summary: 'ok',
      tempo: { target_bpm: 100, played_bpm: 100, verdict: 'steady' },
      issues: [{ kind: 'missed', bars: [3, 3], message: 'A note in bar 3 was missed' }],
    };
    expect(builtInCoaching(f)).toBe('Good effort. A note in bar 3 was missed. Try bar 3 at 80% speed, then bring it back up.');
  });

  it('says the speed was steady when that is all there is', () => {
    const f: Feedback = { version: 1, song_id: 'x', source: 'rules', summary: 'ok', tempo: { target_bpm: 100, played_bpm: 101, verdict: 'steady' }, strengths: ['Clean attacks.'] };
    expect(builtInCoaching(f)).toBe('Nice work: clean attacks. Your speed was steady. Try again at a slower tempo, around 80% speed.');
  });
});

describe('asking the server for coaching', () => {
  it('sends the rules feedback and the level, and returns the coach text', async () => {
    const fb = fresh();
    const fetchFn = answerWith({ ...fb, source: 'gemini', pending: false, coaching: ' You nailed the notes. ' });
    const out = await fetchCoaching(fb, { fetchFn });
    expect(out).toEqual({ text: 'You nailed the notes.', source: 'gemini' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/feedback/coach');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ feedback: fb, level: 'beginner' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('marks canned answers as built-in tips', async () => {
    const out = await fetchCoaching(fresh(), { fetchFn: answerWith({ version: 1, song_id: 'demo-twinkle', source: 'canned', pending: false, summary: 's', coaching: 'Keep a steady beat.' }) });
    expect(out).toEqual({ text: 'Keep a steady beat.', source: 'built-in' });
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an error status', async () => new Response('{"detail":"Traceback (most recent call last)"}', { status: 500 })],
    ['a page that is not JSON', async () => new Response('<html>hello</html>', { status: 200 })],
    ['an answer with no coaching', async () => new Response(JSON.stringify({ version: 1, song_id: 'x', source: 'canned', summary: 's' }), { status: 200 })],
    ['an empty coaching text', async () => new Response(JSON.stringify({ coaching: '   ' }), { status: 200 })],
  ])('uses the built-in text after %s', async (_name, impl) => {
    const fb = fresh();
    const out = await fetchCoaching(fb, { fetchFn: vi.fn(impl) });
    expect(out).toEqual({ text: builtInCoaching(fb), source: 'built-in' });
    expect(out.text).not.toMatch(/Traceback|Failed to fetch|html/);
  });

  it('gives up after 10 seconds, even when fetch ignores the abort signal', async () => {
    vi.useFakeTimers();
    const fb = fresh();
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    let done: unknown = null;
    void fetchCoaching(fb, { fetchFn }).then((c) => (done = c));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toEqual({ text: builtInCoaching(fb), source: 'built-in' });
    const signal = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
    expect(signal.aborted).toBe(true);
  });

  it('asks the server only once per feedback document, and not at all when the coaching is already there', async () => {
    const fb = fresh();
    const fetchFn = answerWith({ ...fb, source: 'gemini', pending: false, coaching: 'Hello.' });
    const [a, b] = await Promise.all([coachingFor(fb, { fetchFn }), coachingFor(fb, { fetchFn })]);
    expect(a).toEqual(b);
    await coachingFor(fb, { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const done = { ...fresh(), source: 'gemini' as const, pending: false, coaching: 'Already here.' };
    const other = vi.fn();
    expect(coachingIn(done)).toEqual({ text: 'Already here.', source: 'gemini' });
    expect(await coachingFor(done, { fetchFn: other })).toEqual({ text: 'Already here.', source: 'gemini' });
    expect(other).not.toHaveBeenCalled();
  });
});

describe('which bars to loop', () => {
  it('picks the first issue that has bars, with seconds from the analysis', () => {
    expect(loopTarget(fresh(), song)).toEqual({ bars: [1, 2], range: [0, 4.8] });
    const f = fresh();
    f.issues = [{ kind: 'pitch', message: 'a note was sharp' }, { kind: 'rhythm', bars: [3, 4], message: 'uneven' }, { kind: 'tempo', bars: [1, 2], message: 'slow' }];
    expect(loopTarget(f, song)).toEqual({ bars: [3, 4], range: [4.8, 9.6] });
  });

  it('uses the issue\'s own times when the song is not loaded, and has no range when it has neither', () => {
    expect(loopTarget(fresh(), undefined)).toEqual({ bars: [1, 2], range: [0, 4.8] });
    const f = fresh();
    f.issues = [{ kind: 'tempo', bars: [3, 3], message: 'slow' }];
    expect(loopTarget(f, undefined)).toEqual({ bars: [3, 3], range: null });
  });

  it('finds nothing to loop when no issue points at bars', () => {
    const f = fresh();
    f.issues = [{ kind: 'pitch', message: 'a note was sharp' }];
    expect(loopTarget(f, song)).toBeNull();
    delete f.issues;
    expect(loopTarget(f, song)).toBeNull();
  });
});
