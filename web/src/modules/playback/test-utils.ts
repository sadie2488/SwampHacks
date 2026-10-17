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
