// Where the sheet cursor belongs for a playback position. Pure maths so it can be tested without drawing anything.
import type { Part, SongAnalysis } from '@/contracts';
import { quarterAt, sheetGrid, type SheetGrid } from './bar-grid';

/** Where quarter note 0 of the sheet is in song time, and how long a quarter note lasts (see bar-grid.ts). */
export type CursorTiming = SheetGrid;

export const DEFAULT_TIMING: CursorTiming = { startSec: 0, secPerQuarter: 0.5, timeSignature: undefined };

/** Cursor timing for the part on screen: the sheet counts its quarter notes from the same start. */
export function cursorTiming(analysis: SongAnalysis, part?: Pick<Part, 'notes'>): CursorTiming {
  return sheetGrid(analysis, part);
}

/** How far into the music (in whole notes) the song is at this playback position. */
export function wholeNotesAt(positionSec: number, t: CursorTiming): number {
  return Math.max(0, quarterAt(t, positionSec)) / 4;
}

/** The last cursor step at or before `whole` (steps are sorted, in whole notes). 0 when none is reached yet. */
export function stepAt(times: number[], whole: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= whole + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
