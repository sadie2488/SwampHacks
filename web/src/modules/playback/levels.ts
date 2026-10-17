// Song levels: how loud the playing song is in eight frequency bands, for the visuals and TouchDesigner.
// Plain math only (no bus, timers or Web Audio), so it can be tested alone. song-levels.ts runs it about 30 times a second.
// Nothing here allocates per frame: every buffer is made once and reused.

/** Band edges in Hz, low to high: 20-60, 60-150, 150-400, 400-1k, 1k-2.5k, 2.5k-6k, 6k-12k, 12k-20k. */
export const BAND_EDGES_HZ = [20, 60, 150, 400, 1000, 2500, 6000, 12000, 20000] as const;
export const BAND_COUNT = BAND_EDGES_HZ.length - 1;

/** How fast a band rises to a louder value, and how slowly it falls back (time constants in ms). */
export const ATTACK_MS = 25;
export const RELEASE_MS = 300;

/** The overall level maps this many decibels below full scale to 0 (and full scale to 1). */
export const LEVEL_FLOOR_DB = -60;

/**
 * Which FFT bins belong to each band: [start0, end0, start1, end1, ...], end exclusive.
 * Bin k sits at k * sampleRate / fftSize Hz. A band gets the bins with lo <= frequency < hi; a band too narrow
 * to hold a bin gets the nearest one, and a band above what the sample rate can carry gets none (it stays 0).
 */
export function bandBinRanges(sampleRate: number, binCount: number): Int32Array {
  const binHz = sampleRate / 2 / binCount;
  const ranges = new Int32Array(BAND_COUNT * 2);
  for (let b = 0; b < BAND_COUNT; b++) {
    const lo = BAND_EDGES_HZ[b];
    const hi = BAND_EDGES_HZ[b + 1];
    let start = Math.max(1, Math.ceil(lo / binHz));
    let end = Math.min(binCount, Math.ceil(hi / binHz));
    if (start >= binCount) {
      start = end = binCount; // above the highest frequency this context can carry
    } else if (end <= start) {
      start = Math.min(binCount - 1, Math.max(1, Math.round(lo / binHz)));
      end = start + 1;
    }
    ranges[b * 2] = start;
    ranges[b * 2 + 1] = end;
  }
  return ranges;
}

/** Average of the analyser's byte spectrum (0-255, already on a decibel scale) over each band, as 0 to 1. */
export function bandsFromBytes(bytes: Uint8Array, ranges: Int32Array, out: Float32Array): void {
  for (let b = 0; b < BAND_COUNT; b++) {
    const start = ranges[b * 2];
    const end = ranges[b * 2 + 1];
    let sum = 0;
    for (let i = start; i < end; i++) sum += bytes[i];
    out[b] = end > start ? sum / ((end - start) * 255) : 0;
  }
}

/** Overall loudness of a block of samples: its RMS in decibels, LEVEL_FLOOR_DB..0 mapped to 0..1. */
export function levelFromSamples(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  if (rms <= 0) return 0;
  return clamp01((20 * Math.log10(rms) - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB);
}

/** Made-up bands that move gently (fake mode and tests). Fills `out` and returns a matching overall level. */
export function fakeBands(tSec: number, out: Float32Array): number {
  const pulse = Math.pow(0.5 + 0.5 * Math.cos(tSec * Math.PI * 2 * 2), 4); // a soft "beat" twice a second
  let sum = 0;
  for (let b = 0; b < BAND_COUNT; b++) {
    const wave = 0.5 + 0.5 * Math.sin(tSec * (0.7 + b * 0.31) + b * 1.7);
    const tilt = 1 - b * 0.07; // real music is quieter higher up
    out[b] = clamp01(tilt * (0.25 + 0.35 * wave) + (b < 2 ? 0.3 * pulse : 0));
    sum += out[b];
  }
  return clamp01(sum / BAND_COUNT + 0.1);
}

/** Smooths raw readings: quick to rise, slower to fall, so the visuals pulse without flicker. */
export class LevelMeter {
  readonly bands = new Float32Array(BAND_COUNT);
  level = 0;

  /** Move toward a new reading. `dtMs` is the time since the last one. */
  push(raw: ArrayLike<number>, rawLevel: number, dtMs: number): void {
    const dt = Math.max(0, dtMs);
    const up = 1 - Math.exp(-dt / ATTACK_MS);
    const down = 1 - Math.exp(-dt / RELEASE_MS);
    for (let b = 0; b < BAND_COUNT; b++) this.bands[b] = step(this.bands[b], clamp01(raw[b]), up, down);
    this.level = step(this.level, clamp01(rawLevel), up, down);
  }

  reset(): void {
    this.bands.fill(0);
    this.level = 0;
  }
}

const step = (current: number, target: number, up: number, down: number) => current + (target - current) * (target > current ? up : down);
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
