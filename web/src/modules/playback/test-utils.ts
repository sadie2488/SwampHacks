// Helpers shared by this module's tests only: make test tones and measure what comes out.

export function sine(freq: number, seconds: number, sampleRate: number, amp = 0.5): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return x;
}

/** Frequency from rising zero crossings between samples a (inclusive) and b (exclusive), using the first and last crossing. */
export function zeroCrossingFreq(x: ArrayLike<number>, sampleRate: number, a = 0, b = x.length): number {
  const t: number[] = [];
  for (let i = Math.max(a, 1); i < b; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) t.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
  }
  if (t.length < 3) return 0;
  return ((t.length - 1) * sampleRate) / (t[t.length - 1] - t[0]);
}

/** Strongest frequency between lo and hi Hz (Hann window plus a coarse-then-fine frequency scan). Independent check of zeroCrossingFreq. */
export function dominantFreq(x: ArrayLike<number>, sampleRate: number, lo: number, hi: number, a = 0, b = x.length): number {
  const n = b - a;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = x[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const power = (f: number) => {
    const cr = Math.cos((2 * Math.PI * f) / sampleRate);
    const sr = Math.sin((2 * Math.PI * f) / sampleRate);
    let c = 1;
    let s = 0;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += w[i] * c;
      im -= w[i] * s;
      const nc = c * cr - s * sr;
      s = s * cr + c * sr;
      c = nc;
    }
    return re * re + im * im;
  };
  const scan = (from: number, to: number, step: number) => {
    let best = from;
    let bestPower = -1;
    for (let f = from; f <= to; f += step) {
      const p = power(f);
      if (p > bestPower) {
        bestPower = p;
        best = f;
      }
    }
    return best;
  };
  const coarse = scan(lo, hi, 2);
  return scan(coarse - 2, coarse + 2, 0.25);
}

/** Index of the first and last sample louder than the threshold. */
export function activeRange(x: ArrayLike<number>, threshold = 0.05): [number, number] {
  let first = -1;
  let last = -1;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) > threshold) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return [first, last];
}

export function rms(x: ArrayLike<number>, a = 0, b = x.length): number {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

/** Biggest jump between neighbouring samples (a click shows up as a big number). */
export function maxStep(x: ArrayLike<number>, a = 1, b = x.length): number {
  let m = 0;
  for (let i = Math.max(a, 1); i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
}

export function peak(x: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}

/** Noise that is the same every run (so a test can compare samples exactly). */
export function noise(n: number, seed = 1, amp = 0.5): Float32Array {
  const x = new Float32Array(n);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    x[i] = amp * ((s / 0xffffffff) * 2 - 1);
  }
  return x;
}

/** A short 3 kHz burst (1.5 ms, smooth edges): the "click" of a click track. */
function burst(sampleRate: number): Float32Array {
  const n = Math.round(0.0015 * sampleRate);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = 0.8 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n)) * Math.sin((2 * Math.PI * 3000 * i) / sampleRate);
  return b;
}

/** A click every `gapSec`, from 1 s to 1 s before the end. `times` are the song times of the click centres. */
export function clickTrack(sampleRate: number, seconds: number, gapSec: number): { samples: Float32Array; times: number[] } {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const b = burst(sampleRate);
  const times: number[] = [];
  for (let t = 1; t < seconds - 1; t += gapSec) {
    samples.set(b, Math.round(t * sampleRate) - (b.length >> 1));
    times.push(t);
  }
  return { samples, times };
}

/** What an engine looks like to the position measurement. */
export interface MeasurableEngine {
  render(left: Float32Array, right: Float32Array, frames: number): void;
  readonly positionSec: number;
}

/**
 * Play a click track and, for every click, compare WHEN it is heard with WHERE the engine says the song is at that moment.
 * Returns the error per click in seconds: positive means the engine's position was ahead of the sound, negative behind.
 * `blocks` are small (16 frames) so the position is known to well under a millisecond.
 */
export function clickPositionErrors(engine: MeasurableEngine, sampleRate: number, tempo: number, clicks: number[]): number[] {
  const B = 16;
  const lastClick = clicks[clicks.length - 1];
  const total = Math.ceil(((lastClick + 0.5) / tempo) * sampleRate / B) * B;
  const out = new Float32Array(total);
  const pos = new Float64Array(total / B + 1);
  const L = new Float32Array(B);
  const R = new Float32Array(B);
  pos[0] = engine.positionSec;
  for (let b = 0; b < total / B; b++) {
    engine.render(L, R, B);
    out.set(L, b * B);
    pos[b + 1] = engine.positionSec;
  }
  const positionAt = (frame: number) => {
    const b = Math.floor(frame / B);
    return pos[b] + (pos[b + 1] - pos[b]) * ((frame - b * B) / B);
  };
  const half = Math.round(0.0015 * sampleRate);
  const errors: number[] = [];
  for (const t of clicks) {
    const ideal = Math.round((t / tempo) * sampleRate);
    let at = -1;
    let loudest = 0.05;
    // A slowed-down song repeats pieces, so a click can be heard twice: take the one nearest to where a perfect stretch puts it.
    for (let f = Math.max(half + 1, ideal - 0.2 * sampleRate); f < Math.min(total - half - 1, ideal + 0.2 * sampleRate); f++) {
      if (Math.abs(out[f]) > loudest) {
        loudest = Math.abs(out[f]);
        at = f;
      }
    }
    if (at < 0) continue;
    let weight = 0;
    let moment = 0;
    for (let f = at - half; f <= at + half; f++) {
      weight += out[f] * out[f];
      moment += out[f] * out[f] * f;
    }
    errors.push(positionAt(moment / weight) - t);
  }
  return errors;
}
