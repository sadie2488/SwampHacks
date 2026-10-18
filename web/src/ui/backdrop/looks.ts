// How the background looks on each screen (numbers from the Overture mockup's CONFIG). Pure, so it can be tested.
// Menu: the camera steps back (dark, nearly colourless, soft focus from drawing at low resolution).
// Mode: the camera is clear with a light print texture tinted by the mode's inks.
// No camera: a slow, faint print field instead, so the page still breathes with the music.

export type ScreenName = 'entrance' | 'menu' | 'mode';

export interface LookNumbers {
  effect: number;
  ink: number;
  sat: number;
  tint: number;
  dim: number;
  vignette: number;
  grain: number;
  /** Share of the full drawing resolution (the menu draws small, which also softens the camera picture). */
  scale: number;
}

export function targetLook(screen: ScreenName, hasCamera: boolean): LookNumbers {
  if (screen === 'menu') {
    return hasCamera
      ? { effect: 0, ink: 1, sat: 0.12, tint: 0.1, dim: 0.42, vignette: 1.9, grain: 0.05, scale: 0.4 }
      : { effect: 0.5, ink: 0.16, sat: 0, tint: 0, dim: 1, vignette: 1.6, grain: 0.04, scale: 0.6 };
  }
  return hasCamera
    ? { effect: 0.25, ink: 1, sat: 0.6, tint: 0.3, dim: 0.8, vignette: 0.6, grain: 0.04, scale: 1 }
    : { effect: 0.6, ink: 0.32, sat: 0, tint: 0, dim: 1, vignette: 0.9, grain: 0.035, scale: 1 };
}

/** The section's inks and dark background tint (color-scheme.md and the style review). */
export const SECTION_COLOURS: Record<string, { a: string; b: string; bg: string }> = {
  intro: { a: '#ff2d8a', b: '#f4e4a1', bg: '#0b0a0c' },
  learn: { a: '#1fb3bf', b: '#ff4a3d', bg: '#08161a' },
  play: { a: '#ff7a00', b: '#ff2d8a', bg: '#170c06' },
  create: { a: '#c9a8ff', b: '#ff4fa3', bg: '#120d1a' },
  lab: { a: '#2f5bff', b: '#ff9a1f', bg: '#070b1c' },
};

/** The menu and the entrance sit on Night; inside a mode, the section's own tint. */
export function sectionColours(screen: ScreenName, mode: string): { a: string; b: string; bg: string } {
  const c = SECTION_COLOURS[mode] ?? SECTION_COLOURS.learn;
  return screen === 'mode' ? c : { ...c, bg: '#0b0a0c' };
}

/** Move `from` toward `to` by a share that depends on the time passed, so it settles in about `settle` seconds. */
export function ease(from: number, to: number, dt: number, settle = 0.5): number {
  const k = 1 - Math.exp((-dt * 4.6) / Math.max(0.01, settle));
  return from + (to - from) * Math.min(1, Math.max(0, k));
}

/** True when the frames so far were too slow: drop to the cheaper quality (half resolution, no grain). */
export function tooSlow(frameGapsMs: number[], budgetMs: number): boolean {
  if (frameGapsMs.length < 20) return false;
  const sorted = [...frameGapsMs].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] > budgetMs * 1.5;
}
