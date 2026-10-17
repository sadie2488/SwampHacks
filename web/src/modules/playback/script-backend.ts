// The older way to make sound: a ScriptProcessorNode that asks the engine for a block of sound on the page's main thread.
// It still works everywhere, but it can stutter when the page is busy, so output.ts prefers the audio worklet and only
// uses this when the worklet is missing or fails.
import type { Backend, BackendEvents, Snapshot } from './backend';
import { blockAnchor, deviceDelaySec, PositionClock } from './position-clock';
import { StretchEngine, type LoopRegion, type PcmSource } from './stretch-engine';

const BLOCK_FRAMES = 4096; // about 90 ms of sound per block: big enough to stay smooth, small enough to feel responsive

export class ScriptBackend implements Backend {
  readonly kind = 'script' as const;
  readonly handlesVolume = false;

  private readonly node: ScriptProcessorNode;
  private engine: StretchEngine | null = null;
  private failed = false;
  private readonly clock = new PositionClock();
  private tempo: number;
  private pitch: number;
  private loop: LoopRegion;

  constructor(
    private readonly ctx: AudioContext,
    gain: GainNode,
    snapshot: Snapshot,
    private readonly events: BackendEvents,
  ) {
    this.tempo = snapshot.tempo;
    this.pitch = snapshot.pitch;
    this.loop = snapshot.loop;
    this.node = ctx.createScriptProcessor(BLOCK_FRAMES, 2, 2);
    this.node.onaudioprocess = (e) => this.fill(e);
    this.node.connect(gain);
    if (snapshot.source) {
      this.loadSource(snapshot.source);
      if (snapshot.positionSec > 0) this.seek(snapshot.positionSec);
      if (snapshot.playing) this.play();
    }
  }

  positionSec(): number {
    if (!this.engine) return 0;
    if (!this.clock.active) return this.engine.positionSec;
    return this.clock.read(this.ctx.currentTime - deviceDelaySec(this.ctx));
  }

  loadSource(source: PcmSource): void {
    const engine = new StretchEngine(source, this.ctx.sampleRate);
    engine.setTempo(this.tempo);
    engine.setPitchSemitones(this.pitch);
    engine.setLoop(this.loop);
    engine.onEnded = () => this.events.onEnded();
    this.engine = engine;
    this.failed = false;
    this.clock.clear();
  }

  play(): void {
    this.engine?.play();
  }
  pause(): void {
    this.engine?.pause();
  }
  seek(sec: number): void {
    this.engine?.seek(sec);
    if (this.engine && this.clock.active) this.clock.reset(this.engine.positionSec);
  }
  setTempo(t: number): void {
    this.tempo = t;
    this.engine?.setTempo(t);
  }
  setPitch(semitones: number): void {
    this.pitch = semitones;
    this.engine?.setPitchSemitones(semitones);
  }
  setLoop(region: LoopRegion): void {
    this.loop = region;
    this.engine?.setLoop(region);
  }
  setVolume(): void {
    // the owner's gain node does this
  }
  contextRunning(): void {
    // nothing to watch: the script node cannot go silent without the page noticing
  }

  dispose(): void {
    this.node.onaudioprocess = null;
    this.node.disconnect();
    this.engine = null;
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
      const from = this.engine.positionSec;
      this.engine.render(left, right, left.length);
      const when = e.playbackTime;
      if (typeof when === 'number' && Number.isFinite(when) && when > 0) {
        this.clock.add(blockAnchor(when, left.length / this.ctx.sampleRate, from, this.engine.positionSec));
      }
    } catch (err) {
      // Never let an error kill the audio callback: go quiet and say so once.
      this.failed = true;
      left.fill(0);
      right.fill(0);
      console.error('[playback] the sound engine stopped', err);
    }
  }
}
