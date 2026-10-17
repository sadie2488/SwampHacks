// Generators for made-up sound, used only by the tests in this folder.

/** A small repeatable random number generator (so the tests give the same answer every run). */
export function rng(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function silence(seconds: number, sr: number): Float32Array {
  return new Float32Array(Math.round(seconds * sr));
}

/** White noise between -amp and +amp. */
export function noise(seconds: number, sr: number, amp = 0.3, seed = 1): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = (r() * 2 - 1) * amp;
  return out;
}

export function sine(hz: number, seconds: number, sr: number, amp = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
}

/**
 * Something voice-like: a fundamental plus two weaker harmonics, with vibrato (pitch wobbling about
 * `vibratoSemitones` either side, `vibratoHz` times a second). Follows a list of [seconds, midi] segments.
 */
export function voice(segments: Array<[seconds: number, midi: number]>, sr: number, opts: { amp?: number; vibratoSemitones?: number; vibratoHz?: number } = {}): Float32Array {
  const { amp = 0.25, vibratoSemitones = 0.35, vibratoHz = 5.5 } = opts;
  const total = segments.reduce((s, [d]) => s + d, 0);
  const out = new Float32Array(Math.round(total * sr));
  let phase = 0;
  let i = 0;
  for (const [d, midi] of segments) {
    for (let k = 0; k < Math.round(d * sr); k++, i++) {
      const t = i / sr;
      const m = midi + vibratoSemitones * Math.sin(2 * Math.PI * vibratoHz * t);
      phase += (2 * Math.PI * 440 * 2 ** ((m - 69) / 12)) / sr;
      out[i] = amp * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase)) / 1.8;
    }
  }
  return out;
}

/** A single short click (a few samples wide) every `period` seconds. */
export function clickTrain(seconds: number, period: number, sr: number, amp = 0.8, first = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let t = first; t < seconds; t += period) {
    const at = Math.round(t * sr);
    for (let k = 0; k < 24 && at + k < out.length; k++) out[at + k] = amp * (k % 2 ? -1 : 1) * (1 - k / 24);
  }
  return out;
}

type Biquad = (x: number) => number;
function biquad(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}
export function highpass(hz: number, sr: number, q = 0.707): Biquad {
  const w = (2 * Math.PI * hz) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return biquad((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}
export function lowpass(hz: number, sr: number, q = 0.707): Biquad {
  const w = (2 * Math.PI * hz) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return biquad((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

/**
 * A burst of filtered noise that dies away exponentially, placed at `at` seconds in a recording of `seconds`.
 * `decayMs` is the time it takes to fall by a factor of e. `band` = [low Hz, high Hz] (filters applied twice for a steeper edge).
 */
export function burst(opts: { seconds: number; at: number; sr: number; decayMs: number; band: [number, number]; amp?: number; seed?: number }): Float32Array {
  const { seconds, at, sr, decayMs, band, amp = 0.7, seed = 7 } = opts;
  const out = new Float32Array(Math.round(seconds * sr));
  const r = rng(seed);
  const hp1 = highpass(band[0], sr);
  const hp2 = highpass(band[0], sr);
  const lp1 = lowpass(band[1], sr);
  const lp2 = lowpass(band[1], sr);
  const start = Math.round(at * sr);
  const len = Math.round((decayMs * 8 * sr) / 1000);
  let peak = 1e-9;
  const shaped = new Float32Array(len);
  for (let k = 0; k < len; k++) {
    const x = lp2(lp1(hp2(hp1(r() * 2 - 1))));
    shaped[k] = x * Math.exp(-(k / sr) / (decayMs / 1000));
    peak = Math.max(peak, Math.abs(shaped[k]));
  }
  for (let k = 0; k < len && start + k < out.length; k++) out[start + k] = (shaped[k] / peak) * amp;
  return out;
}

/** A bright, short finger-snap-like sound. */
export const snapSound = (opts: { seconds: number; at: number; sr: number; amp?: number; seed?: number }) =>
  burst({ ...opts, decayMs: 3, band: [2500, 9000] });

/** A broader, longer hand-clap-like sound. */
export const clapSound = (opts: { seconds: number; at: number; sr: number; amp?: number; seed?: number }) =>
  burst({ ...opts, decayMs: 16, band: [600, 3500] });

export function mix(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Hand a recording to a function in uneven pieces, the way a real microphone delivers it. */
export function inPieces(signal: Float32Array, push: (piece: Float32Array) => void, sizes = [512, 480, 960, 333, 1024]): void {
  let at = 0;
  let k = 0;
  while (at < signal.length) {
    const n = Math.min(sizes[k++ % sizes.length], signal.length - at);
    push(signal.subarray(at, at + n));
    at += n;
  }
}
