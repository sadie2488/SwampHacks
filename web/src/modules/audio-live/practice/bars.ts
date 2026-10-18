// Which bar is a moment in the song in? Bars are numbered from 1, exactly as the sheet music numbers them
// (the sheet's bar grid: every bar's worth of quarter notes from the sheet's beat 0, pickup notes included).
import type { Part, SongAnalysis } from '@/contracts';
import { barAt, barOfQuarter, barStartAt, sheetGrid, type SheetGrid } from '@/modules/sheet';

/** The part practice compares against (the same choice as `melodyOf`). */
function practicePart(a: SongAnalysis): Part | undefined {
  return a.parts.find((p) => p.kind === 'melody') ?? a.parts.find((p) => p.kind === 'vocals') ?? a.parts.find((p) => p.kind !== 'drums') ?? a.parts[0];
}

const grids = new WeakMap<SongAnalysis, SheetGrid>();
function gridOf(a: SongAnalysis): SheetGrid {
  let g = grids.get(a);
  if (!g) {
    g = sheetGrid(a, practicePart(a));
    grids.set(a, g);
  }
  return g;
}

const EPS = 1e-6;

/** The bar (from 1) that song time `t` falls in. A note of the song is placed by its beat, as on the sheet. */
export function barOf(a: SongAnalysis, t: number): number {
  const note = practicePart(a)?.notes.find((n) => Math.abs(n.onset_sec - t) < EPS && Number.isFinite(n.onset_beat));
  if (note) return barOfQuarter(a.time_signature, note.onset_beat as number);
  return barAt(gridOf(a), t);
}

/** Song time where a bar starts. */
export function barStartSec(a: SongAnalysis, bar: number): number {
  return barStartAt(gridOf(a), bar);
}

/** Song time where a bar ends (the start of the next bar, or the end of the song). */
export function barEndSec(a: SongAnalysis, bar: number): number {
  return Math.min(barStartSec(a, bar + 1), a.duration_sec > 0 ? a.duration_sec : Infinity);
}

/** "bar 5" or "bars 3-4". */
export function barsText(bars: [number, number]): string {
  return bars[0] === bars[1] ? `bar ${bars[0]}` : `bars ${bars[0]}-${bars[1]}`;
}
