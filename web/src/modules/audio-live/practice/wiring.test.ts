// Fake mode end to end through the module's own start(): made-up microphone on, clap check, a practice run against the demo
// song, and the feedback. The song clock is played by a timer, like the playback module does.
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feedback, PerformanceEvent, SongAnalysis } from '@/contracts';
import type { Topics } from '@/bus';
import { feedbackProblems } from './test-kit';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function load(fake = true) {
  vi.resetModules();
  vi.stubGlobal('location', { search: fake ? '?fake=1' : '' });
  const busModule = await import('@/bus');
  const mod = await import('../index');
  const log = { practice: [] as Topics['practice'][], feedback: [] as Feedback[], performance: [] as PerformanceEvent[] };
  busModule.bus.on('practice', (p) => log.practice.push(p));
  busModule.bus.on('feedback', (f) => log.feedback.push(f));
  busModule.bus.on('performance', (e) => log.performance.push(e));
  const song = twinkle as unknown as SongAnalysis;
  const control = (action: Topics['practiceControl']['action']) => busModule.bus.emit('practiceControl', { action });

  /** The playback module's transport: an update every 66 ms while the song plays from `from` for `seconds` at `rate`. */
  async function play(seconds: number, opts: { from?: number; rate?: number } = {}) {
    const from = opts.from ?? 0;
    const rate = opts.rate ?? 1;
    const t0 = performance.now();
    const state = (playing: boolean, pos: number) => ({ loaded: true, songId: song.song_id, playing, positionSec: pos, durationSec: song.duration_sec, tempo: rate, pitch: 0, volume: 0.8, loop: false, loopSection: null });
    busModule.bus.emit('transport', state(true, from));
    const tick = setInterval(() => busModule.bus.emit('transport', state(true, from + ((performance.now() - t0) / 1000) * rate)), 66);
    await vi.advanceTimersByTimeAsync((seconds / rate) * 1000);
    clearInterval(tick);
    busModule.bus.emit('transport', state(false, from + seconds));
    await vi.advanceTimersByTimeAsync(2500);
  }
  return { ...busModule, ...mod, log, song, control, play };
}

describe('practice in fake mode, through the module', () => {
  it('refuses until there is a song and the microphone is on', async () => {
    const m = await load();
    const stop = m.start();
    m.control('start');
    expect(m.log.practice.at(-1)).toMatchObject({ state: 'error', message: 'Load a song first' });
    m.bus.emit('analysis', m.song);
    m.control('calibrate');
    expect(m.log.practice.at(-1)).toMatchObject({ state: 'error', message: 'Turn on the microphone first' });
    stop();
  });

  it('runs the clap check, then a run that the made-up player plays in time: steady', async () => {
    const m = await load();
    const stop = m.start();
    m.bus.emit('analysis', m.song);
    m.bus.emit('enable', { module: 'audio-live', on: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(m.getStatus('audio-live')?.state).toBe('running');

    m.control('calibrate');
    expect(m.log.practice.at(-1)).toMatchObject({ state: 'calibrating', message: 'Clap along with the 6 clicks' });
    await vi.advanceTimersByTimeAsync(6000);
    const cal = m.log.practice.at(-1)!;
    expect(cal.state).toBe('idle');
    expect(Math.abs(cal.latencyOffsetMs! - 120)).toBeLessThanOrEqual(5);
    expect(m.log.performance.filter((e) => e.type === 'calibration')).toHaveLength(1);

    m.control('start');
    expect(m.log.practice.at(-1)).toMatchObject({ state: 'listening', message: 'Press play, then play along' });
    await m.play(14.4);
    expect(m.log.practice.map((p) => p.message)).toContain('Listening: play along');
    expect(m.log.practice.at(-1)).toMatchObject({ state: 'done', message: 'Done: here is your feedback' });

    expect(m.log.feedback).toHaveLength(1);
    const fb = m.log.feedback[0];
    console.log('[measured] fake mode end to end:', JSON.stringify({ lag: cal.latencyOffsetMs, tempo: fb.tempo, issues: fb.issues, strengths: fb.strengths, summary: fb.summary }));
    expect(feedbackProblems(fb)).toEqual([]);
    expect(fb).toMatchObject({ source: 'rules', pending: true, song_id: 'demo-twinkle' });
    expect(fb.tempo!.verdict).toBe('steady');
    expect(fb.tempo!.ratio).toBeGreaterThan(0.97);
    expect(fb.tempo!.ratio).toBeLessThan(1.03);
    expect(fb.issues).toEqual([]); // the looping made-up microphone, which is not in time with the song, was not counted
    stop();
  });

  it('works at a slowed tempo and for a made-up player who drags', async () => {
    const m = await load();
    const stop = m.start();
    m.bus.emit('analysis', m.song);
    m.bus.emit('enable', { module: 'audio-live', on: true });
    await vi.advanceTimersByTimeAsync(200);
    m.control('start');
    await m.play(7.2, { rate: 0.8 });
    expect(m.log.feedback[0].tempo).toMatchObject({ verdict: 'steady', target_bpm: 80 });

    m.setFakePractice({ pace: 0.9 });
    m.control('start');
    await m.play(9.6);
    const slow = m.log.feedback[1];
    expect(slow.tempo!.verdict).toBe('dragging');
    expect(slow.tempo!.ratio).toBeCloseTo(0.9, 1);
    expect(slow.issues![0].kind).toBe('tempo');
    stop();
  });

  it('is quiet after it is stopped, and starting it opens nothing', async () => {
    const m = await load();
    const stop = m.start();
    expect(m.log.practice).toEqual([]);
    expect(m.getStatus('audio-live')).toBeUndefined();
    stop();
    m.bus.emit('analysis', m.song);
    m.control('start');
    expect(m.log.practice).toEqual([]);
  });
});
