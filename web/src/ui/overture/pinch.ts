// Pinch to click: the index fingertip touching the thumb tip clicks at once whatever the cursor was over on the frame
// before the pinch began (the hand's shape shifts as the fingers meet, so the pre-pinch position is the honest one).
// A fist is never a pinch, and a pinch during a fist grab does nothing. Pure logic, no DOM except popRing.
import type { Point } from './hand-pointer';

/** Thumb tip to index tip closer than this (in frame heights) starts a pinch... */
export const PINCH_ON = 0.045;
/** ...and it only ends once they part by more than this (hysteresis). */
export const PINCH_OFF = 0.07;
/** Two pinch clicks are never closer together than this (ms). */
export const PINCH_DEBOUNCE_MS = 400;
/** The cursor ring's pop on a pinch click (ms). */
export const PINCH_POP_MS = 120;

/** Distance between the thumb tip (4) and index tip (8) in frame heights, or null without a full hand. */
export function pinchGap(points: ReadonlyArray<Point>, aspect: number): number | null {
  if (points.length < 21) return null;
  const a = points[4];
  const b = points[8];
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

export interface PinchInput<T> {
  t: number;
  points: ReadonlyArray<Point>;
  /** Frame width over height, so x distances count in frame heights. */
  aspect: number;
  /** The fist latch for this hand: a fist is never a pinch. */
  fist: boolean;
  /** True while the fist machine holds something: a pinch then does nothing. */
  grabbed: boolean;
  /** What the cursor is over on this frame (becomes the candidate for the next frame's pinch). */
  target: T | null;
  /** false where hands mean music: nothing clicks. */
  enabled: boolean;
}

export interface PinchOutput<T> {
  pinched: boolean;
  /** Click this now (once per pinch, from the pre-pinch target). */
  click?: T;
}

/**
 * The pinch machine. Feed it every frame. A pinch fires one click as it starts, from the target of the previous frame;
 * holding the pinch never repeats; after release the next pinch fires only when PINCH_DEBOUNCE_MS has passed since the
 * last click. While the fist latch is on, a grab is held, or the cursor is disabled, the pinch is dropped and the
 * fingers must part (past PINCH_OFF) before a new one counts.
 */
export function createPinchMachine<T>() {
  let pinched = false;
  let armed = false;
  let lastClick = -Infinity;
  let prevTarget: T | null = null;
  return {
    get pinched(): boolean {
      return pinched;
    },
    reset(): void {
      pinched = false;
      armed = false;
      prevTarget = null;
    },
    update(i: PinchInput<T>): PinchOutput<T> {
      const before = prevTarget;
      prevTarget = i.target;
      const gap = pinchGap(i.points, i.aspect);
      if (gap === null || !i.enabled || i.fist || i.grabbed) {
        pinched = false;
        armed = false;
        return { pinched: false };
      }
      if (gap > PINCH_OFF) armed = true;
      const was = pinched;
      pinched = was ? gap < PINCH_OFF : gap < PINCH_ON;
      if (!pinched || was || !armed) return { pinched };
      armed = false;
      if (before === null || i.t - lastClick < PINCH_DEBOUNCE_MS) return { pinched };
      lastClick = i.t;
      return { pinched, click: before };
    },
  };
}

/** The cursor ring's quick pop on a pinch click: scale 1.25 -> 1 over PINCH_POP_MS, transform only. */
export function popRing(cursor: Element | null): void {
  const ring = cursor?.querySelector('.hand-pointer-ring');
  if (ring && typeof ring.animate === 'function') {
    ring.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: PINCH_POP_MS, easing: 'ease-out' });
  }
}
