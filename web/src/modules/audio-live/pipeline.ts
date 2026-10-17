// The live signal path: raw microphone samples in, findings out (through the Analyzer).
// It does not care where the samples come from (AudioWorklet, AnalyserNode, or a test), only that they arrive in order.
import type { Analyzer } from './analyzer';
import { CONFIG } from './config';
import { detectPitch, TransientDetector, type BurstFeatures, type BurstVerdict } from './dsp';

/** One short line per loud sound, for tuning on a real microphone (see CONFIG.debug). */
export function describeBurst(v: BurstVerdict, f: BurstFeatures, strictness = 1): string {
  const verdict = v.kind === 'other' ? 'IGNORED' : v.kind.toUpperCase();
  const strict = strictness !== 1 ? ` | song playing: needs x${strictness} peak and jump` : '';
  return `${verdict}: ${v.reason} | peak ${f.peakRms.toFixed(3)} jump ${f.jumpRatio.toFixed(1)} flat ${f.flatness.toFixed(3)} len ${Math.round(f.burstMs)}ms attack ${Math.round(f.attackMs)}ms centre ${Math.round(f.centroidHz)}Hz high ${Math.round(f.hfRatio * 100)}%${strict}`;
}

export class MicPipeline {
  private readonly hop: number;
  private readonly windowSize: number;
  private readonly ring: Float32Array;
  private readonly win: Float32Array;
  private readonly transients: TransientDetector;
  private total = 0;
  private nextHopAt: number;

  constructor(
    private readonly sampleRate: number,
    private readonly analyzer: Analyzer,
    private readonly cfg = CONFIG,
  ) {
    this.hop = Math.round((sampleRate * cfg.pitch.hopMs) / 1000);
    // very high sample rates need a longer window to cover the same time
    this.windowSize = sampleRate > 64000 ? cfg.pitch.windowSize * 2 : cfg.pitch.windowSize;
    this.ring = new Float32Array(this.windowSize * 2);
    this.win = new Float32Array(this.windowSize);
    this.nextHopAt = this.windowSize;
    this.transients = new TransientDetector(sampleRate, cfg.onset, cfg.burst, cfg.hand);
  }

  /** The song is playing (or stopped): snaps and claps must stand out more while it plays (CONFIG.hand.playingStrictness). */
  setSongPlaying(playing: boolean): void {
    this.transients.strictness = playing ? this.cfg.hand.playingStrictness : 1;
  }

  /** Seconds of audio processed so far (the session clock). */
  get timeSec(): number {
    return this.total / this.sampleRate;
  }

  /** Feed the next samples. `lostBefore` = how many samples were missed just before this chunk (the page was busy). */
  push(chunk: Float32Array, lostBefore = 0): void {
    if (lostBefore > 0) {
      this.total += lostBefore;
      this.nextHopAt = Math.max(this.nextHopAt, this.total + this.windowSize);
      this.ring.fill(0);
      this.transients.skip(lostBefore);
    }
    let i = 0;
    while (i < chunk.length) {
      // work in pieces that end exactly on a hop boundary so every frame sees the right window
      const take = Math.min(chunk.length - i, this.nextHopAt - this.total);
      const piece = chunk.subarray(i, i + take);
      for (let k = 0; k < take; k++) this.ring[(this.total + k) % this.ring.length] = piece[k];
      const events = this.transients.push(piece);
      this.total += take;
      i += take;
      this.handleTransients(events);
      if (this.total === this.nextHopAt) {
        this.runFrame();
        this.nextHopAt += this.hop;
      }
    }
  }

  private runFrame(): void {
    const n = this.windowSize;
    const start = this.total - n;
    let mean = 0;
    for (let k = 0; k < n; k++) mean += this.ring[(start + k) % this.ring.length];
    mean /= n;
    for (let k = 0; k < n; k++) this.win[k] = this.ring[(start + k) % this.ring.length] - mean;
    const r = detectPitch(this.win, this.sampleRate, this.cfg.pitch);
    this.analyzer.frame(this.total / this.sampleRate, r.midi, r.clarity, r.rms);
  }

  private handleTransients(events: ReturnType<TransientDetector['push']>): void {
    for (const e of events) {
      const tSec = e.sample / this.sampleRate;
      if (e.type === 'onset') this.analyzer.attack(tSec, e.rms, e.confidence);
      else {
        if (e.verdict.kind !== 'other') this.analyzer.hand(e.verdict.kind, tSec, e.verdict.confidence);
        if (this.cfg.debug) console.debug(`[audio-live] ${describeBurst(e.verdict, e.features, this.transients.strictness)}`);
      }
    }
  }
}
