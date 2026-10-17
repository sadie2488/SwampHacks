// The number crunching for the microphone. Everything here works on plain Float32Arrays so it runs (and is tested) in Node.
import { PitchDetector } from 'pitchy';
import { CONFIG } from './config';

export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function rms(x: ArrayLike<number>): number {
  if (x.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
}

/** Turn an RMS level into the 0..1 "how loud" scale used by audio.loudness. */
export function levelFromRms(level: number, cfg = CONFIG.loudness): number {
  if (level <= 0) return 0;
  const db = 20 * Math.log10(level);
  return clamp01((db - cfg.floorDb) / (cfg.ceilDb - cfg.floorDb));
}

// ---------------------------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------------------------
export interface PitchResult {
  hz: number;
  /** Concert-pitch MIDI with a fraction, or null when the sound is too quiet or not clearly pitched. */
  midi: number | null;
  /** 0..1, how sure the detector is (pitchy "clarity"). */
  clarity: number;
  rms: number;
}

const detectors = new Map<number, PitchDetector<Float32Array>>();

/** Find the pitch of one window of mono audio. */
export function detectPitch(window: Float32Array, sampleRate: number, cfg = CONFIG.pitch): PitchResult {
  const level = rms(window);
  if (level < cfg.minRms) return { hz: 0, midi: null, clarity: 0, rms: level };
  let detector = detectors.get(window.length);
  if (!detector) {
    detector = PitchDetector.forFloat32Array(window.length);
    detectors.set(window.length, detector);
  }
  const [hz, found] = detector.findPitch(window, sampleRate);
  // noise often "finds" an absurdly high pitch with a fairly high score; a pitch outside the range counts as no pitch at all
  const clarity = hz >= cfg.minHz && hz <= cfg.maxHz ? found : 0;
  return { hz, midi: clarity >= cfg.minClarity ? hzToMidi(hz) : null, clarity, rms: level };
}

// ---------------------------------------------------------------------------------------------
// Spectrum
// ---------------------------------------------------------------------------------------------
/** In-place radix-2 FFT. Length must be a power of 2. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/** Power spectrum (size/2 + 1 bins) of a Hann-windowed copy of the samples, zero-padded to `size`. */
export function powerSpectrum(samples: ArrayLike<number>, size = nextPow2(samples.length)): Float64Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const n = Math.min(samples.length, size);
  for (let i = 0; i < n; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  fft(re, im);
  const out = new Float64Array(size / 2 + 1);
  for (let k = 0; k < out.length; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}

export interface SpectralFeatures {
  /** The "centre of mass" of the spectrum in Hz. Higher = brighter. */
  centroidHz: number;
  /** Share of the energy above 2.5 kHz, 0..1. */
  hfRatio: number;
  /** 0..1. Near 0 = a few clear tones (voice, instrument). Higher = noise-like (clap, snap, breath). */
  flatness: number;
}

/** Simple, explainable features of a short burst of sound. */
export function spectralFeatures(samples: ArrayLike<number>, sampleRate: number): SpectralFeatures {
  const spec = powerSpectrum(samples);
  const binHz = sampleRate / ((spec.length - 1) * 2);
  const bin = (hz: number) => Math.min(spec.length - 1, Math.max(0, Math.round(hz / binHz)));
  const top = Math.min(sampleRate / 2, 12000);
  // centroid and high-frequency share over 150 Hz .. 12 kHz (ignores rumble and hand-held mic noise)
  let total = 0;
  let weighted = 0;
  let high = 0;
  for (let k = bin(150); k <= bin(top); k++) {
    total += spec[k];
    weighted += spec[k] * k * binHz;
    if (k * binHz >= 2500) high += spec[k];
  }
  // flatness over 300 Hz .. 8 kHz: geometric mean / arithmetic mean of the power spectrum
  let logSum = 0;
  let sum = 0;
  let count = 0;
  for (let k = bin(300); k <= bin(Math.min(top, 8000)); k++) {
    logSum += Math.log(spec[k] + 1e-12);
    sum += spec[k];
    count++;
  }
  const flatness = count && sum > 0 ? Math.exp(logSum / count) / (sum / count) : 0;
  return {
    centroidHz: total > 0 ? weighted / total : 0,
    hfRatio: total > 0 ? high / total : 0,
    flatness: clamp01(flatness),
  };
}

// ---------------------------------------------------------------------------------------------
// Snap or clap?
// ---------------------------------------------------------------------------------------------
export interface BurstFeatures extends SpectralFeatures {
  /** How long the burst lasted before dying away, in ms. */
  burstMs: number;
  /** Loudest block (RMS) of the burst. */
  peakRms: number;
  /** Peak loudness divided by the recent average before it. */
  jumpRatio: number;
}
export type BurstKind = 'snap' | 'clap' | 'other';
export interface BurstVerdict {
  kind: BurstKind;
  /** 0..1, how far past the borderline the sound was. */
  confidence: number;
  /** Plain-words explanation, handy when tuning. */
  reason: string;
}

/**
 * The rule, in words:
 *  - it must be loud enough and a sudden jump,
 *  - it must be noise-like (voices and instruments are not),
 *  - it must die away within `clapMaxBurstMs`,
 *  - SNAP = short and bright (centroid high, most energy above 2.5 kHz),
 *  - CLAP = anything else that passed: a bit longer and/or broader, mid-range.
 */
export function classifyBurst(f: BurstFeatures, cfg = CONFIG.hand): BurstVerdict {
  if (f.peakRms < cfg.minPeakRms) return { kind: 'other', confidence: 0, reason: 'too quiet to be a snap or clap' };
  if (f.jumpRatio < cfg.minJumpRatio) return { kind: 'other', confidence: 0, reason: 'not a sharp enough jump in loudness' };
  if (f.flatness < cfg.minFlatness) return { kind: 'other', confidence: 0, reason: 'tonal (voice or instrument), not a hand sound' };
  if (f.burstMs > cfg.clapMaxBurstMs) return { kind: 'other', confidence: 0, reason: 'lasts too long to be a snap or clap' };
  const s = cfg.snap;
  const bright = f.centroidHz >= s.minCentroidHz && f.hfRatio >= s.minHfRatio;
  if (f.burstMs <= s.maxBurstMs && bright) {
    const margin = Math.min((f.centroidHz - s.minCentroidHz) / s.minCentroidHz, (f.hfRatio - s.minHfRatio) / s.minHfRatio, (s.maxBurstMs - f.burstMs) / s.maxBurstMs);
    return { kind: 'snap', confidence: clamp01(0.5 + margin), reason: 'short and bright' };
  }
  const margin = Math.min((cfg.clapMaxBurstMs - f.burstMs) / cfg.clapMaxBurstMs, (f.flatness - cfg.minFlatness) / cfg.minFlatness);
  const why = f.burstMs > s.maxBurstMs ? 'lasts a bit longer than a snap' : 'not bright enough for a snap';
  return { kind: 'clap', confidence: clamp01(0.5 + margin / 2), reason: `broad noise burst, ${why}` };
}

// ---------------------------------------------------------------------------------------------
// Attacks (sudden jumps in loudness) and what they were
// ---------------------------------------------------------------------------------------------
export type TransientEvent =
  | { type: 'onset'; /** Sample index (since the start) where the loud block began. */ sample: number; rms: number; ratio: number; confidence: number }
  | { type: 'burst'; sample: number; verdict: BurstVerdict; features: BurstFeatures };

const RING = 16384;

/**
 * Watches a stream of samples. Loudness is measured in short blocks; a block that is much louder than the recent
 * average is an attack ("onset"). The burst that follows is then measured (how long, how bright, how noisy) and
 * labelled snap, clap or other. A cooldown stops one clap from being counted twice.
 */
export class TransientDetector {
  private readonly blockSize: number;
  private readonly histLen: number;
  private readonly ring = new Float32Array(RING);
  private written = 0;
  private blockSum = 0;
  private blockCount = 0;
  private readonly hist: Float64Array;
  private histN = 0;
  private histPos = 0;
  private histSum = 0;
  private state: 'idle' | 'capture' = 'idle';
  private lastOnsetSample = -Infinity;
  private quietUntil = -Infinity;
  private cap = { start: 0, peak: 0, bg: 0 };

  constructor(
    private readonly sampleRate: number,
    private readonly onsetCfg = CONFIG.onset,
    private readonly burstCfg = CONFIG.burst,
    private readonly handCfg = CONFIG.hand,
  ) {
    this.blockSize = Math.max(8, Math.round((sampleRate * onsetCfg.blockMs) / 1000));
    this.histLen = Math.max(4, Math.round(onsetCfg.historyMs / onsetCfg.blockMs));
    this.hist = new Float64Array(this.histLen);
  }

  private ms(samples: number): number {
    return (samples / this.sampleRate) * 1000;
  }

  /** Feed the next samples. Returns the events found, in order. */
  push(chunk: ArrayLike<number>): TransientEvent[] {
    const events: TransientEvent[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const s = chunk[i];
      this.ring[this.written % RING] = s;
      this.written++;
      this.blockSum += s * s;
      if (++this.blockCount === this.blockSize) {
        const level = Math.sqrt(this.blockSum / this.blockSize);
        this.blockSum = 0;
        this.blockCount = 0;
        this.endBlock(level, events);
      }
    }
    return events;
  }

  /** Samples were lost (the page was busy): move the clock on and forget the half-built block. */
  skip(n: number): void {
    this.written += n;
    this.blockSum = 0;
    this.blockCount = 0;
    if (this.state === 'capture') this.state = 'idle';
  }

  private endBlock(level: number, events: TransientEvent[]): void {
    const blockStart = this.written - this.blockSize;
    const bg = this.histN ? this.histSum / this.histN : 0;
    const o = this.onsetCfg;
    if (this.state === 'idle') {
      const warm = this.ms(blockStart) >= o.warmupMs && this.histN >= 4;
      const ratio = level / Math.max(bg, o.noiseFloorRms);
      if (warm && level >= o.minRms && ratio >= o.jumpRatio && this.ms(blockStart - this.lastOnsetSample) >= o.refractoryMs && blockStart >= this.quietUntil) {
        this.lastOnsetSample = blockStart;
        this.cap = { start: blockStart, peak: level, bg };
        this.state = 'capture';
        events.push({ type: 'onset', sample: blockStart, rms: level, ratio, confidence: clamp01(Math.log2(ratio / o.jumpRatio) / 3 + 0.5) });
      }
    } else {
      this.cap.peak = Math.max(this.cap.peak, level);
      const sinceStart = this.ms(this.written - this.cap.start);
      const decayed = level < this.burstCfg.decayFrac * this.cap.peak && blockStart > this.cap.start;
      if (decayed || sinceStart >= this.burstCfg.maxWaitMs) {
        const burstMs = decayed ? this.ms(blockStart - this.cap.start) : sinceStart;
        events.push(this.finishBurst(burstMs));
        this.state = 'idle';
      }
    }
    // the loudness history is updated after the decision so a block is never compared with itself
    if (this.histN === this.histLen) this.histSum -= this.hist[this.histPos];
    else this.histN++;
    this.hist[this.histPos] = level;
    this.histSum += level;
    this.histPos = (this.histPos + 1) % this.histLen;
  }

  private finishBurst(burstMs: number): TransientEvent {
    const start = this.cap.start;
    const len = Math.min(Math.round((this.burstCfg.analysisMs * this.sampleRate) / 1000), this.written - start);
    const win = new Float32Array(len);
    for (let i = 0; i < len; i++) win[i] = this.ring[(start + i) % RING];
    const features: BurstFeatures = {
      ...spectralFeatures(win, this.sampleRate),
      burstMs,
      peakRms: this.cap.peak,
      jumpRatio: this.cap.peak / Math.max(this.cap.bg, this.onsetCfg.noiseFloorRms),
    };
    const verdict = classifyBurst(features, this.handCfg);
    // cooldown: after a snap or clap, attacks are ignored for a moment so one sound (and its echo) is not counted twice
    if (verdict.kind !== 'other') this.quietUntil = start + Math.round((this.handCfg.cooldownMs * this.sampleRate) / 1000);
    return { type: 'burst', sample: start, verdict, features };
  }
}
