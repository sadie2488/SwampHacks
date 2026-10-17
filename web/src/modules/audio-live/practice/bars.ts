// Which bar is a moment in the song in? Bars are numbered from 1.
import type { SongAnalysis } from '@/contracts';

/** Beats in one bar. 6/8, 9/8 and 12/8 are felt in 2, 3 and 4 beats of three eighths each. */
export function beatsPerBar(ts: SongAnalysis['time_signature']): number {
  const compound = ts.denominator === 8 && ts.numerator >= 6 && ts.numerator % 3 === 0;
  return Math.max(1, compound ? ts.numerator / 3 : ts.numerator);
}

const EPS = 1e-6;

/** The bar (from 1) that song time `t` falls in. Uses the downbeats if the analysis has them, else the beats, else the tempo. */
export function barOf(a: SongAnalysis, t: number): number {
  if (a.downbeats && a.downbeats.length > 0) return Math.max(1, a.downbeats.filter((d) => d <= t + EPS).length);
  const per = beatsPerBar(a.time_signature);
  if (a.beats && a.beats.length > 0) {
    const beatNo = a.beats.filter((b) => b <= t + EPS).length; // 1-based number of the latest beat
    return Math.floor(Math.max(0, beatNo - 1) / per) + 1;
  }
  const barSec = (per * 60) / Math.max(1, a.tempo_bpm);
  return Math.floor(Math.max(0, t) / barSec + EPS) + 1;
}

/** Song time where a bar starts. */
export function barStartSec(a: SongAnalysis, bar: number): number {
  if (a.downbeats && a.downbeats[bar - 1] !== undefined) return a.downbeats[bar - 1];
  const per = beatsPerBar(a.time_signature);
  if (a.beats && a.beats[(bar - 1) * per] !== undefined) return a.beats[(bar - 1) * per];
  return (bar - 1) * ((per * 60) / Math.max(1, a.tempo_bpm));
}

/** Song time where a bar ends (the start of the next bar, or the end of the song). */
export function barEndSec(a: SongAnalysis, bar: number): number {
  return Math.min(barStartSec(a, bar + 1), a.duration_sec > 0 ? a.duration_sec : Infinity);
}

/** "bar 5" or "bars 3-4". */
export function barsText(bars: [number, number]): string {
  return bars[0] === bars[1] ? `bar ${bars[0]}` : `bars ${bars[0]}-${bars[1]}`;
}
