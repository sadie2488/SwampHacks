// Pure helpers for the hand cursor (HandPointer.tsx): which hand points, where on the screen, what it is over,
// and the hold-to-click / grab-to-scroll timing. No DOM here, so it is easy to test.
import type { Landmarks } from '@/bus';

/** How long a closed fist must stay still over a button to click it, in ms. Raise it if clicks happen by accident. */
export const HOLD_MS = 1000;
/** With nothing right under the cursor, a button whose hit area is this close (px) still counts (the magnet). */
export const MAGNET_PX = 48;
/**
 * The grab's dead zone (px): it only soaks up jitter. A grabbing fist that moves further than this from where it closed
 * drags at once (and that grab never clicks); one that stays inside it clicks after HOLD_MS.
 */
export const DRAG_PX = 12;
/** Each frame the cursor moves this share of the way to the hand: lower is steadier, higher is snappier. */
export const SMOOTH = 0.35;
/** Wheel distance sent per pixel the grabbing hand moves. */
export const WHEEL_SCALE = 2.5;
/** The smallest hit area a target gets (px), matching the CSS hit-area rule. */
export const MIN_HIT = 48;
/** What the hand can click. */
export const CLICKABLE = 'button, a[href], [role="button"], input, select, label, [data-hand-target]';

export type Side = 'left' | 'right';
export interface Point {
  x: number;
  y: number;
}
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The middle of the palm: the wrist and the four knuckles averaged (0-1 camera units). */
export function palmCentre(points: ReadonlyArray<Point>): Point | null {
  const ids = [0, 5, 9, 13, 17];
  if (points.length < 18) return null;
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += points[i].x;
    y += points[i].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

/** The hand raised highest (smallest y) points; returns its side and palm centre. */
export function pickHand(lm: Landmarks | null | undefined): (Point & { side: Side }) | null {
  let best: (Point & { side: Side }) | null = null;
  for (const h of lm?.hands ?? []) {
    const c = palmCentre(h.points);
    if (c && (!best || c.y < best.y)) best = { ...c, side: h.handedness === 'Left' ? 'left' : 'right' };
  }
  return best;
}

/** One step of the exponential filter. With no previous point it jumps straight there. */
export function smoothPoint(prev: Point | null, next: Point, k = SMOOTH): Point {
  if (!prev) return next;
  return { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k };
}

/** A box grown (round its middle) to at least `min` px each way. */
export function hitBox(b: Box, min = MIN_HIT): Box {
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  const hw = Math.max(b.right - b.left, min) / 2;
  const hh = Math.max(b.bottom - b.top, min) / 2;
  return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
}

/** Distance from a point to a box (0 inside). */
export function distToBox(p: Point, b: Box): number {
  const dx = Math.max(b.left - p.x, 0, p.x - b.right);
  const dy = Math.max(b.top - p.y, 0, p.y - b.bottom);
  return Math.hypot(dx, dy);
}

/** The closest item whose box is within `maxPx` of the point, or null. */
export function nearest<T>(p: Point, items: ReadonlyArray<{ item: T; box: Box }>, maxPx = MAGNET_PX): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const { item, box } of items) {
    const d = distToBox(p, box);
    if (d <= maxPx && d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}

export interface HoldInput<T> {
  t: number;
  x: number;
  y: number;
  fist: boolean;
  open: boolean;
  target: T | null;
  /** false where fists mean music (inside a mode with no panel open): nothing clicks or scrolls. */
  enabled: boolean;
}
export interface HoldOutput<T> {
  /** How full the ring is, 0 to 1. */
  progress: number;
  /** Click this now (sent once per hold). */
  click?: T;
  /** Scroll by this much now (a grab that moves). */
  wheel?: { dx: number; dy: number };
}

/**
 * Grab, drag, and hold-to-click. An open hand arms it; closing into a fist grabs the target under it at once (`held`).
 * A still fist (inside the DRAG_PX dead zone) fills the ring for `holdMs` and then clicks once. A fist that moves past
 * the dead zone drags from that frame on (wheel deltas follow the hand) and never clicks. Opening the hand releases;
 * the hand must open again before the next grab.
 */
export function createHoldMachine<T>(holdMs = HOLD_MS) {
  let ready = false;
  let phase: 'idle' | 'holding' | 'dragging' | 'done' = 'idle';
  let start = { x: 0, y: 0, t: 0 };
  let last = { x: 0, y: 0 };
  let target: T | null = null;

  return {
    get phase() {
      return phase;
    },
    /** True while the fist holds something: a hold over a target, a grab-scroll, or a fist still closed after a click. */
    get grabbed(): boolean {
      return phase === 'dragging' || phase === 'done' || (phase === 'holding' && target !== null);
    },
    /** The item the fist grabbed when it closed (null when nothing is held). */
    get held(): T | null {
      return phase === 'idle' ? null : target;
    },
    reset(): void {
      phase = 'idle';
      ready = false;
      target = null;
    },
    update(i: HoldInput<T>): HoldOutput<T> {
      if (i.open) ready = true;
      if (!i.enabled || !i.fist || i.open) {
        phase = 'idle';
        return { progress: 0 };
      }
      if (phase === 'idle') {
        if (!ready) return { progress: 0 };
        ready = false;
        phase = 'holding';
        start = { x: i.x, y: i.y, t: i.t };
        last = { x: i.x, y: i.y };
        target = i.target;
        return { progress: 0 };
      }
      if (phase === 'holding') {
        if (Math.hypot(i.x - start.x, i.y - start.y) > DRAG_PX) {
          phase = 'dragging';
          last = { x: start.x, y: start.y }; // the first scroll includes the movement that started it
        } else {
          last = { x: i.x, y: i.y };
          if (!target) return { progress: 0 };
          const progress = Math.min(1, (i.t - start.t) / holdMs);
          if (progress < 1) return { progress };
          phase = 'done';
          return { progress: 1, click: target };
        }
      }
      if (phase === 'dragging') {
        const dx = i.x - last.x;
        const dy = i.y - last.y;
        last = { x: i.x, y: i.y };
        // like dragging a page: move the hand up and the content moves up (scrolls down)
        return dx || dy ? { progress: 0, wheel: { dx: -dx * WHEEL_SCALE, dy: -dy * WHEEL_SCALE } } : { progress: 0 };
      }
      return { progress: 0 };
    },
  };
}

/** The cursor's ink on the menu when nothing is under it (the paper white). */
export const PAPER = '#f2eee6';

/** What the cursor reads off a hovered element to pick its colour (computed styles, already resolved). */
export interface ColorSource {
  /** An explicit `data-hand-color` attribute, if any. */
  data?: string | null;
  /** The border colour, only when the border is actually drawn. */
  border?: string | null;
  background?: string | null;
}

/** A CSS colour as rgba (0-255, alpha 0-1). Understands transparent, #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(); else null. */
export function parseColor(css: string | null | undefined): { r: number; g: number; b: number; a: number } | null {
  const c = (css ?? '').trim().toLowerCase();
  if (c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) {
    const [r, g, b] = m[1].split('').map((h) => parseInt(h + h, 16));
    return { r, g, b, a: 1 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(c);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  return null;
}

/** A colour worth showing on the cursor: mostly opaque and not near-black (it would vanish on the dark page). */
export function isVisibleInk(css: string | null | undefined): boolean {
  const c = parseColor(css);
  return !!c && c.a >= 0.5 && Math.max(c.r, c.g, c.b) > 48;
}

/** The cursor's colour over an element: its data-hand-color, else its border, else its background, else the fallback. */
export function pickHandColor(src: ColorSource | null, fallback: string): string {
  if (!src) return fallback;
  const data = src.data?.trim();
  if (data) return data;
  if (isVisibleInk(src.border)) return src.border as string;
  if (isVisibleInk(src.background)) return src.background as string;
  return fallback;
}

/**
 * Keeps the cursor's colour still while the fist holds something: the colour when the grab started stays until the
 * hand opens, even when a grab-scroll drags the cursor over other things.
 */
export function createInkLatch() {
  let locked: string | null = null;
  return (grabbed: boolean, live: string): string => {
    if (!grabbed) locked = null;
    else if (locked === null) locked = live;
    return locked ?? live;
  };
}
