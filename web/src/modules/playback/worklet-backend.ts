// The modern way to make sound: the engine runs inside an AudioWorklet (its own thread), so a busy page (camera
// tracking, sheet drawing) cannot make the sound stutter. This side only sends messages and keeps track of the
// position the worklet reports. If the worklet never answers, or says it broke, we tell the owner, which swaps in the
// script node. See worklet-core.ts for what the other end does with each message.
import type { Backend, BackendEvents, Snapshot } from './backend';
import { deviceDelaySec, PositionClock } from './position-clock';
import type { FromWorklet, ToWorklet } from './worklet-core';
import type { LoopRegion, PcmSource } from './stretch-engine';

/** The part of an AudioWorkletNode we use (so tests can stand in for it). */
export interface WorkletNodeLike {
  port: {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    onmessage: ((e: { data: unknown }) => void) | null;
    close?(): void;
  };
  onprocessorerror: ((e: unknown) => void) | null;
  connect(destination: AudioNode): unknown;
  disconnect(): void;
}

export interface WorkletOptions {
  /** How long the worklet may stay silent while the audio device is running before we give up on it (ms). */
  watchdogMs: number;
}

const POLL_MS = 500;
const MAX_AHEAD = 0.3; // seconds a position report may be extrapolated before the next one is due

export class WorkletBackend implements Backend {
  readonly kind = 'worklet' as const;
  readonly handlesVolume = true;

  private readonly clock = new PositionClock();
  private epoch = 0;
  private tempo: number;
  private playing = false;
  private alive = false;
  private disposed = false;
  private lastHeard = Date.now();
  private lastTick = Date.now();
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly node: WorkletNodeLike,
    private readonly ctx: AudioContext,
    snapshot: Snapshot,
    private readonly events: BackendEvents,
    private readonly options: WorkletOptions,
  ) {
    this.tempo = snapshot.tempo;
    node.port.onmessage = (e) => this.onMessage(e.data as FromWorklet);
    node.onprocessorerror = (e) => this.problem('The audio worklet crashed', e);
    this.send({ type: 'tempo', value: snapshot.tempo });
    this.send({ type: 'pitch', value: snapshot.pitch });
    this.send({ type: 'volume', value: snapshot.volume });
    this.send({ type: 'loop', region: snapshot.loop });
    if (snapshot.source) {
      this.loadSource(snapshot.source);
      if (snapshot.positionSec > 0) this.seek(snapshot.positionSec);
      if (snapshot.playing) this.play();
    }
  }

  positionSec(): number {
    return this.clock.read(this.ctx.currentTime - deviceDelaySec(this.ctx));
  }

  loadSource(source: PcmSource): void {
    // Copy once and hand the copy over (a transfer, not a copy per block). The original stays here in case we have to fall back.
    const mono = !source.channels[1] || source.channels[1] === source.channels[0];
    const left = source.channels[0].slice();
    const right = mono ? null : source.channels[1].slice();
    this.epoch++;
    this.playing = false;
    this.clock.reset(0);
    this.send({ type: 'load', epoch: this.epoch, sampleRate: source.sampleRate, left, right }, right ? [left.buffer, right.buffer] : [left.buffer]);
  }

  play(): void {
    this.playing = true;
    this.send({ type: 'play' });
    this.startPolling();
  }
  pause(): void {
    this.playing = false;
    this.send({ type: 'pause' });
    this.stopPolling();
  }
  seek(sec: number): void {
    this.epoch++;
    this.clock.reset(sec);
    this.send({ type: 'seek', epoch: this.epoch, sec });
  }
  setTempo(t: number): void {
    this.tempo = t;
    this.send({ type: 'tempo', value: t });
  }
  setPitch(semitones: number): void {
    this.send({ type: 'pitch', value: semitones });
  }
  setLoop(region: LoopRegion): void {
    this.send({ type: 'loop', region });
  }
  setVolume(v: number): void {
    this.send({ type: 'volume', value: v });
  }

  contextRunning(): void {
    if (this.alive || this.startTimer !== undefined || this.disposed) return;
    this.lastHeard = Date.now();
    this.startTimer = setTimeout(() => {
      this.startTimer = undefined;
      if (!this.alive) this.problem('The audio worklet did not answer');
    }, this.options.watchdogMs);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.startTimer);
    this.stopPolling();
    this.node.port.onmessage = null;
    this.node.onprocessorerror = null;
    try {
      this.node.port.postMessage({ type: 'dispose' } satisfies ToWorklet);
      this.node.port.close?.();
      this.node.disconnect();
    } catch {
      // already gone
    }
  }

  // ---- internals ----
  private send(message: ToWorklet, transfer?: Transferable[]): void {
    if (this.disposed) return;
    this.node.port.postMessage(message, transfer);
  }

  private onMessage(m: FromWorklet): void {
    if (this.disposed) return;
    this.lastHeard = Date.now();
    switch (m.type) {
      case 'ready':
        this.alive = true;
        clearTimeout(this.startTimer);
        this.startTimer = undefined;
        break;
      case 'pos':
        this.alive = true;
        if (m.epoch !== this.epoch) return; // a report from before the last seek or song change
        this.clock.add({ t: m.t, sec: m.sec, rate: m.playing ? this.tempo : 0, maxAhead: MAX_AHEAD });
        break;
      case 'ended':
        if (m.epoch === this.epoch) this.events.onEnded();
        break;
      case 'error':
        this.problem(`The audio worklet reported: ${m.message}`);
        break;
    }
  }

  private problem(reason: string, error?: unknown): void {
    if (this.disposed) return;
    this.events.onProblem(reason, error);
  }

  /** While playing, the worklet must keep reporting; if it goes quiet for too long (and the device is running) it is not working. */
  private startPolling(): void {
    if (this.pollTimer !== undefined) return;
    this.lastHeard = Date.now();
    this.lastTick = Date.now();
    this.pollTimer = setInterval(() => {
      const now = Date.now();
      // If this timer itself ran very late the whole page was stuck, so silence from the worklet proves nothing yet.
      const stalled = now - this.lastTick > POLL_MS * 3;
      this.lastTick = now;
      if (stalled) {
        this.lastHeard = now;
        return;
      }
      if (this.alive && this.ctx.state === 'running' && now - this.lastHeard > this.options.watchdogMs) this.problem('The audio worklet stopped answering');
    }, POLL_MS);
  }

  private stopPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
}
