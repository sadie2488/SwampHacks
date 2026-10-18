// Finds the song's bar starts (downbeats) as they go by, from the analysis (downbeats, or every 4th beat), the
// transport (where the song is) and the song levels (about 30 a second while it plays). Pure step function plus a
// small bus hook. Used for the two sync points inside a mode: the type slip on every downbeat, and the flower
// that opens on a strong downbeat (at most once per bar, so it never flickers with every drum hit).
import { useEffect, useState } from 'react';
import { bus, type SongLevels, type TransportState } from '@/bus';

/** The bar starts of a song, in song seconds. */
export function barStarts(analysis: { downbeats?: number[]; beats?: number[] } | undefined): number[] {
  if (analysis?.downbeats?.length) return analysis.downbeats;
  return (analysis?.beats ?? []).filter((_, i) => i % 4 === 0);
}

/** Did a bar start between two song positions (moving forward, no jump)? */
export function crossedBar(bars: number[], from: number, to: number): boolean {
  if (!(to > from) || to - from > 1) return false;
  return bars.some((b) => b > from && b <= to);
}

/** A beat is "strong" when it is clearly louder than the recent average, or the low drum band is hit hard. */
export function isStrong(levels: SongLevels, average: number): boolean {
  return levels.level > Math.max(0.12, average * 1.15) || (levels.bands[0] ?? 0) + (levels.bands[1] ?? 0) > 1.1;
}

export interface BeatCounts {
  /** Goes up on every bar start while the song plays. */
  bars: number;
  /** Goes up on bar starts that land on a strong beat. */
  blooms: number;
}

export function useBarBeats(): BeatCounts {
  const [counts, setCounts] = useState<BeatCounts>({ bars: 0, blooms: 0 });
  useEffect(() => {
    let transport: TransportState | undefined = bus.last('transport');
    let transportAt = performance.now();
    let bars = barStarts(bus.last('analysis'));
    let lastPos = -1;
    let average = 0;
    const offT = bus.on('transport', (t) => {
      transport = t;
      transportAt = performance.now();
    });
    const offA = bus.on('analysis', (a) => (bars = barStarts(a)));
    const offL = bus.on('songLevels', (lv) => {
      average += (lv.level - average) * 0.05;
      const t = transport;
      if (!t?.playing) {
        lastPos = -1;
        return;
      }
      const pos = t.positionSec + ((performance.now() - transportAt) / 1000) * (t.tempo || 1);
      if (lastPos >= 0 && crossedBar(bars, lastPos, pos)) {
        const strong = isStrong(lv, average);
        setCounts((c) => ({ bars: c.bars + 1, blooms: c.blooms + (strong ? 1 : 0) }));
      }
      lastPos = pos;
    });
    return () => {
      offT();
      offA();
      offL();
    };
  }, []);
  return counts;
}
