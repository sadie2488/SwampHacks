// Keeping every layer in time on the loop clock (Tone's transport). Pure maths, no Tone, so it can be tested.
// The loop clock counts bars from 1 at the top of the loop (bar 0 is the count-in). Each layer remembers the bar
// its take started on (its anchor) and repeats every `loopBeats` from there. A layer built late (a take that just
// ended, a tempo change) joins its loop part-way instead of waiting for its next top, so it is heard exactly over
// what was playing while it was hummed and never slips a bar against the other layers.
import { BEATS_PER_BAR } from './music';

/** The bar the loop starts on when the clock starts from the top. */
export const LOOP_TOP_BAR = 1;

/** Remainder that is never negative, so bars before the anchor still land inside the loop. */
const mod = (a: number, m: number) => ((a % m) + m) % m;

export const barToTicks = (bar: number, ppq: number): number => Math.round(bar * BEATS_PER_BAR * ppq);

export interface PartStart {
  /** Clock tick at which the part starts sounding. */
  startTicks: number;
  /** How far into its own loop the part is at `startTicks`. */
  offsetTicks: number;
}

/**
 * When a layer's part starts and from where in its loop, so its loop top always falls on
 * `anchorTicks + k * loopTicks`.
 * - clock stopped: it will start from the loop top (`topTicks`), so the part starts there.
 * - clock running: the part starts as soon as it can safely be scheduled (`nowTicks + marginTicks`).
 */
export function partStart(o: { anchorTicks: number; loopTicks: number; topTicks: number; running: boolean; nowTicks: number; marginTicks: number }): PartStart {
  const startTicks = Math.ceil(o.running ? o.nowTicks + o.marginTicks : o.topTicks);
  return { startTicks, offsetTicks: mod(startTicks - o.anchorTicks, o.loopTicks) };
}

/** Where a part is inside its own loop at clock tick `t` (for tests and checks). */
export function loopPositionAt(t: number, start: PartStart, loopTicks: number): number {
  return mod(t - start.startTicks + start.offsetTicks, loopTicks);
}

/**
 * Loop length for a take ended early (left-fist gesture or Record pressed again).
 * Choice: whole bars, never less than one, so the layer stays on the same bar grid as every other layer.
 * The time is first rounded to whole beats. A take that ran at most one beat past a bar line ends at that bar line
 * (the press came a little late); anything longer keeps its last, part-filled bar so no hummed note is cut.
 */
export function earlyTakeLoopBeats(elapsedMs: number, bpm: number): number {
  const beats = Math.round((Math.max(0, elapsedMs) * bpm) / 60000);
  const bars = Math.max(1, Math.ceil((beats - 1) / BEATS_PER_BAR));
  return bars * BEATS_PER_BAR;
}
