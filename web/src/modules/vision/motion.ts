// The two moving fingerspelling letters. J: the little finger (I shape) draws a hook: down, then curving toward the thumb.
// Z: the index finger draws a Z: across, diagonally back and down, across again.
// Positions are kept in a small ring buffer (no memory allocated per frame), x mirrored for a left hand so both hands
// look like a right hand, in picture-height units. Pure code.

/** About 1.6 s of fingertip positions at 15 frames a second. */
export const TRAIL_LEN = 24;

export class Trail {
  private readonly t = new Float64Array(TRAIL_LEN);
  private readonly x = new Float64Array(TRAIL_LEN);
  private readonly y = new Float64Array(TRAIL_LEN);
  private head = 0;
  length = 0;

  push(t: number, x: number, y: number): void {
    this.t[this.head] = t;
    this.x[this.head] = x;
    this.y[this.head] = y;
    this.head = (this.head + 1) % TRAIL_LEN;
    if (this.length < TRAIL_LEN) this.length++;
  }
  clear(): void {
    this.length = 0;
  }
  private at(i: number): number {
    return (this.head - this.length + i + TRAIL_LEN) % TRAIL_LEN;
  }
  /** i = 0 is the oldest kept sample. */
  xAt = (i: number): number => this.x[this.at(i)];
  yAt = (i: number): number => this.y[this.at(i)];
  tAt = (i: number): number => this.t[this.at(i)];
}

/** Sizes are in hand sizes (wrist to middle knuckle). */
export const MOTION = {
  /** J: the little finger drops at least this far... */
  jDrop: 0.35,
  /** ...and ends at least this far toward the thumb side of where it started. */
  jHook: 0.25,
  /** Z: each across stroke is at least this long, the diagonal goes down at least this far. */
  zStroke: 0.4,
  zDrop: 0.3,
  /** Wiggles smaller than this don't count as changing direction. */
  turn: 0.15,
  /** The move has to take at least this long (a single jump is a tracking glitch). */
  minMs: 250,
} as const;

export function detectJ(tr: Trail, handSize: number): boolean {
  const n = tr.length;
  if (n < 4 || handSize <= 0 || tr.tAt(n - 1) - tr.tAt(0) < MOTION.minMs) return false;
  let low = 0;
  for (let i = 1; i < n; i++) if (tr.yAt(i) > tr.yAt(low)) low = i;
  if (low === 0) return false;
  // The highest point before the low one is where the stroke began.
  let top = 0;
  for (let i = 1; i < low; i++) if (tr.yAt(i) < tr.yAt(top)) top = i;
  const drop = (tr.yAt(low) - tr.yAt(top)) / handSize;
  const hook = (tr.xAt(top) - tr.xAt(n - 1)) / handSize;
  return drop >= MOTION.jDrop && hook >= MOTION.jHook && tr.xAt(n - 1) < tr.xAt(low);
}

// Turning points of the x path (reused between calls).
const TP_MAX = 12;
const tpX = new Float64Array(TP_MAX);
const tpY = new Float64Array(TP_MAX);

export function detectZ(tr: Trail, handSize: number): boolean {
  const n = tr.length;
  if (n < 5 || handSize <= 0 || tr.tAt(n - 1) - tr.tAt(0) < MOTION.minMs) return false;
  const turn = MOTION.turn * handSize;
  let k = 0;
  tpX[0] = tr.xAt(0);
  tpY[0] = tr.yAt(0);
  // extreme of the current run, and its direction (+1 right, -1 left, 0 not yet moving)
  let ex = tpX[0];
  let ey = tpY[0];
  let dir = 0;
  for (let i = 1; i < n; i++) {
    const x = tr.xAt(i);
    const y = tr.yAt(i);
    if (dir === 0) {
      if (Math.abs(x - ex) > turn) dir = x > ex ? 1 : -1;
      else continue;
    }
    if ((x - ex) * dir >= 0) {
      ex = x;
      ey = y;
    } else if ((ex - x) * dir > turn && k < TP_MAX - 2) {
      k++;
      tpX[k] = ex;
      tpY[k] = ey;
      dir = -dir;
      ex = x;
      ey = y;
    }
  }
  k++;
  tpX[k] = ex;
  tpY[k] = ey;
  // Look for right, back-left-and-down, right among any four turning points in a row.
  const s = MOTION.zStroke * handSize;
  for (let i = 0; i + 3 <= k; i++) {
    const a1 = tpX[i + 1] - tpX[i];
    const diag = tpX[i + 1] - tpX[i + 2];
    const a2 = tpX[i + 3] - tpX[i + 2];
    const drop = tpY[i + 2] - tpY[i + 1];
    const flat1 = Math.abs(tpY[i + 1] - tpY[i]) < 0.6 * a1;
    const flat2 = Math.abs(tpY[i + 3] - tpY[i + 2]) < 0.6 * a2;
    if (a1 >= s && diag >= 0.75 * s && a2 >= s && drop >= MOTION.zDrop * handSize && flat1 && flat2) return true;
  }
  return false;
}
