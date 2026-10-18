import { describe, expect, it } from 'vitest';
import { ATTACK_MS, BAND_COUNT, BAND_EDGES_HZ, LevelMeter, RELEASE_MS, bandBinRanges, bandsFromBytes, fakeBands, levelFromSamples } from './levels';

const ranges = (sr: number, bins: number) => {
  const r = bandBinRanges(sr, bins);
  return Array.from({ length: BAND_COUNT }, (_, b) => [r[b * 2], r[b * 2 + 1]] as const);
};

describe('band edges', () => {
  it.each([
    [48000, 1024],
    [44100, 1024],
    [48000, 512],
    [44100, 512],
  ])('at %i Hz with %i bins, every bin lands in the right band and the bands touch', (sr, bins) => {
    const binHz = sr / 2 / bins;
    const r = ranges(sr, bins);
    r.forEach(([start, end], b) => {
      expect(end).toBeGreaterThan(start);
      for (let k = start; k < end; k++) {
        expect(k * binHz).toBeGreaterThanOrEqual(BAND_EDGES_HZ[b]);
        expect(k * binHz).toBeLessThan(BAND_EDGES_HZ[b + 1]);
      }
      if (b > 0) expect(start).toBe(r[b - 1][1]);
    });
  });

  it('48 kHz, fftSize 2048: 20-60 Hz is bins 1-2, 400-1000 Hz is bins 18-42, 12-20 kHz ends at bin 853', () => {
    const r = ranges(48000, 1024);
    expect(r[0]).toEqual([1, 3]);
    expect(r[3]).toEqual([18, 43]);
    expect(r[7]).toEqual([512, 854]);
  });

  it('a band too narrow for a bin still gets the nearest one; a band above the top frequency gets none', () => {
    const coarse = ranges(48000, 128); // 187.5 Hz per bin
    expect(coarse[0][1] - coarse[0][0]).toBe(1);
    const low = ranges(16000, 1024); // the top is 8 kHz, so 12-20 kHz cannot be measured
    expect(low[7][0]).toBe(low[7][1]);
  });
});

describe('bandsFromBytes', () => {
  it('a loud spot in one band lights only that band; an empty band reads 0', () => {
    const bins = 1024;
    const r = bandBinRanges(48000, bins);
    const bytes = new Uint8Array(bins);
    for (let k = r[4]; k < r[5]; k++) bytes[k] = 255; // all of band 2 (150-400 Hz)
    const out = new Float32Array(BAND_COUNT);
    bandsFromBytes(bytes, r, out);
    expect(Array.from(out)).toEqual([0, 0, 1, 0, 0, 0, 0, 0]);
    bandsFromBytes(new Uint8Array(bins), bandBinRanges(16000, bins), out);
    expect(out[7]).toBe(0);
  });
});

describe('levelFromSamples', () => {
  const sine = (amp: number) => Float32Array.from({ length: 2048 }, (_, i) => amp * Math.sin((i * 2 * Math.PI * 440) / 48000));
  it('silence is 0, a full-scale sine is near 1, a very quiet sine is near 0', () => {
    expect(levelFromSamples(new Float32Array(2048))).toBe(0);
    expect(levelFromSamples(sine(1))).toBeGreaterThan(0.9);
    expect(levelFromSamples(sine(0.001))).toBe(0);
    const half = levelFromSamples(sine(0.03));
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.6);
  });
});

describe('LevelMeter smoothing', () => {
  const ones = new Array(BAND_COUNT).fill(1);
  const zeros = new Array(BAND_COUNT).fill(0);

  it('rises fast and falls slowly', () => {
    const m = new LevelMeter();
    m.push(ones, 1, 33);
    const risen = m.bands[0];
    expect(risen).toBeCloseTo(1 - Math.exp(-33 / ATTACK_MS), 5);
    expect(m.level).toBeCloseTo(risen, 5);
    for (let i = 0; i < 10; i++) m.push(ones, 1, 33);
    expect(m.bands[0]).toBeGreaterThan(0.99);
    m.push(zeros, 0, 33);
    const fell = 1 - m.bands[0];
    expect(fell).toBeCloseTo(1 - Math.exp(-33 / RELEASE_MS), 2);
    expect(fell).toBeLessThan(risen / 4);
  });

  it('stays inside 0..1 even with bad readings, and reset goes back to 0', () => {
    const m = new LevelMeter();
    m.push([5, -1, NaN, Infinity, 1, 1, 1, 1], 7, 1000);
    for (const v of m.bands) expect(v >= 0 && v <= 1).toBe(true);
    m.reset();
    expect(Array.from(m.bands)).toEqual(zeros);
    expect(m.level).toBe(0);
  });
});

describe('fakeBands', () => {
  it('makes non-zero bands inside 0..1 that move over time', () => {
    const a = new Float32Array(BAND_COUNT);
    const b = new Float32Array(BAND_COUNT);
    const level = fakeBands(1.0, a);
    fakeBands(1.4, b);
    expect(level).toBeGreaterThan(0);
    for (const v of a) expect(v > 0 && v <= 1).toBe(true);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
