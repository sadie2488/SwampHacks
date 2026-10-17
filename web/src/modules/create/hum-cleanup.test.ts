import { describe, expect, it } from 'vitest';
import { circularMedian, foldOctaves, isSlide, median, slopePerSecond, tunedPitches, type VoicedFrame } from './hum-cleanup';

const frames = (mids: number[], startMs = 0): VoicedFrame[] => mids.map((midi, i) => ({ t: startMs + i * 20, midi, conf: 0.9 }));
const octave = { maxMs: 120, gapMs: 60, frameMs: 20 };
const steady = (midi: number, n: number) => new Array<number>(n).fill(midi);

describe('foldOctaves', () => {
  it('folds a single frame that jumps up an octave', () => {
    const f = frames([...steady(60, 6), 72, ...steady(60, 6)]);
    expect(foldOctaves(f, octave)).toBe(1);
    expect(f.map((x) => x.midi)).toEqual(steady(60, 13));
  });

  it('folds a short run an octave down and a short run an octave up', () => {
    const down = frames([...steady(64, 6), ...steady(52, 4), ...steady(64, 6)]);
    foldOctaves(down, octave);
    expect(down.every((x) => x.midi === 64)).toBe(true);
    const up = frames([...steady(55, 6), ...steady(67, 5), ...steady(55, 6)]);
    foldOctaves(up, octave);
    expect(up.every((x) => x.midi === 55)).toBe(true);
  });

  it('folds two octaves too', () => {
    const f = frames([...steady(50, 6), ...steady(74, 3), ...steady(50, 6)]);
    foldOctaves(f, octave);
    expect(f.every((x) => x.midi === 50)).toBe(true);
  });

  it('allows a slightly out-of-tune error (11.4 semitones away)', () => {
    const f = frames([...steady(60, 6), ...steady(71.4, 3), ...steady(60.2, 6)]);
    foldOctaves(f, octave);
    expect(Math.max(...f.map((x) => x.midi))).toBeLessThan(60.5);
  });

  it('leaves a real octave leap alone: the notes on both sides are not on the same side', () => {
    const f = frames([...steady(60, 8), ...steady(72, 3)]); // jump at the end, nothing after
    expect(foldOctaves(f, octave)).toBe(0);
    const g = frames([...steady(60, 8), ...steady(72, 8)]);
    expect(foldOctaves(g, octave)).toBe(0);
    const h = frames([...steady(60, 8), ...steady(72, 3), ...steady(84, 8)]); // climbing in octaves
    expect(foldOctaves(h, octave)).toBe(0);
  });

  it('leaves a long run alone even when it sits an octave up between two equal notes', () => {
    const f = frames([...steady(60, 8), ...steady(72, 10), ...steady(60, 8)]);
    expect(foldOctaves(f, octave)).toBe(0);
    expect(Math.max(...f.map((x) => x.midi))).toBe(72);
  });

  it('does not fold across a real pause', () => {
    const before = frames(steady(60, 8));
    const mid = frames(steady(72, 3), 8 * 20 + 200);
    const after = frames(steady(60, 8), 8 * 20 + 200 + 60 + 200);
    expect(foldOctaves([...before, ...mid, ...after], octave)).toBe(0);
  });

  it('does not touch a slide or an ordinary leap that is not an octave', () => {
    const f = frames([...steady(60, 6), ...steady(67, 3), ...steady(60, 6)]);
    expect(foldOctaves(f, octave)).toBe(0);
  });
});

describe('median helpers', () => {
  it('median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('slopePerSecond is semitones per second', () => {
    const ts = [0, 20, 40, 60, 80];
    expect(slopePerSecond(ts, [60, 60.2, 60.4, 60.6, 60.8])).toBeCloseTo(10, 6);
    expect(slopePerSecond(ts, [60, 60, 60, 60, 60])).toBe(0);
    expect(slopePerSecond([0], [60])).toBe(0);
  });
});

describe('isSlide', () => {
  const ts = (n: number) => Array.from({ length: n }, (_, i) => i * 20);
  it('is true for a steady sweep and false for a steady note', () => {
    expect(isSlide(ts(8), [60, 60.4, 60.8, 61.2, 61.6, 62, 62.4, 62.8], 6, 0.6)).toBe(true);
    expect(isSlide(ts(8), steady(60, 8), 6, 0.6)).toBe(false);
  });

  it('is false for a note that is reached by a short slide and then settles', () => {
    expect(isSlide(ts(6), [61, 59.6, 59.1, 59, 59, 59], 6, 0.6)).toBe(false);
  });

  it('is false for a slow drift and for runs that are too short to tell', () => {
    expect(isSlide(ts(10), [60, 60.05, 60.1, 60.15, 60.2, 60.25, 60.3, 60.35, 60.4, 60.45], 6, 0.6)).toBe(false);
    expect(isSlide(ts(3), [60, 61, 62], 6, 0.6)).toBe(false);
  });
});

describe('circularMedian', () => {
  it('finds the middle of fractions that wrap around the half semitone', () => {
    // +0.45, -0.45 (= +0.55) and +0.5 are all close to each other on the circle
    const m = circularMedian([0.45, -0.45, 0.5]);
    expect(Math.abs(Math.abs(m) - 0.5)).toBeLessThan(0.1);
  });

  it('is not pulled by one odd value', () => {
    expect(circularMedian([-0.3, -0.28, -0.32, 0.2])).toBeCloseTo(-0.3, 1);
  });

  it('is 0 for nothing and the value itself for one value', () => {
    expect(circularMedian([])).toBe(0);
    expect(circularMedian([0.2])).toBeCloseTo(0.2, 9);
  });
});

describe('tunedPitches', () => {
  const opts = { recent: 6, warmup: 3, minNotes: 3 };
  const all = (n: number) => new Array<boolean>(n).fill(true);

  it('removes a steady flat habit', () => {
    const centers = [59.62, 62.65, 64.6, 59.7, 66.61, 67.64];
    expect(tunedPitches(centers, all(6), opts).pitches).toEqual([60, 63, 65, 60, 67, 68]);
  });

  it('follows a singer who creeps sharp', () => {
    const intended = [60, 62, 64, 65, 67, 69, 71, 72];
    const centers = intended.map((p, i) => p + 0.12 + (0.43 * i) / 7); // +12 cents growing to +55 cents
    expect(tunedPitches(centers, all(8), opts).pitches).toEqual(intended);
    expect(centers.map((c) => Math.round(c))).not.toEqual(intended); // plain rounding gets the last note wrong
  });

  it('does nothing for an in-tune singer', () => {
    const centers = [60.05, 62.1, 64.0, 65.08, 67.02];
    expect(tunedPitches(centers, all(5), opts).pitches).toEqual([60, 62, 64, 65, 67]);
  });

  it('keeps the offset within plus or minus 50 cents', () => {
    const { offsets } = tunedPitches([60.5, 62.5, 64.5, 65.5, 67.5, 69.5], all(6), opts);
    for (const o of offsets) expect(Math.abs(o)).toBeLessThanOrEqual(0.5);
  });

  it('does not correct anything with fewer than three notes', () => {
    expect(tunedPitches([60.3, 64.6], all(2), opts).pitches).toEqual([60, 65]);
    expect(tunedPitches([], [], opts).pitches).toEqual([]);
  });

  it('ignores notes that are not stable when learning the habit', () => {
    const centers = [59.7, 62.7, 64.7, 66.0, 67.7];
    const stable = [true, true, true, false, true];
    const { offsets } = tunedPitches(centers, stable, opts);
    expect(offsets[4]).toBeCloseTo(-0.3, 1);
  });
});
