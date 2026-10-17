// The browser end of the clap check: the clicks (Web Audio) and the claps (the audio.clap / audio.onset signals).
// Fake mode has its own version that plays no sound and makes up the claps.
import { bus, getAudioContext, resumeAudio, sendSignal } from '@/bus';
import type { CalibrationEnv } from './calibration';
import { clickTimesMs } from './calibration';
import { PRACTICE } from './config';

/** Wait, but give up early (answering false) when the signal is aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onAbort = () => done(false);
    const timer = setTimeout(() => done(true), Math.max(0, ms));
    signal?.addEventListener('abort', onAbort);
  });
}

/** Every clap (and, unless only claps are wanted, any other sudden sound) the microphone module reports, as page-clock ms. */
function listenForHits(onHit: (tMs: number) => void, clapsOnly = false): () => void {
  return bus.on('signal', (s) => {
    if ((s.id === 'audio.clap' || (!clapsOnly && s.id === 'audio.onset')) && Number.isFinite(s.t_ms)) onHit(s.t_ms);
  });
}

/**
 * How far the page clock is ahead of the audio clock: performance.now() - currentTime * 1000, in ms.
 * AudioContext.currentTime only moves in whole render blocks, so any single reading is a little behind; the reading with the
 * smallest difference is the freshest one. We take several, spread over about 150 ms.
 */
export async function measureClockOffsetMs(ctx: AudioContext, signal?: AbortSignal, samples = 10, gapMs = 15): Promise<number> {
  let best = Infinity;
  for (let k = 0; k < samples; k++) {
    // read the two clocks one straight after the other
    const page = performance.now();
    const audio = ctx.currentTime;
    best = Math.min(best, page - audio * 1000);
    if (k < samples - 1 && !(await sleep(gapMs, signal))) break;
  }
  return best;
}

/** One short click: a quick tick that fades out in about 50 ms. The first one is higher so the person knows when it starts. */
function scheduleClick(ctx: AudioContext, atSec: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(0.0001, atSec);
  gain.gain.linearRampToValueAtTime(PRACTICE.calibration.clickGain, atSec + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, atSec + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(atSec);
  osc.stop(atSec + 0.06);
}

/**
 * The real thing. A click scheduled at AudioContext time T is turned into page-clock time as T * 1000 + offset, where the
 * offset is measured just before (measureClockOffsetMs). That is the time the audio engine renders the click; the person hears
 * it a little later (output latency), claps, and the microphone hears the clap a little later still (input latency). All of
 * that is part of the offset we measure, which is what we want: the song's own clock (the transport position) is also the
 * engine's, so what is subtracted later is exactly the lag between "the engine says now" and "the microphone hears the player".
 * getOutputTimestamp() is deliberately not used: it gives the time the sound leaves the speaker, which would leave the output
 * lag out of the offset while the transport clock still has it in.
 */
export function browserCalibrationEnv(signal?: AbortSignal): CalibrationEnv {
  return {
    async startClicks(count, bpm, leadInSec) {
      const ctx = await resumeAudio();
      const offset = await measureClockOffsetMs(ctx, signal);
      const first = getAudioContext().currentTime + leadInSec;
      const interval = 60 / bpm;
      for (let k = 0; k < count; k++) scheduleClick(ctx, first + k * interval, k === 0);
      return clickTimesMs(first * 1000 + offset, count, bpm);
    },
    listen: (onHit) => listenForHits(onHit),
    now: () => performance.now(),
    sleep,
  };
}

/** How the made-up player claps in fake mode: always this late, a few ms either way (the same every run). */
const FAKE_WOBBLE_MS = [-5, 4, -2, 6, -4, 1];

/** Fake mode: no sound. Pretend claps arrive 120 ms after each click, through the same signal the real microphone uses. */
export function fakeCalibrationEnv(signal?: AbortSignal): CalibrationEnv {
  return {
    async startClicks(count, bpm, leadInSec) {
      const clicks = clickTimesMs(performance.now() + leadInSec * 1000, count, bpm);
      clicks.forEach((t, k) => {
        const at = t + PRACTICE.fake.latencyMs + FAKE_WOBBLE_MS[k % FAKE_WOBBLE_MS.length];
        const timer = setTimeout(() => sendSignal({ id: 'audio.clap', kind: 'moment', state: 'start', confidence: 0.9, t_ms: at }), Math.max(0, at - performance.now()));
        signal?.addEventListener('abort', () => clearTimeout(timer));
      });
      return clicks;
    },
    // the looping made-up hum reports an onset for every note it plays, which would be mistaken for claps
    listen: (onHit) => listenForHits(onHit, true),
    now: () => performance.now(),
    sleep,
  };
}
