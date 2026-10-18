// Pure helpers for the guide drawing: the hand as dots, the head as its outline with an eye line.
// Points come from the vision module (already mirrored, 0-1 across the camera picture), which matches the background:
// it shows the camera mirrored too (selfie view), "covering" the window, so only the same crop is applied here.
import type { Landmarks } from '@/bus';

export type Pt = [number, number];

/** Map a 0-1 camera point to window pixels, with the background's cover crop. */
export function toScreen(x: number, y: number, camAspect: number, w: number, h: number): Pt {
  const s = w / h / (camAspect > 0 ? camAspect : 16 / 9);
  const fx = s > 1 ? x : (x - 0.5) / s + 0.5;
  const fy = s > 1 ? (y - 0.5) * s + 0.5 : y;
  return [fx * w, fy * h];
}

/** The standard 21-point hand: which points are joined by a bone. */
export const BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** Small dots spaced along each bone (every `gap` pixels), not counting the joints themselves. */
export function boneDots(pts: Pt[], gap = 9): Pt[] {
  const out: Pt[] = [];
  for (const [a, b] of BONES) {
    const p = pts[a];
    const q = pts[b];
    if (!p || !q) continue;
    const n = Math.max(1, Math.floor(Math.hypot(q[0] - p[0], q[1] - p[1]) / gap));
    for (let k = 1; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  return out;
}

/** The outline round a set of points (convex hull, counter-clockwise). */
export function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The eye (tilt) line: through both eyes, stopping where it meets the outline on each side. */
export function eyeLine(left: Pt, right: Pt, outline: Pt[]): [Pt, Pt] | null {
  const dl = Math.hypot(right[0] - left[0], right[1] - left[1]);
  if (!dl || outline.length < 3) return null;
  const ux = (right[0] - left[0]) / dl;
  const uy = (right[1] - left[1]) / dl;
  const mx = (left[0] + right[0]) / 2;
  const my = (left[1] + right[1]) / 2;
  let lo = 0;
  let hi = 0;
  for (const q of outline) {
    const along = (q[0] - mx) * ux + (q[1] - my) * uy;
    const off = Math.abs(-(q[0] - mx) * uy + (q[1] - my) * ux);
    if (off < dl * 0.6) {
      lo = Math.min(lo, along);
      hi = Math.max(hi, along);
    }
  }
  return [[mx + ux * lo, my + uy * lo], [mx + ux * hi, my + uy * hi]];
}

/** What is in view right now. */
export function seenParts(lm: Landmarks | null | undefined): Set<'hand' | 'head'> {
  const seen = new Set<'hand' | 'head'>();
  if (lm?.hands.some((h) => h.points.length >= 21)) seen.add('hand');
  if ((lm?.face?.points.length ?? 0) > 263) seen.add('head');
  return seen;
}
