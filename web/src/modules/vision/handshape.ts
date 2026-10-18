// Hand shapes: how many fingers are up, and which ASL fingerspelling letter a hand shows. Pure code (no browser, no bus).
//
// Everything is measured in a frame fixed to the hand, so it works whichever way the hand is turned:
//   x = across the palm toward the little finger, y = from the wrist toward the middle knuckle, z = out of the palm's front.
// Lengths are in "hand sizes" (wrist to middle knuckle). A left hand is mirrored first, so it measures like a right hand.
// No memory is allocated per call: results land in the reused arrays of a HandShape.
import { HAND, type Pt } from './gestures';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 0 at or below a, 1 at or above b, a straight ramp between. */
export const rise = (v: number, a: number, b: number): number => clamp01((v - a) / (b - a));
/** 1 at or below a, 0 at or above b. */
export const fall = (v: number, a: number, b: number): number => 1 - rise(v, a, b);
const DEG = 180 / Math.PI;

/** [knuckle (MCP), middle joint (PIP), end joint (DIP), tip] for index, middle, ring, pinky. */
const FINGER_JOINTS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
] as const;

export class HandShape {
  /** The 21 points in the hand frame: x, y, z for each. */
  readonly p = new Float64Array(63);
  /** Per finger (index..pinky): bend in degrees at the knuckle, middle joint and end joint. */
  readonly flex = new Float64Array(12);
  /** Per finger, 0-1: straight, curled into the palm (fist), hooked (knuckle straight, tip bent down, like X), half bent (like C). */
  readonly straight = new Float64Array(4);
  readonly curled = new Float64Array(4);
  readonly hooked = new Float64Array(4);
  readonly bent = new Float64Array(4);
  /** 0-1: the thumb sticks out clearly away from the palm and the index finger. */
  thumbOut = 0;
  /** Index-middle spread in degrees (positive = apart like V, around 0 = together like U). */
  spreadIM = 0;
  /** How far the index tip has crossed over to the little-finger side of the middle tip (positive = crossed, like R). */
  crossIM = 0;
  /** Which way the fingers point on screen, 0-1 each. */
  up = 0;
  side = 0;
  down = 0;
  /** Picture position of the hand (camera units, mirrored for a left hand) and its size, for the motion letters. */
  size = 0;

  private readonly ax = new Float64Array(9);

  /** Measures one hand. `mirror` = true for a left hand. Returns false for a degenerate hand (zero size). */
  measure(pts: Pt[], aspect: number, mirror: boolean): boolean {
    const sx = mirror ? -aspect : aspect;
    const w = pts[HAND.WRIST];
    const wz = w.z ?? 0;
    const cx = (k: number) => (pts[k].x - w.x) * sx;
    const cy = (k: number) => pts[k].y - w.y;
    const cz = (k: number) => ((pts[k].z ?? 0) - wz) * aspect;
    const a = this.ax;
    // y axis: wrist -> middle knuckle
    let yx = cx(HAND.MIDDLE_MCP), yy = cy(HAND.MIDDLE_MCP), yz = cz(HAND.MIDDLE_MCP);
    const hs = Math.hypot(yx, yy, yz);
    if (!(hs > 1e-6)) return false;
    yx /= hs; yy /= hs; yz /= hs;
    // x axis: index knuckle -> little-finger knuckle, made square to y
    let xx = cx(HAND.PINKY_MCP) - cx(HAND.INDEX_MCP), xy = cy(HAND.PINKY_MCP) - cy(HAND.INDEX_MCP), xz = cz(HAND.PINKY_MCP) - cz(HAND.INDEX_MCP);
    const d = xx * yx + xy * yy + xz * yz;
    xx -= d * yx; xy -= d * yy; xz -= d * yz;
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    // z axis = x cross y: out of the palm's front
    a[0] = xx; a[1] = xy; a[2] = xz; a[3] = yx; a[4] = yy; a[5] = yz;
    a[6] = xy * yz - xz * yy; a[7] = xz * yx - xx * yz; a[8] = xx * yy - xy * yx;
    for (let k = 0; k < 21; k++) {
      const vx = cx(k), vy = cy(k), vz = cz(k);
      for (let j = 0; j < 3; j++) this.p[3 * k + j] = (vx * a[3 * j] + vy * a[3 * j + 1] + vz * a[3 * j + 2]) / hs;
    }
    this.size = hs;
    this.up = rise(-yy, 0.2, 0.5);
    this.down = rise(yy, 0.2, 0.5);
    this.side = rise(Math.abs(yx) - Math.abs(yy), -0.1, 0.2);
    this.measureFingers();
    this.measureThumb();
    return true;
  }

  /** Distance between two points of the hand, in hand sizes. */
  dist(i: number, j: number): number {
    const p = this.p;
    return Math.hypot(p[3 * i] - p[3 * j], p[3 * i + 1] - p[3 * j + 1], p[3 * i + 2] - p[3 * j + 2]);
  }

  /** Angle in degrees between bone a->b and bone b->c. */
  private bend(a: number, b: number, c: number): number {
    const p = this.p;
    const ux = p[3 * b] - p[3 * a], uy = p[3 * b + 1] - p[3 * a + 1], uz = p[3 * b + 2] - p[3 * a + 2];
    const vx = p[3 * c] - p[3 * b], vy = p[3 * c + 1] - p[3 * b + 1], vz = p[3 * c + 2] - p[3 * b + 2];
    const n = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
    return n > 0 ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / n))) * DEG : 0;
  }

  private measureFingers(): void {
    const p = this.p;
    for (let f = 0; f < 4; f++) {
      const [m, pip, dip, tip] = FINGER_JOINTS[f];
      // Knuckle bend: how far the first bone tips out of the palm plane toward the front (signed, so bending back is < 0).
      const mcp = Math.atan2(p[3 * pip + 2] - p[3 * m + 2], p[3 * pip + 1] - p[3 * m + 1]) * DEG;
      const b1 = this.bend(m, pip, dip);
      const b2 = this.bend(pip, dip, tip);
      this.flex[3 * f] = mcp;
      this.flex[3 * f + 1] = b1;
      this.flex[3 * f + 2] = b2;
      const total = mcp + b1 + b2;
      this.straight[f] = fall(b1 + b2, 45, 80) * fall(mcp, 40, 65);
      this.curled[f] = rise(mcp, 45, 70) * rise(b1, 55, 80);
      this.hooked[f] = fall(mcp, 35, 55) * rise(b1 + b2, 110, 140);
      this.bent[f] = rise(total, 55, 80) * fall(total, 165, 195);
    }
    const angXY = (from: number, to: number) => Math.atan2(p[3 * to] - p[3 * from], p[3 * to + 1] - p[3 * from + 1]) * DEG;
    this.spreadIM = angXY(9, 12) - angXY(5, 8);
    this.crossIM = p[3 * 8] - p[3 * 12];
  }

  private measureThumb(): void {
    const tx = this.p[3 * HAND.THUMB_TIP];
    this.thumbOut = rise(-tx, 0.55, 0.75) * rise(this.dist(HAND.THUMB_TIP, HAND.INDEX_MCP), 0.45, 0.6);
  }

  /** Raised fingers, 0-5. The thumb counts only when it clearly sticks out. */
  fingerCount(): number {
    let n = this.thumbOut > 0.5 ? 1 : 0;
    for (let f = 0; f < 4; f++) if (this.straight[f] > 0.5) n++;
    return n;
  }
}
