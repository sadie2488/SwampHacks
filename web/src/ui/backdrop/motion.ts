// Small pure helpers for the paper landscape behind the page: when to draw it and how the beat moves it.
// Kept apart from three.js so they can be tested without a browser.

/** At most this many frames a second while the music plays (the scene sleeps when nothing changes). */
export const MAX_FPS = 30;
/** A little lower while the camera is on, so hand tracking keeps its share of the computer. */
export const CAMERA_FPS = 20;

/**
 * Should the page try to draw the 3D scene at all?
 * No when the address has ?scene=off, and no in the unit tests' pretend browser (jsdom), which has no WebGL.
 */
export function sceneWanted(search: string, userAgent: string): boolean {
  const value = new URLSearchParams(search).get('scene');
  if (value !== null && /^(off|0|false|no)$/i.test(value.trim())) return false;
  return !/jsdom/i.test(userAgent);
}

/** Where we are inside the current beat (0 to 1), moved forward from the last transport message by the time since. */
export function phaseNow(beatPhase: number, bpm: number, elapsedMs: number): number {
  if (!Number.isFinite(beatPhase)) return 0;
  const beats = Number.isFinite(bpm) && bpm > 0 && elapsedMs > 0 ? (elapsedMs / 1000) * (bpm / 60) : 0;
  const p = (beatPhase + beats) % 1;
  return p < 0 ? p + 1 : p;
}

/** A soft kick: 1 right on the beat, fading quickly to 0 before the next one. */
export function beatKick(phase: number): number {
  const p = Math.min(1, Math.max(0, phase));
  return (1 - p) ** 3;
}

/** True when enough time has passed since the last drawn frame for the given frame rate (with a little slack). */
export function frameDue(nowMs: number, lastMs: number, fps: number): boolean {
  return nowMs - lastMs >= 1000 / fps - 2;
}
