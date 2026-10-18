// The browser end of the playback module: connects the sound engine to the speakers using the shared AudioContext.
//
// Two ways to make the sound (see backend.ts):
//   worklet  the engine runs in an AudioWorklet, off the page's main thread, so a busy page cannot make it stutter
//   script   the engine runs in a ScriptProcessorNode on the main thread (the older way, works everywhere)
// The worklet is tried first. If the browser has none, the module cannot load, the node cannot be made, the worklet
// says it broke, or it stays silent while the audio device is running, the script node takes over from the same
// song, place and settings, and stays for the rest of the session.
import { getAudioContext, resumeAudio } from '@/bus';
import type { AudioOutput } from './controller';
import type { Backend, Snapshot } from './backend';
import { ScriptBackend } from './script-backend';
import type { LoopRegion, PcmSource } from './stretch-engine';
import { WorkletBackend, type WorkletNodeLike } from './worklet-backend';

/** Make a node running the worklet engine, or reject (the module could not load, the script failed its dry run, ...). */
export type MakeWorkletNode = (ctx: AudioContext) => Promise<WorkletNodeLike>;

export interface OutputOptions {
  /** false: only ever use the script node. A function: use that to make the worklet node (tests). Default: the real worklet when the browser has one. */
  worklet?: boolean | MakeWorkletNode;
  /** How long the worklet may stay silent (while the device is running) before we give up on it. */
  watchdogMs?: number;
}

/** Which backend is active, for the on-screen status and the browser checks. 'starting' = the worklet is still loading. */
export type SoundPath = 'none' | 'starting' | 'worklet' | 'script';

const WATCHDOG_MS = 2500;

/** Loading a processor name twice in one AudioContext is an error, so remember the load per context (as audio-live/capture.ts does). */
const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** The real worklet: dry-run the script, load it from an inline Blob URL, and make the node. */
export const makeRealWorkletNode: MakeWorkletNode = async (ctx) => {
  if (!ctx.audioWorklet) throw new Error('AudioWorklet is not available');
  const { buildWorkletSource, selfTestWorkletSource, WORKLET_NAME } = await import('./worklet-source');
  let ready = loaded.get(ctx);
  if (!ready) {
    const source = buildWorkletSource();
    const problem = selfTestWorkletSource(source);
    if (problem) throw new Error(problem);
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    ready = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loaded.set(ctx, ready);
  }
  await ready;
  return new AudioWorkletNode(ctx, WORKLET_NAME, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }) as unknown as WorkletNodeLike;
};

export class WebAudioOutput implements AudioOutput {
  onEnded: (() => void) | null = null;

  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  /** Listens to the gain node's output (after pitch, tempo and volume) for the song levels. Not connected onward, so it adds no delay. */
  private analyser: AnalyserNode | null = null;
  private backend: Backend | null = null;
  private path: SoundPath = 'none';
  private disposed = false;

  // What the controller asked for, kept here so either backend can be started (or restarted) from it.
  private source: PcmSource | null = null;
  private tempo = 1;
  private pitch = 0;
  private volume = 0.8;
  private loop: LoopRegion = null;
  private playing = false;
  private lastPosition = 0;

  constructor(
    private readonly getCtx: () => AudioContext = getAudioContext,
    private readonly resume: () => Promise<unknown> = resumeAudio,
    private readonly options: OutputOptions = {},
  ) {}

  get sampleRate(): number {
    return this.context().sampleRate;
  }
  get durationSec(): number {
    return this.source ? this.source.channels[0].length / this.source.sampleRate : 0;
  }
  get positionSec(): number {
    return this.backend ? this.backend.positionSec() : this.lastPosition;
  }
  /** The analyser tapping the song's output, or null before a song is loaded (or where the browser has none). */
  analyserNode(): AnalyserNode | null {
    return this.analyser;
  }
  /** Which way the sound is being made right now. */
  get soundPath(): SoundPath {
    return this.path;
  }

  load(source: PcmSource): void {
    this.context();
    this.source = source;
    this.lastPosition = 0;
    this.playing = false;
    this.backend?.loadSource(source);
  }

  play(): void {
    this.playing = true;
    this.backend?.play();
  }
  pause(): void {
    this.playing = false;
    this.backend?.pause();
  }
  seek(sec: number): void {
    this.lastPosition = sec;
    this.backend?.seek(sec);
  }
  setTempo(t: number): void {
    this.tempo = t;
    this.backend?.setTempo(t);
  }
  setPitch(semitones: number): void {
    this.pitch = semitones;
    this.backend?.setPitch(semitones);
  }
  setVolume(v: number): void {
    this.volume = v;
    this.applyVolume();
  }
  setLoop(region: LoopRegion): void {
    this.loop = region;
    this.backend?.setLoop(region);
  }

  async wake(): Promise<void> {
    if (this.context().state !== 'running') await this.resume();
    this.backend?.contextRunning();
  }

  dispose(): void {
    this.disposed = true;
    this.backend?.dispose();
    this.backend = null;
    this.gain?.disconnect();
    this.gain = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.ctx = null;
    this.path = 'none';
  }

  // ---- internals ----
  /** The shared AudioContext plus our gain node, made the first time they are needed. This is also where a sound path is chosen. */
  private context(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = this.getCtx();
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    gain.connect(ctx.destination);
    this.ctx = ctx;
    this.gain = gain;
    this.analyser = makeAnalyser(ctx, gain);
    this.choosePath(ctx);
    return ctx;
  }

  private choosePath(ctx: AudioContext): void {
    const make = this.workletMaker(ctx);
    if (!make) {
      this.useScript(ctx);
      return;
    }
    this.path = 'starting';
    let attempt: Promise<WorkletNodeLike>;
    try {
      attempt = make(ctx);
    } catch (err) {
      attempt = Promise.reject(err);
    }
    attempt.then(
      (node) => {
        if (this.disposed || this.ctx !== ctx) {
          try {
            node.disconnect();
          } catch {
            // never connected
          }
          return;
        }
        this.useWorklet(ctx, node);
      },
      (err) => {
        if (!this.disposed && this.ctx === ctx) this.fallBack('the audio worklet could not be started', err);
      },
    );
  }

  private workletMaker(ctx: AudioContext): MakeWorkletNode | null {
    const choice = this.options.worklet;
    if (choice === false) return null;
    if (typeof choice === 'function') return choice;
    return ctx.audioWorklet ? makeRealWorkletNode : null;
  }

  private snapshot(): Snapshot {
    return { source: this.source, tempo: this.tempo, pitch: this.pitch, volume: this.volume, loop: this.loop, playing: this.playing, positionSec: this.lastPosition };
  }

  private useScript(ctx: AudioContext): void {
    if (!this.gain) return;
    this.backend = new ScriptBackend(ctx, this.gain, this.snapshot(), this.events());
    this.path = 'script';
    console.info('[playback] sound path: script node');
    this.applyVolume();
  }

  private useWorklet(ctx: AudioContext, node: WorkletNodeLike): void {
    if (!this.gain) return;
    node.connect(this.gain);
    this.backend = new WorkletBackend(node, ctx, this.snapshot(), this.events(), { watchdogMs: this.options.watchdogMs ?? WATCHDOG_MS });
    this.path = 'worklet';
    console.info('[playback] sound path: audio worklet');
    this.applyVolume();
  }

  /** Give up on the worklet: carry on from the same song, place and settings with the script node. */
  private fallBack(reason: string, error?: unknown): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed || this.path === 'script') return;
    console.warn(`[playback] ${reason}; using the older sound path instead`, error ?? '');
    if (this.backend) {
      this.lastPosition = this.backend.positionSec();
      this.backend.dispose();
      this.backend = null;
    }
    this.useScript(ctx);
  }

  private events() {
    return {
      onEnded: () => this.onEnded?.(),
      onProblem: (reason: string, error?: unknown) => this.fallBack(reason, error),
    };
  }

  /** The volume lives in whichever place is making the sound: the worklet, or the gain node in front of the speakers. */
  private applyVolume(): void {
    if (!this.ctx || !this.gain) return;
    const inWorklet = this.backend?.handlesVolume === true;
    this.gain.gain.setTargetAtTime(inWorklet ? 1 : this.volume, this.ctx.currentTime, 0.02);
    this.backend?.setVolume(this.volume);
  }
}

/** A side branch off the gain node for measuring levels. What the person hears goes straight on to the speakers, unchanged. */
function makeAnalyser(ctx: AudioContext, gain: GainNode): AnalyserNode | null {
  if (typeof ctx.createAnalyser !== 'function') return null;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0; // levels.ts does its own smoothing
  analyser.minDecibels = -90;
  analyser.maxDecibels = -20;
  gain.connect(analyser);
  return analyser;
}
