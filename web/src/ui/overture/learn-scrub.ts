// Drag the sheet while Learn is paused: sideways hand (or mouse) travel moves the song position. Pure maths, plus the
// list of wrong notes drawn in red during practice and the rule that clears them when the song is moved back.
import type { SongAnalysis } from '@/contracts';
import { quartersPerBar, sheetGrid } from '@/modules/sheet/bar-grid';

/** Hand travel (screen px) that moves the song by one bar. */
export const PX_PER_BAR = 180;

/** How long one bar lasts at 1.0x for this song (the sheet's own bar grid, so a bar here is a bar on the sheet). */
export function secondsPerBar(analysis: SongAnalysis | undefined): number {
  if (!analysis) return 2;
  const g = sheetGrid(analysis);
  return quartersPerBar(g.timeSignature) * g.secPerQuarter;
}

/** Song seconds for a drag: where it started plus the travel so far, clamped to the song. Right = forward. */
export function scrubPosition(startSec: number, travelPx: number, secPerBar: number, durationSec: number): number {
  const sec = startSec + (travelPx / PX_PER_BAR) * secPerBar;
  const max = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : Infinity;
  return Math.min(Math.max(sec, 0), max);
}

/** "0:07.3" for the little time label by the cursor. */
export function scrubLabel(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

/** Is this spot one where a grab scrubs? The lower half of the screen, or over the sheet band. */
export function isScrubSpot(y: number, viewportH: number, overSheet: boolean): boolean {
  return overSheet || y >= viewportH / 2;
}

// ---- wrong notes ----

export interface WrongNote {
  /** Song time (1.0x seconds) the note was played at. */
  sec: number;
  /** Concert-pitch MIDI played. */
  pitch: number;
}

/** Add a wrong note (kept in time order). */
export function addWrongNote(list: WrongNote[], n: WrongNote): WrongNote[] {
  const out = [...list, n];
  out.sort((a, b) => a.sec - b.sec);
  return out;
}

/**
 * Moving the song BACKWARD (a drag or Restart) and then playing again clears every red note at or after the new
 * position; moving forward keeps them all.
 */
export function clearFrom(list: WrongNote[], fromSec: number, previousSec: number): WrongNote[] {
  if (fromSec >= previousSec) return list;
  return list.filter((n) => n.sec < fromSec);
}
