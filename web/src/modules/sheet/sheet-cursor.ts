// Where the sheet cursor belongs for a playback position. Pure maths so it can be tested without drawing anything.
import type { SongAnalysis } from '@/contracts';

export interface CursorTiming {
  bpm: number;
  /** The time signature's bottom number: one beat is 1/denominator of a whole note. */
  denominator: number;
  /** Song time of the first beat, in seconds. The server counts note beats from here. */
  firstBeatSec: number;
}

export const DEFAULT_TIMING: CursorTiming = { bpm: 120, denominator: 4, firstBeatSec: 0 };

export function cursorTiming(analysis: SongAnalysis): CursorTiming {
  const first = analysis.beats?.[0];
  return {
    bpm: analysis.tempo_bpm > 0 ? analysis.tempo_bpm : 120,
    denominator: analysis.time_signature?.denominator ?? 4,
    firstBeatSec: typeof first === 'number' && Number.isFinite(first) && first > 0 ? first : 0,
  };
}

/** How far into the music (in whole notes) the song is at this playback position. */
export function wholeNotesAt(positionSec: number, t: CursorTiming): number {
  return (Math.max(0, positionSec - t.firstBeatSec) * t.bpm) / 60 / t.denominator;
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
