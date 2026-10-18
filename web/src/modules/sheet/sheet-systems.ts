// Whole systems (lines of music) on the sheet band: where each starts, how tall a band of N whole systems is, and
// which system top to turn the page to. The maths is pure; reading the positions out of OpenSheetMusicDisplay is here too.
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/** OSMD draws in units of 10 px times its zoom. */
const UNIT_PX = 10;

/** The top edge of every system in px inside the drawn sheet, in order (empty when nothing is drawn). */
export function systemTopsOf(osmd: OpenSheetMusicDisplay): number[] {
  try {
    const unit = UNIT_PX * (osmd.Zoom || 1);
    const tops: number[] = [];
    for (const page of osmd.GraphicSheet?.MusicPages ?? []) {
      for (const system of page.MusicSystems ?? []) tops.push(system.PositionAndShape.AbsolutePosition.y * unit);
    }
    return tops;
  } catch {
    return [];
  }
}

/**
 * The height (px) that shows the most whole systems inside `available` px: the top of the first system that no longer
 * fits. Always at least one system (even when it is taller than the room). Null when there are fewer than two systems
 * or the positions are unusable, so the band keeps its own size.
 */
export function fitWholeSystems(tops: number[], available: number): number | null {
  if (tops.length < 2 || !Number.isFinite(available) || available <= 0) return null;
  // the sheet's own top margin above system 1 is part of the first "page"
  let height = tops[1];
  for (let i = 2; i < tops.length; i++) {
    if (tops[i] <= available) height = tops[i];
    else break;
  }
  return Math.round(height);
}

/** The top of the system that contains a y position (px), to scroll a page to; null when no systems are known. */
export function systemTopFor(tops: number[], y: number): number | null {
  if (tops.length === 0) return null;
  let top = 0;
  for (const t of tops) if (t <= y + 1) top = t;
  return top;
}
