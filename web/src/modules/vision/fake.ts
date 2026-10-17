// Fake mode (page opened with ?fake=1): no camera. Replays the recorded right-hand sweep in a loop, adds a gentle head
// tilt, and publishes made-up hand and face points so the tracking overlay has something to draw.
import handSweep from '@fixtures/signal/hand-sweep.json';
import type { Landmarks } from '@/bus';
import type { Signal } from '@/contracts';
import { tiltToSlider, type Pt } from './gestures';
import { makeFace, makeHand } from './synthetic';
import { TRACKING_FPS } from './protocol';

export const FAKE_MESSAGE = 'Using made-up camera data (fake mode)';

/** Time and repeating timers, so tests can drive fake mode with a clock they control. */
export interface Clock {
  now(): number;
  /** Call `fn` every `ms`; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
}
export const realClock: Clock = {
  now: () => performance.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

export interface FakeSink {
  signal(s: Omit<Signal, 'version' | 't_ms'> & { t_ms?: number }): void;
  landmarks(l: Landmarks): void;
}

const SWEEP = handSweep as unknown as Signal[];
/** The sweep is recorded at about 15 readings a second; one loop lasts a bit longer than the last reading. */
export const SWEEP_LOOP_MS = SWEEP[SWEEP.length - 1].t_ms + (SWEEP[SWEEP.length - 1].t_ms - SWEEP[SWEEP.length - 2].t_ms);
/** The fake head swings between +/- this many degrees, once every TILT_PERIOD_MS. */
export const FAKE_TILT_DEG = 15;
export const TILT_PERIOD_MS = 6000;

/** A reading due a hair after this tick is sent now, so timer rounding doesn't make us skip every other one. */
const SLACK_MS = 20;
const WIDTH = 640;
const HEIGHT = 480;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clampPts = (pts: Pt[]) => pts.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y), z: p.z ?? 0 }));

/** Start the replay. Returns a function that stops it (and clears the overlay). */
export function startFakeReplay(sink: FakeSink, clock: Clock = realClock): () => void {
  const startedAt = clock.now();
  let loop = 0;
  let next = 0; // index of the next sweep reading to send this loop
  let lastHeight = SWEEP[0].value ?? 0.5;

  const tick = () => {
    const now = clock.now();
    const elapsed = now - startedAt;
    const thisLoop = Math.floor(elapsed / SWEEP_LOOP_MS);
    if (thisLoop !== loop) {
      loop = thisLoop;
      next = 0;
    }
    const pos = elapsed - loop * SWEEP_LOOP_MS;

    // Send the newest sweep reading we have reached (skipping any we fell behind on, so the rate stays near 15 a second).
    let latest: Signal | undefined;
    while (next < SWEEP.length && SWEEP[next].t_ms <= pos + SLACK_MS) latest = SWEEP[next++];
    if (latest) sink.signal({ id: latest.id, kind: 'slider', value: latest.value, confidence: latest.confidence, t_ms: now });

    const deg = FAKE_TILT_DEG * Math.sin((2 * Math.PI * elapsed) / TILT_PERIOD_MS);
    sink.signal({ id: 'vision.head.tilt', kind: 'slider', value: Math.round(tiltToSlider(deg) * 1000) / 1000, raw: Math.round(deg * 10) / 10, confidence: 0.9, t_ms: now });

    // Made-up points: the right hand follows the sweep height (on the right side of the mirrored picture).
    const height = latest?.value ?? lastHeight;
    lastHeight = height;
    const hand = makeHand({ curl: 0.05, wrist: { x: 0.72, y: 1 - height + 0.09 } });
    sink.landmarks({ t_ms: now, width: WIDTH, height: HEIGHT, hands: [{ handedness: 'Right', points: clampPts(hand) }], face: { points: clampPts(makeFace({ center: { x: 0.45, y: 0.38 }, tiltDeg: deg })) } });
  };
  const stopTimer = clock.every(1000 / TRACKING_FPS, tick);
  tick();
  return () => {
    stopTimer();
    sink.landmarks({ t_ms: clock.now(), width: WIDTH, height: HEIGHT, hands: [] });
  };
}
