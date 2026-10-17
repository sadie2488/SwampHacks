// The "vision" module: camera tracking and gestures.
//
// Turned on and off by bus "enable" events for module "vision" (so the camera never opens before a click). While on:
//   camera -> hidden <video> -> (15 times a second) picture sent to a background worker -> hand and face points come back
//   -> published as "landmarks" (for the overlay) -> gestures.ts turns them into "signal" readings.
// With ?fake=1 there is no camera: fake.ts replays recorded data instead, and fakePicture.ts draws a made-up picture for the preview.
//
// Two kinds of failure: a CAMERA problem (blocked, missing, unplugged) stops everything and reports "error". A TRACKING
// problem (model download, WebGL, worker crash) only stops tracking: the camera stays on and visible, status stays "running".
//
// Mirroring: the camera picture is NOT flipped when MediaPipe sees it, but everything we publish is in the mirrored
// (selfie) view: x is flipped and "Left"/"Right" are the user's own hands. The "cameraStream" we publish is the plain,
// unflipped video, so whoever shows it must flip it with CSS (transform: scaleX(-1)) to line up with the landmarks.
import { bus, isFakeMode, reportStatus, sendSignal, type Stop } from '@/bus';
import { FAKE_MESSAGE, realClock, startFakeReplay, type Clock } from './fake';
import { toLandmarks, toObservation } from './frame';
import { startFakePicture, pageCanvas } from './fakePicture';
import { GestureTracker, type Pt } from './gestures';
import { FACE_MODEL_URL, HAND_MODEL_URL, TRACKING_FPS, WASM_URL, type FromWorker, type ToWorker } from './protocol';

const MODULE = 'vision';

/** Plain-words reason a camera request failed, with what to do about it. */
export function describeCameraError(e: unknown): string {
  const name = String((e as { name?: unknown } | null)?.name ?? '');
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera permission was blocked: click the camera icon in the address bar and allow it';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return "No camera was found. Plug one in (or turn it on), then try again";
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'The camera is busy or not responding. Close other apps that use it (like Zoom or Teams) and try again';
    default:
      return `Couldn't start the camera${e instanceof Error && e.message ? ` (${e.message})` : ''}. You can still test with ?fake=1`;
  }
}

/** The full sentence shown when tracking fails but the camera itself is fine. `reason` is the worker's own wording. */
export function describeTrackingError(reason: string, wasRunning: boolean): string {
  const what = wasRunning ? 'hand tracking stopped working' : 'hand tracking could not start';
  return `Your camera is on, but ${what}: ${reason.trim().replace(/[.\s]+$/, '')}. Check your internet, or try ?fake=1 to test without a camera.`;
}

/** `?delegate=cpu` or `?delegate=gpu` in the page address forces where tracking runs (default: graphics card, falling back to the processor). */
function delegateFromAddress(): 'auto' | 'CPU' | 'GPU' {
  const v = (typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('delegate') ?? '')).toUpperCase();
  return v === 'CPU' || v === 'GPU' ? v : 'auto';
}

/** `?swaphands=1` (or `=0`) in the page address overrides which way round the left/right hand label is (see SWAP_HANDEDNESS). */
function swapHandsFromAddress(): boolean | undefined {
  const v = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('swaphands');
  return v === null ? undefined : v !== '0';
}

interface Run {
  stopped: boolean;
  /** Things to undo when this run ends, newest first. */
  undo: Array<() => void>;
}

export interface VisionDeps {
  clock: Clock;
  fake: () => boolean;
  /** Makes the canvas for fake mode's made-up picture (null: no picture). */
  makeCanvas: () => HTMLCanvasElement | null;
}

export function startVision(deps: Partial<VisionDeps> = {}): Stop {
  const clock = deps.clock ?? realClock;
  const fake = deps.fake ?? isFakeMode;
  const makeCanvas = deps.makeCanvas ?? pageCanvas;
  let current: Run | null = null;

  const stopRun = (run: Run): void => {
    if (run.stopped) return;
    run.stopped = true;
    for (const undo of run.undo.reverse()) {
      try {
        undo();
      } catch (e) {
        console.error('[vision] cleanup step failed', e);
      }
    }
    if (current === run) current = null;
  };
  const fail = (run: Run, message: string): void => {
    if (run.stopped) return;
    stopRun(run);
    reportStatus(MODULE, 'error', message);
  };
  const clearOverlay = (width = 640, height = 480): void => bus.emit('landmarks', { t_ms: clock.now(), width, height, hands: [] });

  function startFake(run: Run): void {
    let wrist: Pt | null = null;
    run.undo.push(
      startFakeReplay(
        {
          signal: sendSignal,
          landmarks: (l) => {
            wrist = l.hands[0]?.points[0] ?? null;
            bus.emit('landmarks', l);
          },
        },
        clock,
      ),
    );
    // A made-up camera picture, so the preview has something to show (skipped where the browser can't make one).
    const picture = startFakePicture({ clock, handAt: () => wrist, makeCanvas });
    if (picture) {
      run.undo.push(() => {
        picture.stop();
        bus.emit('cameraStream', null);
      });
      bus.emit('cameraStream', picture.stream);
    }
    reportStatus(MODULE, 'running', FAKE_MESSAGE);
  }

  async function startCamera(run: Run): Promise<void> {
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!devices?.getUserMedia) return fail(run, 'The camera needs a secure page (https:// or localhost). Open the app from localhost or an https address');

    let stream: MediaStream;
    try {
      stream = await devices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
    } catch (e) {
      console.warn('[vision] the camera request failed', e);
      return fail(run, describeCameraError(e));
    }
    if (run.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    run.undo.push(() => {
      stream.getTracks().forEach((t) => t.stop());
      bus.emit('cameraStream', null);
    });
    bus.emit('cameraStream', stream);
    stream.getVideoTracks()[0]?.addEventListener('ended', () => fail(run, 'The camera stopped (was it unplugged?). Turn it on again to retry'));
    reportStatus(MODULE, 'starting', 'Loading the tracking model (the first time can take a few seconds)...');

    // The worker needs pictures, and a video element is the easiest way to get them from a camera stream.
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    run.undo.push(() => {
      video.srcObject = null;
    });
    try {
      await video.play();
    } catch (e) {
      if (!run.stopped) fail(run, describeCameraError(e));
      return;
    }
    if (run.stopped) return;

    // From here on, a problem with tracking (the model won't download, no WebGL, the worker crashes) is NOT a camera problem:
    // only tracking shuts down and the stream stays published, so the person still sees themselves and can turn the camera off.
    const tracker = new GestureTracker();
    const swapHands = swapHandsFromAddress();
    let worker: Worker | undefined;
    let stopFrameTimer: (() => void) | undefined;
    let ready = false;
    let trackingOff = false;
    // Also the first step of the full cleanup (the undo list runs newest first). Safe to call twice.
    const stopTracking = (): void => {
      if (trackingOff) return;
      trackingOff = true;
      try {
        stopFrameTimer?.();
        // End anything still held (a fist, say) so nothing stays "on" after tracking stops.
        for (const s of tracker.reset(clock.now())) sendSignal(s);
        clearOverlay(video.videoWidth || 640, video.videoHeight || 480);
      } finally {
        worker?.terminate();
      }
    };
    run.undo.push(stopTracking);
    const trackingFailed = (reason: string): void => {
      if (run.stopped || trackingOff) return;
      stopTracking();
      // "running", not "error": the camera is on, and the on/off buttons must still be able to turn it off.
      reportStatus(MODULE, 'running', describeTrackingError(reason, ready));
    };

    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      return trackingFailed(`its background worker could not be started${e instanceof Error && e.message ? ` (${e.message})` : ''}`);
    }
    const w: Worker = worker;
    const send = (m: ToWorker, transfer: Transferable[] = []): void => w.postMessage(m, transfer);

    let inFlight = false;
    let sentAt = -Infinity;
    const frameMs = 1000 / TRACKING_FPS;
    // Hand the worker the newest picture if it is idle and the last one went out at least about a frame ago.
    const grab = (): void => {
      if (!ready || run.stopped || trackingOff || video.readyState < 2 || video.videoWidth === 0) return;
      const now = clock.now();
      if (now - sentAt < frameMs * 0.9) return;
      if (inFlight && now - sentAt < 2000) return;
      inFlight = true;
      sentAt = now;
      createImageBitmap(video).then(
        (bitmap) => {
          if (run.stopped || trackingOff) return bitmap.close();
          send({ type: 'frame', bitmap, t_ms: now }, [bitmap]);
        },
        () => {
          inFlight = false;
        },
      );
    };

    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (run.stopped || trackingOff) return;
      if (m.type === 'ready') {
        ready = true;
        console.info(`[vision] tracking is running on the ${m.delegate === 'GPU' ? 'graphics card' : 'processor'}`);
        reportStatus(MODULE, 'running', 'Camera tracking is on');
        return;
      }
      if (m.type === 'error') return trackingFailed(m.message);
      inFlight = false;
      if (m.type === 'result') {
        const obs = toObservation(m, swapHands);
        bus.emit('landmarks', toLandmarks(obs, m.width, m.height));
        for (const s of tracker.update(obs)) sendSignal(s);
      }
      grab(); // don't wait for the next tick if we are already due
    };
    w.onerror = (ev) => trackingFailed(ev.message ? `its background worker crashed (${ev.message})` : 'its background worker crashed');
    send({ type: 'init', wasmUrl: WASM_URL, handModelUrl: HAND_MODEL_URL, faceModelUrl: FACE_MODEL_URL, delegate: delegateFromAddress() });

    // About 15 times a second, offer the worker a picture. If it is still busy with the last one, skip this round.
    stopFrameTimer = clock.every(frameMs, grab);
  }

  const turnOn = (): void => {
    if (current) return;
    const run: Run = { stopped: false, undo: [] };
    current = run;
    if (fake()) {
      reportStatus(MODULE, 'starting', 'Starting made-up camera data...');
      startFake(run);
    } else {
      reportStatus(MODULE, 'starting', 'Asking for the camera...');
      void startCamera(run);
    }
  };
  const turnOff = (): void => {
    const run = current;
    if (!run) return;
    stopRun(run);
    reportStatus(MODULE, 'idle');
  };

  const offEnable = bus.on('enable', (e) => {
    if (e.module !== MODULE) return;
    if (e.on) turnOn();
    else turnOff();
  });
  return () => {
    offEnable();
    turnOff();
  };
}

export function start(): Stop {
  return startVision();
}
