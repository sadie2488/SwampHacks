// Runs the paper landscape: creates it if this browser can, and decides when to draw.
// - Still: one frame, redrawn only when the window changes size. Always still for people who prefer reduced motion.
// - While the song plays: up to 30 frames a second (20 while the camera is on), the paper dots bob on the beat.
// - Nothing is drawn while the tab is hidden.
// Anything that goes wrong returns null or calls onFail, so the page quietly keeps its plain paper background.
// Loaded on demand (with three.js) so it does not slow down the first view of the page.
import { bus, isModuleOn, type TransportState } from '@/bus';
import { beatKick, CAMERA_FPS, frameDue, MAX_FPS, phaseNow } from './motion';
import { createReefScene, type ReefScene } from './scene';

const MAX_PIXEL_RATIO = 1.5;

const CONTEXT_OPTIONS: WebGLContextAttributes = {
  antialias: true,
  alpha: false,
  depth: true,
  stencil: false,
  powerPreference: 'low-power',
  // A computer with no graphics chip would draw this slowly in software and steal time from hand tracking: skip it.
  failIfMajorPerformanceCaveat: true,
};

/** Ask for a WebGL context ourselves, so a browser without WebGL never reaches three.js (which would log an error). */
function getContext(canvas: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext | null {
  try {
    return (canvas.getContext('webgl2', CONTEXT_OPTIONS) as WebGL2RenderingContext | null) ?? (canvas.getContext('webgl', CONTEXT_OPTIONS) as WebGLRenderingContext | null);
  } catch {
    return null;
  }
}

export interface Backdrop {
  stop(): void;
}

export function startBackdrop(canvas: HTMLCanvasElement, onFail: () => void): Backdrop | null {
  const gl = getContext(canvas);
  if (!gl) return null;

  let reef: ReefScene;
  try {
    reef = createReefScene(canvas, gl, Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1));
    reef.resize(window.innerWidth, window.innerHeight);
    reef.draw(0, 0);
  } catch {
    return null;
  }

  const reducedQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = reducedQuery?.matches ?? false;
  let stopped = false;
  let raf = 0;
  let lastFrame = 0;
  let needsResize = false;
  let transport: TransportState | undefined;
  let transportAt = 0;
  const startedAt = performance.now();

  const animating = () => !reduced && !!transport?.playing;

  const fail = () => {
    if (stopped) return;
    stop();
    onFail();
  };

  const drawNow = (now: number) => {
    if (needsResize) {
      needsResize = false;
      reef.resize(window.innerWidth, window.innerHeight);
    }
    let kick = 0;
    let t = 0;
    if (animating() && transport) {
      kick = beatKick(phaseNow(transport.beatPhase ?? 0, transport.bpm ?? 0, now - transportAt));
      t = (now - startedAt) / 1000;
    }
    reef.draw(kick, t);
  };

  const tick = (now: number) => {
    raf = 0;
    if (stopped || document.hidden) return;
    const moving = animating();
    try {
      if (!moving || frameDue(now, lastFrame, isModuleOn('vision') ? CAMERA_FPS : MAX_FPS)) {
        lastFrame = now;
        drawNow(now);
      }
    } catch {
      fail();
      return;
    }
    if (moving) raf = requestAnimationFrame(tick);
  };

  /** Draw on the next frame (once), or keep going if the music is playing. */
  const wake = () => {
    if (!stopped && !raf && !document.hidden) raf = requestAnimationFrame(tick);
  };

  const offTransport = bus.on(
    'transport',
    (t) => {
      const wasMoving = animating();
      transport = t;
      transportAt = performance.now();
      // start the loop when the music starts, and draw one calm frame when it stops
      if (animating() !== wasMoving) wake();
    },
    { replay: true },
  );

  const onResize = () => {
    needsResize = true;
    wake();
  };
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  const onReducedChange = () => {
    reduced = reducedQuery?.matches ?? false;
    wake();
  };
  const onContextLost = (e: Event) => {
    e.preventDefault();
    fail();
  };

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  reducedQuery?.addEventListener?.('change', onReducedChange);
  canvas.addEventListener('webglcontextlost', onContextLost);

  function stop() {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    offTransport();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    reducedQuery?.removeEventListener?.('change', onReducedChange);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    try {
      reef.dispose();
    } catch {
      // already gone
    }
  }

  return { stop };
}
