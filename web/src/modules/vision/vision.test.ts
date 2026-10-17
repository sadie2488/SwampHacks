import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handSweep from '@fixtures/signal/hand-sweep.json';
import { bus, type Landmarks, type ModuleStatus, type Stop } from '@/bus';
import { signalCatalog } from '@/contracts/catalogs';
import type { Signal } from '@/contracts';
import { FAKE_MESSAGE, FAKE_TILT_DEG, SWEEP_LOOP_MS, TILT_PERIOD_MS, startFakeReplay, type Clock, type FakeSink } from './fake';
import { toLandmarks, toObservation } from './frame';
import { FAKE_PICTURE_TEXT } from './fakePicture';
import { describeCameraError, describeTrackingError, start, startVision } from './index';
import { FACE_MODEL_URL, HAND_MODEL_URL, MODEL_DOWNLOAD_MESSAGE, TASKS_VISION_VERSION, TRACKING_FPS, WASM_URL, type FromWorker } from './protocol';
import { makeFace, makeHand } from './synthetic';

const SWEEP = handSweep as unknown as Signal[];

/** A stand-in for the tracking worker: tests push messages in by calling onmessage / onerror. */
class FakeWorker {
  onmessage: ((ev: { data: FromWorker }) => void) | null = null;
  onerror: ((ev: { message?: string }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  frames = () => this.postMessage.mock.calls.filter(([m]) => (m as { type: string }).type === 'frame').length;
}

/** Everything a real camera start touches, replaced by stand-ins. `workers` fills as the module creates them. */
function cameraRig(opts: { play?: () => Promise<void>; getUserMedia?: () => Promise<MediaStream> } = {}) {
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const video = { muted: false, playsInline: false, srcObject: null as unknown, readyState: 4, videoWidth: 640, videoHeight: 480, play: vi.fn(opts.play ?? (() => Promise.resolve())) };
  const getUserMedia = vi.fn(opts.getUserMedia ?? (() => Promise.resolve(stream)));
  const workers: FakeWorker[] = [];
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('document', { createElement: () => video });
  vi.stubGlobal(
    'Worker',
    class extends FakeWorker {
      constructor() {
        super();
        workers.push(this);
      }
    },
  );
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ close: vi.fn() }));
  return { track, stream, video, getUserMedia, workers, endCamera: () => (track.addEventListener.mock.calls.find(([name]) => name === 'ended')![1] as () => void)() };
}

/** A tracking result with a closed right fist, the way the worker sends it (picture not flipped). */
const fistResult = (t_ms: number): FromWorker => ({
  type: 'result',
  t_ms,
  width: 640,
  height: 480,
  hands: [{ label: 'Right', score: 0.95, points: makeHand({ curl: 1, thumb: 'tucked', wrist: { x: 0.3, y: 0.85 } }) }],
  face: null,
});

/** A canvas stand-in for fake mode's made-up picture. */
function canvasStub(withCaptureStream = true) {
  const g = {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  };
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const captureStream = vi.fn(() => stream);
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => g), ...(withCaptureStream ? { captureStream } : {}) };
  return { canvas: canvas as unknown as HTMLCanvasElement, rawCanvas: canvas, g, track, stream, captureStream };
}

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

  describe('when hand tracking fails but the camera is fine', () => {
    const lastStatus = () => statuses[statuses.length - 1];
    const TAIL = 'Check your internet, or try ?fake=1 to test without a camera.';

    async function cameraOn() {
      const rig = cameraRig();
      const clock = manualClock();
      stop = startVision({ clock, fake: () => false });
      enable(true);
      await vi.waitFor(() => expect(rig.workers).toHaveLength(1));
      return { ...rig, clock, worker: rig.workers[0] };
    }

    it('a worker error keeps the picture and the camera on, says so in plain words, and sends nothing more', async () => {
      const { track, stream, worker, clock, workers } = await cameraOn();
      expect(streams).toEqual([stream]);
      expect(lastStatus().state).toBe('starting');

      // the camera pictures flow to the worker while it is waiting to be ready
      worker.onmessage!({ data: { type: 'ready', delegate: 'CPU' } });
      clock.advance(300);
      await vi.waitFor(() => expect(worker.frames()).toBeGreaterThan(0));
      const framesSent = worker.frames();
      worker.onmessage!({ data: { type: 'error', message: MODEL_DOWNLOAD_MESSAGE } });

      expect(lastStatus()).toMatchObject({ state: 'running', message: `Your camera is on, but hand tracking stopped working: the tracking model could not be downloaded. ${TAIL}` });
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(track.stop).not.toHaveBeenCalled();
      expect(streams).toEqual([stream]); // still published, never cleared
      expect(overlays[overlays.length - 1].hands).toEqual([]);

      // no more pictures go out, and anything the dead worker still says is ignored
      const landmarkCount = overlays.length;
      worker.onmessage!({ data: fistResult(5000) });
      clock.advance(2000);
      await Promise.resolve();
      expect(worker.frames()).toBe(framesSent);
      expect(overlays.length).toBe(landmarkCount);
      expect(signals).toEqual([]);
      expect(workers).toHaveLength(1);
    });

    it('a worker that fails before it ever started says "could not start"; the person can still turn the camera off', async () => {
      const { track, stream, worker, getUserMedia } = await cameraOn();
      worker.onmessage!({ data: { type: 'error', message: 'this browser cannot draw the graphics tracking needs (WebGL). In Chrome settings turn on "Use graphics acceleration when available", then reload' } });
      expect(lastStatus()).toMatchObject({
        state: 'running',
        message: `Your camera is on, but hand tracking could not start: this browser cannot draw the graphics tracking needs (WebGL). In Chrome settings turn on "Use graphics acceleration when available", then reload. ${TAIL}`,
      });
      const count = statuses.length;
      worker.onmessage!({ data: { type: 'error', message: 'a second complaint' } }); // reported once per run
      expect(statuses.length).toBe(count);
      enable(true); // already on: nothing starts twice
      expect(getUserMedia).toHaveBeenCalledTimes(1);

      enable(false); // now turn it off: everything stops cleanly
      expect(track.stop).toHaveBeenCalledTimes(1);
      expect(streams).toEqual([stream, null]);
      expect(lastStatus().state).toBe('idle');
      expect(worker.terminate).toHaveBeenCalledTimes(1); // not terminated a second time
    });

    it('a crash of the background worker is a tracking problem too, with the browser\'s own words', async () => {
      const { track, stream, worker } = await cameraOn();
      worker.onerror!({ message: 'Script error' });
      expect(lastStatus()).toMatchObject({ state: 'running', message: `Your camera is on, but hand tracking could not start: its background worker crashed (Script error). ${TAIL}` });
      expect(track.stop).not.toHaveBeenCalled();
      expect(streams).toEqual([stream]);
      stop?.(); // the stop function returned by start() also cleans up after a tracking failure
      stop = undefined;
      expect(track.stop).toHaveBeenCalledTimes(1);
      expect(streams).toEqual([stream, null]);
    });

    it('the background worker not being creatable at all is a tracking problem, not a camera problem', async () => {
      const rig = cameraRig();
      vi.stubGlobal('Worker', function () {
        throw new Error('modules are not supported');
      });
      stop = startVision({ clock: manualClock(), fake: () => false });
      enable(true);
      await vi.waitFor(() => expect(lastStatus().state).toBe('running'));
      expect(lastStatus().message).toBe(`Your camera is on, but hand tracking could not start: its background worker could not be started (modules are not supported). ${TAIL}`);
      expect(rig.track.stop).not.toHaveBeenCalled();
      expect(streams).toEqual([rig.stream]);
    });

    it('ends a gesture that is being held, once, and then stays quiet', async () => {
      const { worker, clock } = await cameraOn();
      worker.onmessage!({ data: { type: 'ready', delegate: 'GPU' } });
      for (let i = 0; i < 20; i++) worker.onmessage!({ data: fistResult(1000 + i * 67) });
      const moments = () => signals.filter((s) => s.kind === 'moment');
      expect(moments().map((s) => s.state)).toEqual(['start']); // the fist is being held
      worker.onmessage!({ data: { type: 'error', message: 'the tracking engine kept failing (boom)' } });
      expect(moments().map((s) => s.state)).toEqual(['start', 'end']);
      expect(moments()[1].id).toBe(moments()[0].id);
      const count = signals.length;
      worker.onmessage!({ data: fistResult(3000) });
      clock.advance(3000);
      expect(signals.length).toBe(count);
      enable(false);
      expect(signals.length).toBe(count); // turning the camera off afterwards does not end it a second time
    });

    it('wraps the reason in one sentence without doubling full stops', () => {
      expect(describeTrackingError('it broke.', false)).toBe(`Your camera is on, but hand tracking could not start: it broke. ${TAIL}`);
      expect(describeTrackingError('it broke', true)).toBe(`Your camera is on, but hand tracking stopped working: it broke. ${TAIL}`);
    });
  });

  describe('when the camera itself fails, everything stops', () => {
    const lastStatus = () => statuses[statuses.length - 1];

    it('a camera that cannot be opened ends in "error" with no stream', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rig = cameraRig({ getUserMedia: () => Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' })) });
      stop = startVision({ clock: manualClock(), fake: () => false });
      enable(true);
      await vi.waitFor(() => expect(lastStatus().state).toBe('error'));
      expect(lastStatus().message).toBe('No camera was found. Plug one in (or turn it on), then try again');
      expect(rig.workers).toHaveLength(0);
      expect(streams).toEqual([]);
    });

    it('a camera that will not play stops the camera and ends in "error"', async () => {
      const rig = cameraRig({ play: () => Promise.reject(Object.assign(new Error('busy'), { name: 'NotReadableError' })) });
      stop = startVision({ clock: manualClock(), fake: () => false });
      enable(true);
      await vi.waitFor(() => expect(lastStatus().state).toBe('error'));
      expect(lastStatus().message).toBe('The camera is busy or not responding. Close other apps that use it (like Zoom or Teams) and try again');
      expect(rig.track.stop).toHaveBeenCalledTimes(1);
      expect(streams).toEqual([rig.stream, null]);
      expect(rig.workers).toHaveLength(0);
    });

    it('a camera that is unplugged while tracking works stops everything and ends in "error"', async () => {
      const rig = cameraRig();
      stop = startVision({ clock: manualClock(), fake: () => false });
      enable(true);
      await vi.waitFor(() => expect(rig.workers).toHaveLength(1));
      const worker = rig.workers[0];
      worker.onmessage!({ data: { type: 'ready', delegate: 'CPU' } });
      for (let i = 0; i < 20; i++) worker.onmessage!({ data: fistResult(1000 + i * 67) });
      rig.endCamera();
      expect(lastStatus()).toMatchObject({ state: 'error', message: 'The camera stopped (was it unplugged?). Turn it on again to retry' });
      expect(rig.track.stop).toHaveBeenCalledTimes(1);
      expect(streams).toEqual([rig.stream, null]);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(signals.filter((s) => s.kind === 'moment').map((s) => s.state)).toEqual(['start', 'end']);
    });

    it('a camera that is unplugged after tracking already failed still ends in "error" and stops the stream', async () => {
      const rig = cameraRig();
      stop = startVision({ clock: manualClock(), fake: () => false });
      enable(true);
      await vi.waitFor(() => expect(rig.workers).toHaveLength(1));
      rig.workers[0].onmessage!({ data: { type: 'error', message: 'x' } });
      expect(lastStatus().state).toBe('running');
      rig.endCamera();
      expect(lastStatus().state).toBe('error');
      expect(rig.track.stop).toHaveBeenCalledTimes(1);
      expect(streams).toEqual([rig.stream, null]);
    });
  });

  describe('fake mode picture', () => {
    const wristOf = () => overlays[overlays.length - 1].hands[0]?.points[0];

    it('publishes a made-up camera picture when fake mode starts, and clears it (and stops its tracks) when it stops', () => {
      const c = canvasStub();
      const clock = manualClock();
      stop = startVision({ clock, fake: () => true, makeCanvas: () => c.canvas });
      enable(true);
      expect(streams).toEqual([c.stream]);
      expect(c.captureStream).toHaveBeenCalledWith(15);
      expect(c.canvas.width).toBe(640);
      expect(c.canvas.height).toBe(480);
      expect(statuses.map((s) => s.state)).toEqual(['starting', 'running']);
      expect(c.g.fillRect).toHaveBeenCalledWith(0, 0, 640, 480); // dark background
      expect(c.g.fillText).toHaveBeenCalledWith(FAKE_PICTURE_TEXT, 320, 24);
      expect(FAKE_PICTURE_TEXT).toBe('Made-up camera (fake mode)');
      expect(c.g.scale).toHaveBeenCalledWith(-1, 1); // the words are pre-flipped because the preview is mirrored

      clock.advance(1000);
      const drawn = c.g.arc.mock.calls.length;
      expect(drawn).toBeGreaterThan(10); // redrawn about 15 times a second

      enable(false);
      expect(c.track.stop).toHaveBeenCalledTimes(1);
      expect(streams).toEqual([c.stream, null]);
      expect(statuses[statuses.length - 1].state).toBe('idle');
      clock.advance(2000);
      expect(c.g.arc.mock.calls.length).toBe(drawn); // the drawing timer is stopped too
    });

    it('draws a circle that moves with the fake right hand', () => {
      const c = canvasStub();
      const clock = manualClock();
      stop = startVision({ clock, fake: () => true, makeCanvas: () => c.canvas });
      enable(true);
      clock.advance(SWEEP_LOOP_MS);
      const ys = c.g.arc.mock.calls.map((a) => a[1] as number);
      const xs = new Set(c.g.arc.mock.calls.map((a) => a[0] as number));
      expect(new Set(ys.map((y) => Math.round(y))).size).toBeGreaterThan(8); // it goes up and down
      for (const y of ys) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(480);
      }
      // it sits where the hand is on the plain picture: same height as the overlay's wrist, x flipped
      const last = c.g.arc.mock.calls[c.g.arc.mock.calls.length - 1];
      expect(last[1]).toBeCloseTo(wristOf()!.y * 480, 6);
      expect(last[0]).toBeCloseTo((1 - wristOf()!.x) * 640, 6);
      expect(xs.size).toBe(1);
    });

    it('still works, with no picture, where a canvas cannot make a stream (like a test browser)', () => {
      const c = canvasStub(false);
      const clock = manualClock();
      stop = startVision({ clock, fake: () => true, makeCanvas: () => c.canvas });
      enable(true);
      clock.advance(1000);
      expect(c.canvas.getContext).not.toHaveBeenCalled();
      expect(streams).toEqual([]);
      expect(statuses.map((s) => s.state)).toEqual(['starting', 'running']);
      expect(signals.length).toBeGreaterThan(10);
      enable(false);
      expect(streams).toEqual([]); // nothing was published, so there is nothing to clear
      expect(statuses[statuses.length - 1].state).toBe('idle');
    });

    it('still works when the page has no way to make a canvas at all', () => {
      const clock = manualClock();
      stop = startVision({ clock, fake: () => true, makeCanvas: () => null });
      enable(true);
      clock.advance(500);
      expect(streams).toEqual([]);
      expect(signals.length).toBeGreaterThan(5);
    });

    it('a canvas that fails to make a stream does not break fake mode', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const c = canvasStub();
      c.captureStream.mockImplementation(() => {
        throw new Error('not allowed');
      });
      const clock = manualClock();
      stop = startVision({ clock, fake: () => true, makeCanvas: () => c.canvas });
      enable(true);
      clock.advance(500);
      expect(streams).toEqual([]);
      expect(statuses[statuses.length - 1].state).toBe('running');
      expect(signals.length).toBeGreaterThan(5);
    });
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
