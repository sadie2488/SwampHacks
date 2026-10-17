import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handSweep from '@fixtures/signal/hand-sweep.json';
import { bus, type Landmarks, type ModuleStatus, type Stop } from '@/bus';
import { signalCatalog } from '@/contracts/catalogs';
import type { Signal } from '@/contracts';
import { FAKE_MESSAGE, FAKE_TILT_DEG, SWEEP_LOOP_MS, TILT_PERIOD_MS, startFakeReplay, type Clock, type FakeSink } from './fake';
import { toLandmarks, toObservation } from './frame';
import { describeCameraError, start, startVision } from './index';
import { FACE_MODEL_URL, HAND_MODEL_URL, TASKS_VISION_VERSION, TRACKING_FPS, WASM_URL } from './protocol';
import { makeFace, makeHand } from './synthetic';

const SWEEP = handSweep as unknown as Signal[];

/** A clock the test moves by hand. */
function manualClock(startAt = 1000): Clock & { advance(ms: number): void } {
  let t = startAt;
  const timers: Array<{ every: number; next: number; fn: () => void; on: boolean }> = [];
  return {
    now: () => t,
    every(ms, fn) {
      const timer = { every: ms, next: t + ms, fn, on: true };
      timers.push(timer);
      return () => {
        timer.on = false;
      };
    },
    advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.on && x.next <= target).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        t = due.next;
        due.next += due.every;
        due.fn();
      }
      t = target;
    },
  };
}

describe('fake mode replay', () => {
  function run(ms: number) {
    const clock = manualClock();
    const startedAt = clock.now();
    const signals: Array<Parameters<FakeSink['signal']>[0]> = [];
    const landmarks: Landmarks[] = [];
    const stop = startFakeReplay({ signal: (s) => signals.push(s), landmarks: (l) => landmarks.push(l) }, clock);
    clock.advance(ms);
    return { clock, startedAt, signals, landmarks, stop };
  }

  it('sends the right-hand height sweep and a head tilt, and only ids from the catalog', () => {
    const { signals } = run(2000);
    const ids = new Set(signals.map((s) => s.id));
    expect([...ids].sort()).toEqual(['vision.hand.right.height', 'vision.head.tilt']);
    const known = new Map(signalCatalog.signals.map((s) => [s.id, s]));
    for (const s of signals) {
      expect(known.get(s.id)?.kind).toBe(s.kind);
      expect(s.confidence).toBeGreaterThan(0);
    }
  });

  it('replays the recorded sweep values in order and loops', () => {
    const { signals, startedAt } = run(SWEEP_LOOP_MS * 2 + 500);
    const heights = signals.filter((s) => s.id === 'vision.hand.right.height');
    const recorded = new Set(SWEEP.map((s) => s.value));
    for (const h of heights) expect(recorded.has(h.value)).toBe(true);
    // the first loop is (nearly) all 60 recorded readings, in order
    const firstLoop = heights.filter((h) => h.t_ms! - startedAt < SWEEP_LOOP_MS).map((h) => h.value);
    expect(firstLoop.length).toBeGreaterThanOrEqual(55);
    expect(firstLoop[0]).toBe(SWEEP[0].value);
    let at = 0;
    for (const v of firstLoop) {
      const found = SWEEP.findIndex((s, k) => k >= at && s.value === v);
      expect(found).toBeGreaterThanOrEqual(0); // each value comes from the recording, never going backwards
      at = found;
    }
    // ...and it starts over
    const secondLoop = heights.filter((h) => h.t_ms! - startedAt >= SWEEP_LOOP_MS);
    expect(secondLoop.length).toBeGreaterThan(100 - firstLoop.length);
    expect(secondLoop[0].value).toBeLessThan(0.06);
    expect(Math.max(...heights.map((h) => h.value!))).toBeCloseTo(Math.max(...SWEEP.map((s) => s.value!)), 5);
  });

  it('keeps to about 15 readings a second per signal', () => {
    const { signals, startedAt } = run(3000);
    for (const id of ['vision.hand.right.height', 'vision.head.tilt']) {
      const times = signals.filter((s) => s.id === id).map((s) => s.t_ms! - startedAt);
      for (let from = 0; from + 1000 <= 3000; from += 250) {
        expect(times.filter((t) => t >= from && t < from + 1000).length).toBeLessThanOrEqual(TRACKING_FPS + 1);
      }
    }
  });

  it('swings the head gently to both sides, 0.5 meaning upright', () => {
    const { signals } = run(TILT_PERIOD_MS);
    const tilts = signals.filter((s) => s.id === 'vision.head.tilt');
    const values = tilts.map((s) => s.value!);
    expect(Math.min(...values)).toBeLessThan(0.4);
    expect(Math.max(...values)).toBeGreaterThan(0.6);
    expect(Math.min(...values)).toBeGreaterThan(0.5 - (FAKE_TILT_DEG + 1) / 90);
    expect(Math.max(...values)).toBeLessThan(0.5 + (FAKE_TILT_DEG + 1) / 90);
    for (const s of tilts) expect(Math.abs(s.raw!)).toBeLessThanOrEqual(FAKE_TILT_DEG + 0.1);
  });

  it('draws a right hand and a face for the overlay, all between 0 and 1', () => {
    const { landmarks } = run(1000);
    expect(landmarks.length).toBeGreaterThan(10);
    for (const l of landmarks) {
      expect(l.width).toBe(640);
      expect(l.height).toBe(480);
      expect(l.hands).toHaveLength(1);
      expect(l.hands[0].handedness).toBe('Right');
      expect(l.hands[0].points).toHaveLength(21);
      expect(l.face!.points).toHaveLength(478);
      for (const p of [...l.hands[0].points, ...l.face!.points]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stops cleanly: clears the overlay and sends nothing more', () => {
    const { clock, signals, landmarks, stop } = run(1000);
    const before = signals.length;
    stop();
    expect(landmarks[landmarks.length - 1].hands).toEqual([]);
    expect(landmarks[landmarks.length - 1].face).toBeUndefined();
    clock.advance(5000);
    expect(signals.length).toBe(before);
  });
});

describe('the vision module on the bus', () => {
  const statuses: ModuleStatus[] = [];
  const signals: Signal[] = [];
  const overlays: Landmarks[] = [];
  const streams: Array<MediaStream | null> = [];
  const offs: Stop[] = [];
  let stop: Stop | undefined;

  const enable = (on: boolean, module: 'vision' | 'audio-live' = 'vision') => bus.emit('enable', { module, on });

  beforeEach(() => {
    statuses.length = signals.length = overlays.length = streams.length = 0;
    offs.push(
      bus.on('status', (s) => s.module === 'vision' && statuses.push(s)),
      bus.on('signal', (s) => signals.push(s)),
      bus.on('landmarks', (l) => overlays.push(l)),
      bus.on('cameraStream', (s) => streams.push(s)),
    );
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    offs.splice(0).forEach((o) => o());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does nothing, and never touches the camera, until it is enabled', () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    stop = startVision({ clock: manualClock(), fake: () => false });
    enable(true, 'audio-live'); // another module's switch
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
    expect(signals).toEqual([]);
  });

  it('fake mode: enable shows "running" with the fake-mode message, no camera is opened, and signals flow', () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const clock = manualClock();
    stop = startVision({ clock, fake: () => true });
    enable(true);
    expect(statuses.map((s) => s.state)).toEqual(['starting', 'running']);
    expect(statuses[1].message).toBe(FAKE_MESSAGE);
    expect(FAKE_MESSAGE).toBe('Using made-up camera data (fake mode)');
    clock.advance(1000);
    expect(new Set(signals.map((s) => s.id))).toEqual(new Set(['vision.hand.right.height', 'vision.head.tilt']));
    for (const s of signals) expect(s.version).toBe(1);
    expect(overlays.length).toBeGreaterThan(10);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(streams.filter((s) => s !== null)).toEqual([]);
  });

  it('fake mode: enabling twice does not double the data; disabling stops it and says idle', () => {
    const clock = manualClock();
    stop = startVision({ clock, fake: () => true });
    enable(true);
    enable(true);
    expect(statuses.map((s) => s.state)).toEqual(['starting', 'running']);
    clock.advance(1000);
    const tilts = signals.filter((s) => s.id === 'vision.head.tilt').length;
    expect(tilts).toBeLessThanOrEqual(TRACKING_FPS + 2);
    enable(false);
    expect(statuses[statuses.length - 1].state).toBe('idle');
    expect(overlays[overlays.length - 1].hands).toEqual([]);
    const count = signals.length;
    clock.advance(2000);
    expect(signals.length).toBe(count);
    enable(true); // and it can be turned on again
    clock.advance(500);
    expect(signals.length).toBeGreaterThan(count);
  });

  it('the stop function returned by start() turns it off', () => {
    const clock = manualClock();
    stop = startVision({ clock, fake: () => true });
    enable(true);
    clock.advance(500);
    stop();
    const count = signals.length;
    expect(statuses[statuses.length - 1].state).toBe('idle');
    clock.advance(1000);
    enable(true); // no longer listening
    clock.advance(1000);
    expect(signals.length).toBe(count);
    stop = undefined;
  });

  it('start() with no arguments uses ?fake=1 from the page address', () => {
    vi.stubGlobal('location', { search: '?fake=1' });
    stop = start();
    enable(true);
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'running', message: FAKE_MESSAGE });
  });

  it('a blocked camera gives a plain-words error with what to do, and publishes no stream', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // the module logs the raw browser error for debugging
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    stop = startVision({ clock: manualClock(), fake: () => false });
    enable(true);
    expect(statuses[0].state).toBe('starting');
    await vi.waitFor(() => expect(statuses[statuses.length - 1].state).toBe('error'));
    expect(statuses[statuses.length - 1].message).toBe('Camera permission was blocked: click the camera icon in the address bar and allow it');
    expect(getUserMedia).toHaveBeenCalledWith({ video: { width: 640, height: 480, facingMode: 'user' } });
    expect(streams.filter((s) => s !== null)).toEqual([]);
    // and the user can try again after fixing it
    enable(true);
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  });

  it('a page without camera support (not https) says so', () => {
    vi.stubGlobal('navigator', {});
    stop = startVision({ clock: manualClock(), fake: () => false });
    enable(true);
    const last = statuses[statuses.length - 1];
    expect(last.state).toBe('error');
    expect(last.message).toMatch(/secure page/);
  });

  it('turning it off while the browser is still asking for permission releases the camera as soon as it arrives', async () => {
    const track = { stop: vi.fn(), addEventListener: vi.fn() };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    let allow!: (s: MediaStream) => void;
    const getUserMedia = vi.fn().mockReturnValue(new Promise<MediaStream>((r) => (allow = r)));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    stop = startVision({ clock: manualClock(), fake: () => false });
    enable(true);
    enable(false);
    allow(stream);
    await vi.waitFor(() => expect(track.stop).toHaveBeenCalled());
    expect(streams.filter((s) => s !== null)).toEqual([]);
    expect(statuses[statuses.length - 1].state).toBe('idle');
  });
});

describe('camera error messages', () => {
  const named = (name: string, message = '') => Object.assign(new Error(message), { name });
  it('explains each common problem and what to do', () => {
    expect(describeCameraError(named('NotAllowedError'))).toContain('click the camera icon in the address bar and allow it');
    expect(describeCameraError(named('NotFoundError'))).toContain('No camera was found');
    expect(describeCameraError(named('NotReadableError'))).toContain('Close other apps');
    expect(describeCameraError(named('SomethingNew', 'odd'))).toContain("Couldn't start the camera (odd)");
    expect(describeCameraError(undefined)).toContain("Couldn't start the camera");
  });
});

describe('from the worker to the bus', () => {
  it("turns MediaPipe's raw output into mirrored landmarks with the user's own left and right", () => {
    // The user's right hand: on the left of the plain (unflipped) picture, which MediaPipe calls "Right".
    const raw = { t_ms: 500, width: 640, height: 480, hands: [{ label: 'Right' as const, score: 0.9, points: makeHand({ wrist: { x: 0.25, y: 0.8 } }) }], face: makeFace({ center: { x: 0.4, y: 0.4 } }) };
    const obs = toObservation(raw);
    expect(obs.aspect).toBeCloseTo(4 / 3, 5);
    expect(obs.hands[0].side).toBe('right');
    const l = toLandmarks(obs, raw.width, raw.height);
    expect(l).toMatchObject({ t_ms: 500, width: 640, height: 480 });
    expect(l.hands).toHaveLength(1);
    expect(l.hands[0].handedness).toBe('Right');
    expect(l.hands[0].points).toHaveLength(21);
    expect(l.hands[0].points[0].x).toBeCloseTo(0.75, 5); // flipped
    expect(l.face!.points).toHaveLength(478);
    expect(l.face!.points[1].x).toBeGreaterThan(0.5); // a face on the left of the raw picture is on the right once flipped
  });

  it('the swap switch (?swaphands=1) turns the sides round', () => {
    const raw = { t_ms: 1, width: 640, height: 480, hands: [{ label: 'Right' as const, score: 0.9, points: makeHand({ wrist: { x: 0.25, y: 0.8 } }) }], face: null };
    expect(toObservation(raw).hands[0].side).toBe('right');
    expect(toObservation(raw, true).hands[0].side).toBe('left');
    expect(toObservation(raw, false).hands[0].side).toBe('right');
  });

  it('no face means no face key', () => {
    const l = toLandmarks(toObservation({ t_ms: 1, width: 640, height: 480, hands: [], face: null }), 640, 480);
    expect(l.face).toBeUndefined();
    expect(l.hands).toEqual([]);
  });
});

describe('where the models come from', () => {
  it('the wasm address uses the version that is actually installed', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8')) as { version: string };
    expect(TASKS_VISION_VERSION).toBe(pkg.version);
    expect(WASM_URL).toBe(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${pkg.version}/wasm`);
  });

  it('models come from the public MediaPipe storage and tracking runs at about 15 pictures a second', () => {
    expect(HAND_MODEL_URL).toBe('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task');
    expect(FACE_MODEL_URL).toBe('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task');
    expect(TRACKING_FPS).toBe(15);
  });
});
