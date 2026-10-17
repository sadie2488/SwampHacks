// Practice mode: the shell asks (practiceControl), this decides what happens and says what is going on (practice, feedback).
//
//   calibrate -> play clicks, listen for claps, work out the lag, publish a "calibration" performance event
//   start     -> follow the song with the transport topic while collecting the player's notes (performance topic)
//   stop      -> end the run now
// A run ends by itself when the song is paused, ends, jumps (seek or loop) or changes tempo or pitch. Then the notes are
// compared with the song's melody and the rule-based feedback is published.
import { createBus, isFakeMode, type Stop, type Topics, type TransportState } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { browserCalibrationEnv, fakeCalibrationEnv } from './browser';
import { runCalibration, type CalibrationEnv } from './calibration';
import { compareNotes } from './compare';
import { PRACTICE } from './config';
import { buildFeedback } from './feedback';
import { melodyOf } from './melody';
import { RunRecorder } from './run';
import { FAKE_SESSION_ID, playedToEvents, scriptPlayed, type ScriptOptions } from './script';

type AppBus = ReturnType<typeof createBus<Topics>>;

export interface PracticeDeps {
  bus: AppBus;
  /** The page clock, ms (performance.now). */
  now(): number;
  /** Is the microphone really on? */
  micIsOn(): boolean;
  /** The page-clock time (ms) that time 0 of the microphone's performance events refers to. */
  micOriginMs(): number;
  /** Fake mode: no microphone; a made-up player plays the melody. */
  fake: boolean;
  createCalibrationEnv(signal: AbortSignal): CalibrationEnv;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Fake mode: what the made-up player does (default: plays it in time with a little wobble). */
  fakeScript?(): ScriptOptions | null;
}

export interface PracticeController {
  stop: Stop;
}

/** The made-up player of fake mode, unless a test or the lead says otherwise (see setFakeScript). */
const DEFAULT_FAKE_SCRIPT: ScriptOptions = { jitterMs: 12 };
let fakeScriptOverride: ScriptOptions | null = null;

/** Fake mode only: change what the made-up player does, e.g. { pace: 0.9 } for a player who is 10 percent slow. null = back to in time. */
export function setFakeScript(script: ScriptOptions | null): void {
  fakeScriptOverride = script;
}

type Phase = 'idle' | 'waiting' | 'listening' | 'settling';

export function createPracticeController(deps: PracticeDeps): PracticeController {
  const { bus } = deps;
  let analysis: SongAnalysis | undefined;
  let transport: TransportState | undefined;
  let latencyMs: number | undefined;
  let calibratedOrigin: number | undefined;
  let calibration: AbortController | null = null;
  let phase: Phase = 'idle';
  let rec: RunRecorder | null = null;
  let timer: unknown = null;
  let runCount = 0;

  /** The clap-check result only holds for the microphone session it was measured in (the start time of the microphone is part of it). */
  const currentLatency = (): number | undefined => (latencyMs !== undefined && calibratedOrigin === deps.micOriginMs() ? latencyMs : undefined);

  const publish = (state: Topics['practice']['state'], message: string) => bus.emit('practice', { state, message, latencyOffsetMs: currentLatency() });

  const clearTimer = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };

  const cancelRun = () => {
    clearTimer();
    rec = null;
    phase = 'idle';
  };

  // ---- the clap check ----
  const calibrate = async () => {
    if (calibration) return;
    if (!deps.micIsOn()) return publish('error', 'Turn on the microphone first');
    cancelRun();
    // the song would be heard by the microphone and mixed up with the claps
    if (transport?.playing) bus.emit('command', { version: 1, command: 'playback.pause', source: 'button', t_ms: deps.now() });
    const abort = new AbortController();
    calibration = abort;
    publish('calibrating', `Clap along with the ${PRACTICE.calibration.clicks} clicks`);
    try {
      const result = await runCalibration(deps.createCalibrationEnv(abort.signal), deps.fake ? { leadInSec: PRACTICE.fake.calibrationLeadInSec, tailMs: PRACTICE.fake.calibrationTailMs, signal: abort.signal } : { signal: abort.signal });
      if (result === null) return; // cancelled: whoever cancelled has said so
      if (!result.ok || result.latencyOffsetMs === undefined) return publish('error', result.message);
      latencyMs = Math.round(result.latencyOffsetMs);
      calibratedOrigin = deps.micOriginMs();
      bus.emit('performance', { version: 1, type: 'calibration', time_sec: (deps.now() - deps.micOriginMs()) / 1000, latency_offset_ms: latencyMs, confidence: result.matched / result.total });
      publish('idle', `${result.message}. Press Start practice when you are ready`);
    } catch (e) {
      console.error('[audio-live] the clap check failed', e);
      publish('error', "The clap check didn't work. Try again, and check that the sound is on");
    } finally {
      if (calibration === abort) calibration = null;
    }
  };

  // ---- a practice run ----
  const beginRun = (state: TransportState) => {
    if (!analysis) return;
    rec = new RunRecorder(state, deps.now(), analysis.duration_sec);
    phase = 'listening';
    publish('listening', 'Listening: play along');
  };

  const start = () => {
    if (!analysis) return publish('error', 'Load a song first');
    if (!deps.micIsOn()) return publish('error', 'Turn on the microphone first');
    if (melodyOf(analysis).length === 0) return publish('error', 'This song has no melody to compare with');
    calibration?.abort();
    cancelRun();
    if (transport?.playing) beginRun(transport);
    else {
      phase = 'waiting';
      publish('listening', 'Press play, then play along');
    }
  };

  const stopRun = () => {
    if (calibration) {
      calibration.abort();
      calibration = null;
      return publish('idle', 'Stopped');
    }
    if (phase === 'waiting') {
      cancelRun();
      return publish('idle', 'Practice stopped');
    }
    if (phase === 'listening') {
      rec!.stop();
      settle();
    }
  };

  /** The song stopped (or the person did): give the last notes a moment to be reported, then work out the feedback. */
  const settle = () => {
    if (phase === 'settling' || !rec) return;
    phase = 'settling';
    publish('listening', 'Finishing up...');
    if (deps.fake) {
      emitFakePerformance();
      return finish();
    }
    const began = deps.now();
    const check = () => {
      const quiet = deps.now() - Math.max(rec!.lastEventMs, began) >= PRACTICE.run.settleMs;
      if (quiet || deps.now() - began >= PRACTICE.run.settleLimitMs) finish();
      else timer = deps.setTimer(check, 100);
    };
    timer = deps.setTimer(check, PRACTICE.run.settleMs);
  };

  /** Fake mode: the made-up player plays the part of the melody that was due, through the same events a microphone would send. */
  const emitFakePerformance = () => {
    if (!analysis || !rec) return;
    const s = rec.summary();
    const script = deps.fakeScript?.() ?? DEFAULT_FAKE_SCRIPT;
    const played = scriptPlayed(melodyOf(analysis), { rate: s.rate, startSec: s.startSec, endSec: s.endSec, pitchShift: s.pitchShift, latencyMs: PRACTICE.fake.latencyMs, ...script });
    for (const e of playedToEvents(played, { runStartMs: s.runStartMs, originMs: deps.micOriginMs(), sessionId: FAKE_SESSION_ID })) bus.emit('performance', e);
  };

  const finish = () => {
    clearTimer();
    const run = rec;
    rec = null;
    phase = 'idle';
    if (!run || !analysis) return;
    try {
      const s = run.summary();
      const calibrated = currentLatency() !== undefined;
      const result = compareNotes(melodyOf(analysis), s.played, { rate: s.rate, latencyMs: currentLatency() ?? 0, startSec: s.startSec, endSec: s.endSec, pitchShift: s.pitchShift });
      bus.emit('feedback', buildFeedback({ analysis, result, calibrated, sessionId: `practice-${++runCount}` }));
      publish('done', 'Done: here is your feedback');
    } catch (e) {
      console.error('[audio-live] practice feedback failed', e);
      publish('error', "I couldn't work out your feedback. Try again");
    }
  };

  // ---- listening to the bus ----
  const offs: Stop[] = [
    bus.on('practiceControl', ({ action }) => {
      if (action === 'calibrate') void calibrate();
      else if (action === 'start') start();
      else if (action === 'stop') stopRun();
    }),
    bus.on(
      'analysis',
      (a) => {
        if (analysis && analysis.song_id !== a.song_id && phase !== 'idle') {
          cancelRun();
          publish('idle', 'Practice stopped because the song changed');
        }
        analysis = a;
      },
      { replay: true },
    ),
    bus.on(
      'transport',
      (state) => {
        transport = state;
        if (phase === 'waiting' && state.playing) beginRun(state);
        else if (phase === 'listening' && rec && rec.transport(state, deps.now())) settle();
      },
      { replay: true },
    ),
    bus.on('performance', (e) => {
      if (phase !== 'listening' && phase !== 'settling') return;
      if (e.type === 'calibration') return;
      // fake mode: the looping made-up microphone is not in time with the song, so only the made-up player counts
      if (deps.fake !== (e.session_id === FAKE_SESSION_ID)) return;
      rec?.add(e, deps.micOriginMs(), deps.now());
    }),
  ];

  return {
    stop: () => {
      for (const off of offs) off();
      calibration?.abort();
      clearTimer();
    },
  };
}

/** The real thing: the app's bus, the browser clock and the AudioContext (or made-up data in fake mode). */
export function startPracticeController(mic: { isOn(): boolean; originMs(): number }, appBus: AppBus): PracticeController {
  return createPracticeController({
    bus: appBus,
    now: () => performance.now(),
    micIsOn: () => mic.isOn(),
    micOriginMs: () => mic.originMs(),
    get fake() {
      return isFakeMode();
    },
    createCalibrationEnv: (signal) => (isFakeMode() ? fakeCalibrationEnv(signal) : browserCalibrationEnv(signal)),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    fakeScript: () => fakeScriptOverride,
  });
}
