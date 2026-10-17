// Small number helpers for the practice code.

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The median of the distances from the median: a spread that ignores stray values. */
export function medianAbsDeviation(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

export interface Line {
  slope: number;
  intercept: number;
}

/**
 * A straight line y = intercept + slope * x through the points, using the median of all pairwise slopes (Theil-Sen),
 * so a few wild points do not tilt it. Returns null with fewer than 3 usable points.
 */
export function robustLine(xs: number[], ys: number[]): Line | null {
  let px = xs;
  let py = ys;
  if (xs.length > 200) {
    const keep = Array.from({ length: 200 }, (_, k) => Math.floor((k * (xs.length - 1)) / 199));
    px = keep.map((i) => xs[i]);
    py = keep.map((i) => ys[i]);
  }
  if (px.length < 3) return null;
  const slopes: number[] = [];
  for (let i = 0; i < px.length; i++) for (let j = i + 1; j < px.length; j++) if (Math.abs(px[j] - px[i]) > 1e-6) slopes.push((py[j] - py[i]) / (px[j] - px[i]));
  if (slopes.length === 0) return null;
  const slope = median(slopes);
  return { slope, intercept: median(px.map((x, i) => py[i] - slope * x)) };
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Note letter for a MIDI number, e.g. 67 -> "G", 66 -> "F#". */
export function noteLetter(midi: number): string {
  return NAMES[((Math.round(midi) % 12) + 12) % 12];
}

/** Distance between two pitches in cents, folded to the nearest octave (so humming an octave lower is still "in tune"). */
export function foldedCents(playedMidi: number, expectedMidi: number): number {
  const c = (playedMidi - expectedMidi) * 100;
  return ((((c + 600) % 1200) + 1200) % 1200) - 600;
}

export const roundTo = (x: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
};
