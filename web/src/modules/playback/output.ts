// The browser end of the playback module: connects the sound engine to the speakers using the shared AudioContext.
// A script node asks the engine for the next block of sound a few times per second; a gain node sets the volume.
import { getAudioContext, resumeAudio } from '@/bus';
import type { AudioOutput } from './controller';
import { StretchEngine, type LoopRegion, type PcmSource } from './stretch-engine';

const BLOCK_FRAMES = 4096; // about 90 ms of sound per block: big enough to stay smooth, small enough to feel responsive

export class WebAudioOutput implements AudioOutput {
  onEnded: (() => void) | null = null;

  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private gain: GainNode | null = null;
  private engine: StretchEngine | null = null;
  private tempo = 1;
  private pitch = 0;
  private volume = 0.8;
  private loop: LoopRegion = null;
  private failed = false;

  constructor(
    private readonly getCtx: () => AudioContext = getAudioContext,
    private readonly resume: () => Promise<unknown> = resumeAudio,
  ) {}

  get sampleRate(): number {
    return this.context().sampleRate;
  }
  get durationSec(): number {
    return this.engine?.durationSec ?? 0;
  }
  get positionSec(): number {
    return this.engine?.positionSec ?? 0;
  }

  load(source: PcmSource): void {
    const ctx = this.context();
    const engine = new StretchEngine(source, ctx.sampleRate);
    engine.setTempo(this.tempo);
    engine.setPitchSemitones(this.pitch);
    engine.setLoop(this.loop);
    engine.onEnded = () => this.onEnded?.();
    this.engine = engine;
    this.failed = false;
  }

  play(): void {
    this.engine?.play();
  }
  pause(): void {
    this.engine?.pause();
  }
  seek(sec: number): void {
    this.engine?.seek(sec);
  }
  setTempo(t: number): void {
    this.tempo = t;
    this.engine?.setTempo(t);
  }
  setPitch(semitones: number): void {
    this.pitch = semitones;
    this.engine?.setPitchSemitones(semitones);
  }
  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && this.gain) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  setLoop(region: LoopRegion): void {
    this.loop = region;
    this.engine?.setLoop(region);
  }

  async wake(): Promise<void> {
    if (this.context().state === 'running') return;
    await this.resume();
  }

  dispose(): void {
    if (this.node) this.node.onaudioprocess = null;
    this.node?.disconnect();
    this.gain?.disconnect();
    this.engine = null;
    this.node = null;
    this.gain = null;
    this.ctx = null;
  }

  /** The shared AudioContext plus our two nodes, made the first time they are needed. */
  private context(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = this.getCtx();
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    gain.connect(ctx.destination);
    const node = ctx.createScriptProcessor(BLOCK_FRAMES, 2, 2);
    node.onaudioprocess = (e) => this.fill(e);
    node.connect(gain);
    this.ctx = ctx;
    this.gain = gain;
    this.node = node;
    return ctx;
  }

  private fill(e: AudioProcessingEvent): void {
    const out = e.outputBuffer;
    const left = out.getChannelData(0);
    const right = out.numberOfChannels > 1 ? out.getChannelData(1) : left;
    if (!this.engine || this.failed) {
      left.fill(0);
      right.fill(0);
      return;
    }
    try {
      this.engine.render(left, right, left.length);
    } catch (err) {
      // Never let an error kill the audio callback: go quiet and say so once.
      this.failed = true;
      left.fill(0);
      right.fill(0);
      console.error('[playback] the sound engine stopped', err);
    }
  }
}
