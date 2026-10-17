// The practice controller on its own bus, with a clock and timers we control and a pretend browser for the clicks.
import { describe, expect, it } from 'vitest';
import { createBus, type Topics, type TransportState } from '@/bus';
import type { Feedback, PerformanceEvent } from '@/contracts';
import { CALIBRATION_PROBLEM, clickTimesMs, type CalibrationEnv } from './calibration';
import { createPracticeController, type PracticeDeps } from './controller';
import { PRACTICE } from './config';
import { feedScriptedPerformance, FAKE_SESSION_ID, playedToEvents, scriptPlayed, type ScriptOptions } from './script';
import { expectedTwinkle, feedbackProblems, song } from './test-kit';

const ORIGIN = 40_000; // page-clock time of the microphone's time 0

function rig(opts: { fake?: boolean; mic?: boolean; hits?: 'lag' | 'none'; lagMs?: number; fakeScript?: ScriptOptions | null } = {}) {
  const bus = createBus<Topics>();
  let now = 100_000;
  let mic = opts.mic ?? true;
  let origin = ORIGIN;
  const timers: Array<{ id: number; at: number; fn: () => void }> = [];
  let nextId = 1;
  const log = {
    practice: [] as Topics['practice'][],
    feedback: [] as Feedback[],
    performance: [] as PerformanceEvent[],
    commands: [] as string[],
  };
  bus.on('practice', (p) => log.practice.push(p));
  bus.on('feedback', (f) => log.feedback.push(f));
  bus.on('performance', (p) => log.performance.push(p));
  bus.on('command', (c) => log.commands.push(c.command));

  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = Math.max(now, next.at);
      next.fn();
    }
    now = end;
  };

  let onHit: ((t: number) => void) | null = null;
  const env: CalibrationEnv = {
    startClicks: async (count, bpm, leadInSec) => clickTimesMs(now + leadInSec * 1000, count, bpm),
    listen: (cb) => {
      onHit = cb;
      return () => {
        onHit = null;
      };
    },
    now: () => now,
    sleep: async (ms, signal) => {
      now += ms;
      return !signal?.aborted;
    },
  };
  // the clap check asks for the clicks, then sleeps; the claps are delivered from startClicks so they exist before the sleep ends
  const lag = opts.lagMs ?? 120;
  const scriptedEnv: CalibrationEnv = {
    ...env,
    startClicks: async (count, bpm, leadInSec) => {
      const clicks = clickTimesMs(now + leadInSec * 1000, count, bpm);
      if (opts.hits !== 'none') queueMicrotask(() => clicks.forEach((c) => onHit?.(c + lag)));
      return clicks;
    },
  };

  const deps: PracticeDeps = {
    bus,
    now: () => now,
    micIsOn: () => mic,
    micOriginMs: () => origin,
    fake: opts.fake ?? false,
    createCalibrationEnv: () => scriptedEnv,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    fakeScript: () => opts.fakeScript ?? null,
  };
  const controller = createPracticeController(deps);
  const control = (action: Topics['practiceControl']['action']) => bus.emit('practiceControl', { action });
  const lastPractice = () => log.practice[log.practice.length - 1];

  let deliver = () => {};

  /** The song clock: positions as the playback module reports them, one update every 66 ms. */
  const transport = (over: Partial<TransportState>): TransportState => ({ loaded: true, songId: song.song_id, playing: true, positionSec: 0, durationSec: song.duration_sec, tempo: 1, pitch: 0, volume: 0.8, loop: false, loopSection: null, ...over });

  /**
   * Play the song from `from` to `to` (song seconds). `block` makes the position move in steps like the real playback does.
   * `player` is what the made-up player does, or null for silence. Returns the page time the song was at `from`.
   */
  function playSong(o: { from?: number; to: number; rate?: number; pitch?: number; block?: number; player: ScriptOptions | null; end?: 'pause' | 'finish'; progressive?: boolean }) {
    const from = o.from ?? 0;
    const rate = o.rate ?? 1;
    const startMs = now;
    const position = (elapsedMs: number) => {
      const p = from + (elapsedMs / 1000) * rate;
      return o.block ? Math.floor(p / o.block) * o.block : p;
    };
    bus.emit('transport', transport({ playing: true, positionSec: from, tempo: rate, pitch: o.pitch ?? 0 }));
    if (o.player && !o.progressive) {
      feedScriptedPerformance((e) => bus.emit('performance', e), expectedTwinkle, { ...o.player, runStartMs: startMs, originMs: origin, rate, startSec: from, endSec: o.to, pitchShift: o.pitch ?? 0 });
    }
    // progressive: each sound is reported when it is heard (an onset at its start, a note when it ends), as the microphone does
    const late = o.player && o.progressive ? playedToEvents(scriptPlayed(expectedTwinkle, { ...o.player, rate, startSec: from, endSec: o.to, pitchShift: o.pitch ?? 0 }), { runStartMs: startMs, originMs: origin }) : [];
    const due = (e: PerformanceEvent) => origin + e.time_sec * 1000 + (e.type === 'note' ? (e.duration_sec ?? 0) * 1000 : 0);
    late.sort((a, b) => due(a) - due(b));
    deliver = () => {
      while (late.length && due(late[0]) <= now) bus.emit('performance', late.shift()!);
    };
    let last = from;
    while (last < o.to) {
      now += 66;
      last = position(now - startMs);
      if (last >= o.to) break;
      deliver();
      bus.emit('transport', transport({ playing: true, positionSec: last, tempo: rate, pitch: o.pitch ?? 0 }));
    }
    bus.emit('transport', transport({ playing: false, positionSec: o.end === 'finish' ? 0 : last, tempo: rate, pitch: o.pitch ?? 0 }));
    return startMs;
  }

  return {
    bus,
    log,
    controller,
    control,
    advance,
    /** Let time pass in small steps, reporting the made-up player's sounds as they happen. */
    advanceDelivering(ms: number) {
      for (let t = 0; t < ms; t += 20) {
        advance(20);
        deliver();
      }
    },
    playSong,
    transport,
    lastPractice,
    setMic: (on: boolean) => (mic = on),
    restartMic: () => (origin += 5000),
    origin: () => origin,
    now: () => now,
    loadSong: () => bus.emit('analysis', song),
    /** Calibrate and wait for the result. */
    async calibrate() {
      control('calibrate');
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  };
}

describe('asking for things that cannot happen yet', () => {
  it('says "Load a song first" when no song is loaded', () => {
    const r = rig();
    r.control('start');
    expect(r.lastPractice()).toMatchObject({ state: 'error', message: 'Load a song first' });
  });
  it('says "Turn on the microphone first" for the clap check and for starting', () => {
    const r = rig({ mic: false });
    r.loadSong();
    r.control('calibrate');
    expect(r.lastPractice()).toMatchObject({ state: 'error', message: 'Turn on the microphone first' });
    r.control('start');
    expect(r.lastPractice()).toMatchObject({ state: 'error', message: 'Turn on the microphone first' });
  });
  it('does nothing on stop when nothing is going on', () => {
    const r = rig();
    r.control('stop');
    expect(r.log.practice).toEqual([]);
  });
});

describe('the clap check', () => {
  it('tells the person what to do, then reports the lag and publishes a calibration event', async () => {
    const r = rig();
    await r.calibrate();
    expect(r.log.practice[0]).toMatchObject({ state: 'calibrating', message: 'Clap along with the 6 clicks' });
    const done = r.lastPractice();
    expect(done.state).toBe('idle');
    expect(done.latencyOffsetMs).toBe(120);
    expect(done.message).toMatch(/Clap check done/);
    const cal = r.log.performance.find((e) => e.type === 'calibration')!;
    expect(cal.latency_offset_ms).toBe(120);
    expect(cal.confidence).toBe(1);
    expect(cal.time_sec).toBeCloseTo((r.now() - ORIGIN) / 1000, 3);
  });
  it('says what went wrong in plain words when no claps are heard', async () => {
    const r = rig({ hits: 'none' });
    await r.calibrate();
    expect(r.lastPractice()).toMatchObject({ state: 'error', message: CALIBRATION_PROBLEM });
    expect(r.lastPractice().latencyOffsetMs).toBeUndefined();
    expect(r.log.performance).toEqual([]);
  });
  it('pauses a playing song first, because the microphone would hear it', async () => {
    const r = rig();
    r.bus.emit('transport', r.transport({ playing: true }));
    await r.calibrate();
    expect(r.log.commands).toEqual(['playback.pause']);
  });
  it('can be stopped', async () => {
    const r = rig();
    r.control('calibrate');
    await Promise.resolve();
    r.control('stop');
    expect(r.lastPractice()).toMatchObject({ state: 'idle', message: 'Stopped' });
  });
});

describe('a practice run (real microphone path)', () => {
  it('waits for play, listens, and gives steady feedback to a player who is in time', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    r.control('start');
    expect(r.lastPractice()).toMatchObject({ state: 'listening', message: 'Press play, then play along' });
    r.playSong({ to: 9.6, player: { latencyMs: 120, jitterMs: 15 } });
    expect(r.lastPractice()).toMatchObject({ state: 'listening', message: 'Finishing up...' });
    expect(r.log.feedback).toHaveLength(0);
    r.advance(1500);
    expect(r.lastPractice()).toMatchObject({ state: 'done', message: 'Done: here is your feedback' });
    expect(r.log.practice.map((p) => p.message)).toEqual([
      'Clap along with the 6 clicks',
      expect.stringContaining('Clap check done'),
      'Press play, then play along',
      'Listening: play along',
      'Finishing up...',
      'Done: here is your feedback',
    ]);
    const fb = r.log.feedback[0];
    expect(feedbackProblems(fb)).toEqual([]);
    expect(fb).toMatchObject({ source: 'rules', pending: true, song_id: 'demo-twinkle' });
    expect(fb.tempo).toMatchObject({ verdict: 'steady', target_bpm: 100 });
    expect(fb.issues).toEqual([]);
  });

  it('starts right away when the song is already playing', () => {
    const r = rig();
    r.loadSong();
    r.bus.emit('transport', r.transport({ playing: true, positionSec: 3 }));
    r.control('start');
    expect(r.lastPractice()).toMatchObject({ state: 'listening', message: 'Listening: play along' });
  });

  it('catches a player who drags: about 10 percent slow with 120 ms of lag', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    r.control('start');
    r.playSong({ to: 9.6, player: { pace: 0.9, latencyMs: 120 } });
    r.advance(2000);
    const fb = r.log.feedback[0];
    expect(fb.tempo!.verdict).toBe('dragging');
    expect(fb.tempo!.ratio).toBeCloseTo(0.9, 2);
    expect(fb.tempo!.played_bpm).toBeCloseTo(90, 0);
    expect(fb.issues![0]).toMatchObject({ kind: 'tempo' });
  });

  it('measures a player against the slowed song: in time with 80 percent speed is steady, at 80 beats per minute', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    r.control('start');
    r.playSong({ to: 7.2, rate: 0.8, player: { latencyMs: 120, jitterMs: 10 } });
    r.advance(2000);
    const fb = r.log.feedback[0];
    expect(fb.tempo).toMatchObject({ target_bpm: 80, verdict: 'steady' });
    expect(fb.issues).toEqual([]);
  });

  it('copes with a song clock that moves in blocks of 4096 samples (about 85 ms)', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    r.control('start');
    r.playSong({ to: 14.4, block: 4096 / 48000, player: { pace: 0.9, latencyMs: 120, jitterMs: 15 } });
    r.advance(2000);
    const fb = r.log.feedback[0];
    expect(fb.tempo!.verdict).toBe('dragging');
    expect(fb.tempo!.ratio).toBeGreaterThan(0.88);
    expect(fb.tempo!.ratio).toBeLessThan(0.92);
  });

  it('...and says steady, with nothing else wrong, to a steady player on that same clock', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    r.control('start');
    r.playSong({ to: 14.4, block: 4096 / 48000, player: { latencyMs: 120, jitterMs: 15 } });
    r.advance(2000);
    const fb = r.log.feedback[0];
    expect(fb.tempo!.verdict).toBe('steady');
    console.log('[measured] block-stepped song clock, steady player: issues =', JSON.stringify(fb.issues!.map((i) => i.message)));
    expect(fb.issues!.filter((i) => i.kind !== 'rhythm')).toEqual([]);
  });

  it('starts from where the song was, and only judges the part that was played', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    r.control('start');
    r.playSong({ from: 9.6, to: 14.4, player: { latencyMs: 120 } });
    r.advance(2000);
    const fb = r.log.feedback[0];
    expect(fb.tempo!.verdict).toBe('steady');
    expect(fb.issues).toEqual([]);
    expect(fb.strengths![0]).toBe('You kept a steady tempo');
  });

  it('goes by the end of the song: notes never played at the end count as missed', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    r.control('start');
    // the player stops after bar 4 but the song plays to its end
    const startMs = r.now();
    r.bus.emit('transport', r.transport({ playing: true, positionSec: 0 }));
    feedScriptedPerformance((e) => r.bus.emit('performance', e), expectedTwinkle, { endSec: 9.6, latencyMs: 120, runStartMs: startMs, originMs: ORIGIN });
    for (let t = 0.5; t < 28.7; t += 0.5) {
      r.advance(500);
      r.bus.emit('transport', r.transport({ playing: true, positionSec: t }));
    }
    r.bus.emit('transport', r.transport({ playing: false, positionSec: 0 }));
    r.advance(2000);
    const fb = r.log.feedback[0];
    expect(fb.issues![0]).toMatchObject({ kind: 'missed', severity: 'high' });
  });

  it('can be stopped by the person, and still gives feedback for what was played', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    r.control('start');
    const startMs = r.now();
    r.bus.emit('transport', r.transport({ playing: true, positionSec: 0 }));
    feedScriptedPerformance((e) => r.bus.emit('performance', e), expectedTwinkle, { endSec: 4.8, latencyMs: 120, runStartMs: startMs, originMs: ORIGIN });
    for (let t = 0.5; t <= 5; t += 0.5) {
      r.advance(500);
      r.bus.emit('transport', r.transport({ playing: true, positionSec: t }));
    }
    r.control('stop');
    expect(r.lastPractice()).toMatchObject({ state: 'listening', message: 'Finishing up...' });
    r.advance(1500);
    expect(r.lastPractice().state).toBe('done');
    expect(r.log.feedback[0].tempo!.verdict).toBe('steady');
  });

  it('ends the run when the tempo changes or the song jumps', async () => {
    const r = rig();
    r.loadSong();
    r.control('start');
    r.bus.emit('transport', r.transport({ playing: true, positionSec: 0 }));
    r.advance(66);
    r.bus.emit('transport', r.transport({ playing: true, positionSec: 0.066, tempo: 0.8 }));
    expect(r.lastPractice().message).toBe('Finishing up...');
    r.advance(1500);
    expect(r.lastPractice().state).toBe('done');

    const j = rig();
    j.loadSong();
    j.control('start');
    j.bus.emit('transport', j.transport({ playing: true, positionSec: 5 }));
    j.advance(66);
    j.bus.emit('transport', j.transport({ playing: true, positionSec: 1 }));
    expect(j.lastPractice().message).toBe('Finishing up...');
  });

  it('is told plainly when nothing was heard', async () => {
    const r = rig();
    r.loadSong();
    r.control('start');
    r.playSong({ to: 4.8, player: null });
    r.advance(2000);
    expect(r.log.feedback[0].summary).toMatch(/didn't hear any notes/);
    expect(r.lastPractice().state).toBe('done');
  });

  it('keeps listening for the last notes of a slow player after the song has ended', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    r.control('start');
    // 10 percent slow: still playing bar 12 (and then some) when the song ends
    r.playSong({ to: 28.7, end: 'finish', progressive: true, player: { pace: 0.9, latencyMs: 120 } });
    expect(r.log.feedback).toHaveLength(0);
    r.advanceDelivering(6000);
    const fb = r.log.feedback[0];
    expect(fb.issues!.some((i) => i.kind === 'missed')).toBe(false);
    expect(fb.tempo!.verdict).toBe('dragging');
    expect(fb.tempo!.ratio).toBeCloseTo(0.9, 2);
  });

  it('ignores the calibration events and anything before a run starts', () => {
    const r = rig();
    r.loadSong();
    r.bus.emit('performance', { version: 1, type: 'note', time_sec: 1, pitch: 60 });
    r.control('start');
    r.bus.emit('performance', { version: 1, type: 'calibration', time_sec: 1, latency_offset_ms: 50 });
    r.playSong({ to: 4.8, player: null });
    r.advance(2000);
    expect(r.log.feedback[0].summary).toMatch(/didn't hear any notes/);
  });

  it('forgets the clap check when the microphone is restarted', async () => {
    const r = rig();
    r.loadSong();
    await r.calibrate();
    expect(r.lastPractice().latencyOffsetMs).toBe(120);
    r.restartMic();
    r.control('start');
    expect(r.lastPractice().latencyOffsetMs).toBeUndefined();
  });

  it('stops listening to the bus when it is stopped', () => {
    const r = rig();
    r.controller.stop();
    r.control('start');
    expect(r.log.practice).toEqual([]);
  });
});

describe('fake mode', () => {
  it('plays a made-up player in time, so the feedback says steady', async () => {
    const r = rig({ fake: true });
    r.loadSong();
    await r.calibrate();
    r.control('start');
    // the looping made-up microphone (not in time with the song) must not count
    r.bus.emit('performance', { version: 1, type: 'note', time_sec: 2, pitch: 61, duration_sec: 0.5 });
    r.playSong({ to: 14.4, player: null });
    expect(r.lastPractice()).toMatchObject({ state: 'done' });
    const fb = r.log.feedback[0];
    expect(feedbackProblems(fb)).toEqual([]);
    expect(fb.tempo!.verdict).toBe('steady');
    expect(fb.tempo!.ratio).toBeCloseTo(1, 2);
    expect(fb.issues).toEqual([]);
    expect(fb.strengths![0]).toBe('You kept a steady tempo');
  });

  it('is steady even if the clap check was skipped, and at a slowed tempo', async () => {
    const r = rig({ fake: true });
    r.loadSong();
    r.control('start');
    r.playSong({ to: 9.6, rate: 0.8, player: null });
    const fb = r.log.feedback[0];
    expect(fb.tempo).toMatchObject({ verdict: 'steady', target_bpm: 80 });
    expect(fb.issues).toEqual([]);
  });

  it('can be told to play slowly', () => {
    const r = rig({ fake: true, fakeScript: { pace: 0.9, detune: { 3: 30 } } });
    r.loadSong();
    r.control('start');
    r.playSong({ to: 9.6, player: null });
    const fb = r.log.feedback[0];
    expect(fb.tempo!.verdict).toBe('dragging');
    expect(fb.issues!.map((i) => i.kind)).toEqual(['tempo', 'pitch']);
  });

  it('does not accept the made-up player in real mode', () => {
    const r = rig();
    r.loadSong();
    r.control('start');
    r.bus.emit('transport', r.transport({ playing: true }));
    r.bus.emit('performance', { version: 1, type: 'note', session_id: FAKE_SESSION_ID, time_sec: 2, pitch: 61, duration_sec: 0.5 });
    r.bus.emit('transport', r.transport({ playing: false, positionSec: 0.2 }));
    r.advance(2000);
    expect(r.log.feedback[0].summary).toMatch(/didn't hear any notes/);
  });
});
