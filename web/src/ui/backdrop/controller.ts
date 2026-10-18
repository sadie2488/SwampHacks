// Runs the Overture background: one loop, at most 30 frames a second (20 while the camera is on, so hand tracking
// keeps its share), only while something moves (camera picture, music, a colour change, a ripple); otherwise one
// still frame. Nothing is drawn while the tab is hidden or the entrance covers it. People who prefer less motion
// get still frames only. If the first frames are slow, it drops to half resolution and no grain, once.
// Anything that goes wrong returns null or calls onFail, so the page quietly keeps its CSS background.
import { Color } from 'three';
import { isModuleOn } from '@/bus';
import { listenToCamera, listenToMusic } from './inputs';
import { ease, sectionColours, targetLook, tooSlow, type LookNumbers, type ScreenName } from './looks';
import { CAMERA_FPS, frameDue, MAX_FPS } from './motion';
import { createScene, type Look, type OvertureScene } from './scene';
import { getContext } from './webgl';

const MAX_PIXEL_RATIO = 1.5;
const NUM_KEYS = ['effect', 'ink', 'sat', 'tint', 'dim', 'vignette', 'grain', 'scale'] as const;

export interface Backdrop {
  stop(): void;
  setLook(screen: ScreenName, mode: string): void;
  ripple(x: number, y: number): void;
}

export function startBackdrop(canvas: HTMLCanvasElement, onFail: () => void): Backdrop | null {
  const gl = getContext(canvas);
  if (!gl) return null;
  let scene: OvertureScene;
  try {
    scene = createScene(canvas, gl);
  } catch {
    return null;
  }
  const reducedQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = reducedQuery?.matches ?? false;
  let screen: ScreenName = 'mode';
  let mode = 'learn';
  let hasCam = false;
  let quality = 1;
  let stopped = false;
  let raf = 0;
  let last = 0;
  let size = '';
  let misKick = 0;
  let rippleAt = -99;
  const gaps: number[] = [];
  const t0 = performance.now();
  const target = { a: new Color(), b: new Color(), bg: new Color(), n: targetLook('mode', false) };
  const now0 = targetLook('mode', false);
  const look: Look & LookNumbers = { a: new Color(), b: new Color(), bg: new Color(), ...now0, mis: 1, level: 0, low: 0, high: 0, pulse: 0 };

  const music = listenToMusic(() => wake());
  const stopCamera = listenToCamera(
    (video) => {
      hasCam = !!video && !reduced;
      scene.setCamera(hasCam ? video : null);
      retarget();
    },
    () => {
      scene.cameraFrame();
      wake();
    },
  );

  function retarget() {
    const c = sectionColours(screen, mode);
    target.a.set(c.a);
    target.b.set(c.b);
    target.bg.set(c.bg);
    target.n = targetLook(screen, hasCam);
    if (quality < 1) target.n = { ...target.n, grain: 0 };
    wake();
  }

  const settled = () => NUM_KEYS.every((k) => Math.abs(look[k] - target.n[k]) < 0.004) && look.a.equals(target.a) && look.bg.equals(target.bg);
  const busy = (t: number) => !reduced && ((hasCam && screen !== 'entrance') || music.playing || !settled() || misKick > 0.01 || t - rippleAt < 3);

  function draw(now: number, dt: number) {
    const t = (now - t0) / 1000;
    for (const k of NUM_KEYS) look[k] = reduced ? target.n[k] : ease(look[k], target.n[k], dt);
    const k = reduced ? 1 : Math.min(1, 1 - Math.exp(-dt * 9));
    look.a.lerp(target.a, k);
    look.b.lerp(target.b, k);
    look.bg.lerp(target.bg, k);
    if (look.a.equals(target.a) || Math.abs(look.a.r - target.a.r) < 0.002) look.a.copy(target.a);
    if (Math.abs(look.bg.r - target.bg.r) + Math.abs(look.bg.g - target.bg.g) + Math.abs(look.bg.b - target.bg.b) < 0.003) look.bg.copy(target.bg);
    misKick = reduced ? 0 : Math.max(0, misKick - dt / 0.3);
    music.step(dt);
    look.mis = 1 + 7 * Math.sin(misKick * Math.PI * 0.5);
    look.level = music.level;
    look.low = music.low;
    look.high = music.high;
    look.pulse = reduced ? 0 : music.pulse(now);
    const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1) * look.scale * quality;
    const want = `${window.innerWidth}x${window.innerHeight}@${ratio.toFixed(2)}`;
    if (want !== size) {
      size = want;
      scene.resize(window.innerWidth, window.innerHeight, ratio);
    }
    scene.draw(look, reduced ? 0 : t);
  }

  function tick(now: number) {
    raf = 0;
    if (stopped || document.hidden || screen === 'entrance') return;
    const moving = busy((now - t0) / 1000);
    const fps = isModuleOn('vision') ? CAMERA_FPS : MAX_FPS;
    if (!moving || frameDue(now, last, fps)) {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / fps;
      // judge the first 60 moving frames, whenever they come (the entrance can hold the scene back for minutes)
      if (last && moving && quality === 1 && gaps.length < 60) {
        gaps.push(now - last);
        if (tooSlow(gaps, 1000 / fps)) {
          quality = 0.5;
          retarget();
        }
      }
      last = now;
      try {
        draw(now, dt);
      } catch {
        return fail();
      }
    }
    if (busy((now - t0) / 1000)) raf = requestAnimationFrame(tick);
    else last = 0;
  }

  function wake() {
    if (!stopped && !raf && !document.hidden) raf = requestAnimationFrame(tick);
  }
  function fail() {
    if (stopped) return;
    stop();
    onFail();
  }
  const onResize = () => wake();
  const onVisibility = () => (document.hidden ? (cancelAnimationFrame(raf), (raf = 0)) : wake());
  const onReduced = () => {
    reduced = reducedQuery?.matches ?? false;
    retarget();
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    fail();
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  reducedQuery?.addEventListener?.('change', onReduced);
  canvas.addEventListener('webglcontextlost', onLost);

  function stop() {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    music.stop();
    stopCamera();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    reducedQuery?.removeEventListener?.('change', onReduced);
    canvas.removeEventListener('webglcontextlost', onLost);
    try {
      scene.dispose();
    } catch {
      // already gone
    }
  }

  retarget();
  return {
    stop,
    setLook(s, m) {
      if (s === 'mode' && screen === 'mode' && m !== mode) misKick = 1;
      screen = s;
      mode = m;
      retarget();
    },
    ripple(x, y) {
      rippleAt = (performance.now() - t0) / 1000;
      scene.ripple(x / Math.max(1, window.innerWidth), y / Math.max(1, window.innerHeight), rippleAt);
      wake();
    },
  };
}
