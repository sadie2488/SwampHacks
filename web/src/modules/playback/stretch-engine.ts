// The audio core: plays a pile of samples at any speed (0.5x to 1.5x) and any pitch (-12 to +12 semitones),
// each on its own. It only works on plain Float32Arrays, so it runs (and is tested) in Node as well as in the browser.
// The browser wrapper in output.ts just asks it for the next block of sound.
import { createPipeline, type StretchPipeline } from './soundtouch-lib';

export interface PcmSource {
  sampleRate: number;
  /** One array per channel (mono or stereo; extra channels are ignored). */
  channels: Float32Array[];
}

/** Where to wrap, in song seconds. null means no looping. */
export type LoopRegion = [number, number] | null;

const FEED_FRAMES = 1024; // how much song we hand the stretcher at a time
const STEP_FRAMES = 256; // speed and pitch are nudged this often (about every 6 ms)
const FADE_FRAMES = 256; // start, stop and seek fade over this many samples so there is no click
const GLIDE_SEC = 0.05; // speed and pitch glide to a new value over about this long
const MIN_LOOP_SEC = 0.1;

/** A run of the input that came from one unbroken stretch of the song (a loop wrap starts a new one). */
interface Segment {
  /** Count of input samples fed before this run began. */
  inStart: number;
  /** Song sample this run began at. */
  src: number;
  /** Song sample this run stopped at (set when the next run starts). */
  endSrc: number;
}

export class StretchEngine {
  readonly durationSec: number;
  /** Called once from inside render() when a song that is not looping has played to its end. */
  onEnded: (() => void) | null = null;

  private readonly pipe: StretchPipeline;
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly totalFrames: number;
  private readonly srcRate: number;
  private readonly outRate: number;

  private readFrame = 0; // next song sample to hand to the stretcher
  private loopOn = false;
  private loopStart = 0;
  private loopEnd = 0;

  private tempoTarget = 1;
  private tempoNow = 1;
  private pitchTarget = 0;
  private pitchNow = 0;

  // Position bookkeeping: "fed" counts song samples that went into the stretcher, "consumed" counts how many
  // came out the other end (output samples times speed). Together with the segments that gives the song position.
  private fed = 0;
  private consumed = 0;
  private segments: Segment[] = [{ inStart: 0, src: 0, endSrc: Infinity }];

  private wantRunning = false;
  private pendingSeek: number | null = null;
  private gain = 0;
  private endedFlag = false;

  private readonly feedBuf = new Float32Array(FEED_FRAMES * 2);
  private readonly pullBuf = new Float32Array(STEP_FRAMES * 2);

  constructor(source: PcmSource, outSampleRate: number) {
    const [l, r] = source.channels;
    if (!l) throw new Error('The song has no audio channels.');
    this.left = l;
    this.right = r ?? l;
    this.totalFrames = l.length;
    this.srcRate = source.sampleRate;
    this.outRate = outSampleRate;
    this.durationSec = this.totalFrames / this.srcRate;
    this.pipe = createPipeline(outSampleRate);
    this.applyParams();
  }

  // ---- controls ----
  get ended(): boolean {
    return this.endedFlag;
  }
  get running(): boolean {
    return this.wantRunning;
  }
  get positionSec(): number {
    return this.positionFrames / this.srcRate;
  }

  setTempo(t: number): void {
    if (Number.isFinite(t) && t > 0) this.tempoTarget = t;
  }
  setPitchSemitones(s: number): void {
    if (Number.isFinite(s)) this.pitchTarget = s;
  }
  setLoop(region: LoopRegion): void {
    if (!region) {
      this.loopOn = false;
      return;
    }
    let a = Math.round(Math.min(region[0], region[1]) * this.srcRate);
    let b = Math.round(Math.max(region[0], region[1]) * this.srcRate);
    a = Math.min(Math.max(a, 0), this.totalFrames);
    b = Math.min(Math.max(b, 0), this.totalFrames);
    if (b - a < MIN_LOOP_SEC * this.srcRate) {
      a = 0;
      b = this.totalFrames;
    }
    this.loopStart = a;
    this.loopEnd = b;
    this.loopOn = b > a;
  }
  play(): void {
    if (this.endedFlag) this.seek(0);
    this.wantRunning = true;
  }
  pause(): void {
    this.wantRunning = false;
  }
  /** Jump to a place in the song (song seconds). If sound is playing it fades out first, jumps, and fades back in. */
  seek(sec: number): void {
    const frame = Math.min(Math.max(Math.round((Number.isFinite(sec) ? sec : 0) * this.srcRate), 0), this.totalFrames);
    this.endedFlag = false;
    if (this.gain <= 0) this.doSeek(frame);
    else this.pendingSeek = frame;
  }

  // ---- sound out ----
  /** Fill left and right with the next `frames` samples (silence when paused). */
  render(left: Float32Array, right: Float32Array, frames: number): void {
    let out = 0;
    while (out < frames) {
      const n = Math.min(STEP_FRAMES, frames - out);
      if (this.gain <= 0 && this.pendingSeek !== null) this.doSeek(this.pendingSeek);
      const target = this.wantRunning && this.pendingSeek === null ? 1 : 0;
      if (this.gain <= 0 && target === 0) {
        left.fill(0, out, out + n);
        right.fill(0, out, out + n);
        this.snapParams();
        out += n;
        continue;
      }
      this.glideParams(n);
      const got = this.pull(n);
      const inc = 1 / FADE_FRAMES;
      for (let i = 0; i < n; i++) {
        if (this.gain < target) this.gain = Math.min(target, this.gain + inc);
        else if (this.gain > target) this.gain = Math.max(target, this.gain - inc);
        const ok = i < got;
        left[out + i] = ok ? this.pullBuf[2 * i] * this.gain : 0;
        right[out + i] = ok ? this.pullBuf[2 * i + 1] * this.gain : 0;
      }
      this.consumed += n * this.inputPerOutput();
      out += n;
      this.prune();
      if (!this.loopOn && this.positionFrames >= this.totalFrames - 1 && !this.endedFlag) {
        this.endedFlag = true;
        this.wantRunning = false;
        this.gain = 0;
        this.pendingSeek = null;
        left.fill(0, out, frames);
        right.fill(0, out, frames);
        this.onEnded?.();
        return;
      }
    }
  }

  // ---- internals ----
  private get positionFrames(): number {
    if (this.pendingSeek !== null) return this.pendingSeek;
    const s = this.segments;
    let i = 0;
    while (i + 1 < s.length && s[i + 1].inStart <= this.consumed) i++;
    // The estimate can run a little ahead near a loop wrap; it can never be past what was really fed.
    const limit = i + 1 < s.length ? s[i].endSrc : Math.min(this.readFrame, this.totalFrames);
    return Math.min(s[i].src + (this.consumed - s[i].inStart), limit, this.totalFrames);
  }

  private inputPerOutput(): number {
    return this.tempoNow * (this.srcRate / this.outRate);
  }

  private prune(): void {
    const s = this.segments;
    let i = 0;
    while (i + 1 < s.length && s[i + 1].inStart <= this.consumed) i++;
    if (i > 0) s.splice(0, i);
  }

  private doSeek(frame: number): void {
    this.pendingSeek = null;
    this.readFrame = frame;
    this.fed = 0;
    this.consumed = 0;
    this.segments = [{ inStart: 0, src: frame, endSrc: Infinity }];
    this.pipe.clear();
    this.snapParams();
  }

  private applyParams(): void {
    const rate = this.srcRate / this.outRate;
    this.pipe.setResample(rate * 2 ** (this.pitchNow / 12));
    this.pipe.setSpeed(this.tempoNow * rate);
  }

  private snapParams(): void {
    if (this.tempoNow === this.tempoTarget && this.pitchNow === this.pitchTarget) return;
    this.tempoNow = this.tempoTarget;
    this.pitchNow = this.pitchTarget;
    this.applyParams();
  }

  private glideParams(frames: number): void {
    if (this.tempoNow === this.tempoTarget && this.pitchNow === this.pitchTarget) return;
    const a = 1 - Math.exp(-frames / (this.outRate * GLIDE_SEC));
    const step = (now: number, target: number, eps: number) => (Math.abs(target - now) < eps ? target : now + (target - now) * a);
    this.tempoNow = step(this.tempoNow, this.tempoTarget, 0.002);
    this.pitchNow = step(this.pitchNow, this.pitchTarget, 0.02);
    this.applyParams();
  }

  /** Get `n` stretched samples into pullBuf. Returns how many were really produced. */
  private pull(n: number): number {
    const out = this.pipe.output;
    let guard = 64;
    while (out.frameCount < n && guard-- > 0) {
      this.feed(FEED_FRAMES);
      this.pipe.process();
    }
    if (out.frameCount < n) return 0;
    out.receiveSamples(this.pullBuf, n);
    return n;
  }

  /** Hand the stretcher the next piece of the song (wrapping at the loop end, or padding with silence after the end). */
  private feed(n: number): void {
    const buf = this.feedBuf;
    let i = 0;
    const wrap = () => {
      this.segments[this.segments.length - 1].endSrc = this.readFrame;
      this.readFrame = this.loopStart;
      this.segments.push({ inStart: this.fed + i, src: this.loopStart, endSrc: Infinity });
    };
    while (i < n) {
      // Wrap at the loop end if we are heading for it from below; a playhead already past it runs on to the song's end.
      const limit = this.loopOn && this.readFrame < this.loopEnd ? this.loopEnd : this.totalFrames;
      if (this.readFrame >= limit) {
        if (!this.loopOn) {
          buf.fill(0, 2 * i, 2 * n);
          break;
        }
        wrap();
        continue;
      }
      const take = Math.min(n - i, limit - this.readFrame);
      for (let k = 0; k < take; k++) {
        buf[2 * (i + k)] = this.left[this.readFrame + k];
        buf[2 * (i + k) + 1] = this.right[this.readFrame + k];
      }
      this.readFrame += take;
      i += take;
      if (this.loopOn && this.readFrame === this.loopEnd) wrap();
    }
    this.pipe.input.putSamples(buf, 0, n);
    this.fed += n;
  }
}
