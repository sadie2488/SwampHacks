// What runs inside the audio worklet, minus the browser-only shell: it takes messages from the page, owns the sound
// engine, fills the speaker blocks, and reports the song position back about 15 times a second.
// It is plain logic (no AudioWorkletProcessor here), so it is tested in Node by driving it by hand.
//
// IMPORTANT: defineWorkletCore() is also copied as TEXT into the audio worklet (see worklet-source.ts). Keep it
// self-contained: no imports at run time, no class fields or "#" names, nothing from outside the function.
import type { CreateEngine, EngineCore, LoopRegion } from './engine-core';

/** Messages the page sends to the worklet. `epoch` goes up each time the song or the position is replaced, so late reports can be told apart. */
export type ToWorklet =
  | { type: 'load'; epoch: number; sampleRate: number; left: Float32Array; right: Float32Array | null }
  | { type: 'tempo'; value: number }
  | { type: 'pitch'; value: number }
  | { type: 'volume'; value: number }
  | { type: 'loop'; region: LoopRegion }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; epoch: number; sec: number }
  | { type: 'dispose' };

/** Messages the worklet sends back. `t` is the audio clock (seconds) at the end of the block the report is about. */
export type FromWorklet =
  | { type: 'ready'; epoch: number; durationSec: number }
  | { type: 'pos'; epoch: number; sec: number; playing: boolean; t: number }
  | { type: 'ended'; epoch: number }
  | { type: 'error'; message: string };

export interface WorkletHost {
  post(message: FromWorklet): void;
  /** Sample rate of the speakers. */
  sampleRate: number;
  /** The audio clock in seconds, at the start of the block being filled. */
  time(): number;
}

export interface WorkletCore {
  handle(message: ToWorklet): void;
  render(left: Float32Array, right: Float32Array, frames: number): void;
}

export type CreateWorkletCore = (host: WorkletHost) => WorkletCore;

export function defineWorkletCore(createEngine: CreateEngine): CreateWorkletCore {
  const REPORTS_PER_SECOND = 15;
  const IDLE_REPORT_SEC = 1; // when nothing is playing, still say hello this often so the page knows we are alive
  const VOLUME_SEC = 0.02;

  return function createCore(host: WorkletHost): WorkletCore {
    const reportEvery = Math.round(host.sampleRate / REPORTS_PER_SECOND);
    const idleEvery = Math.round(host.sampleRate * IDLE_REPORT_SEC);

    let engine: EngineCore | null = null;
    let epoch = 0;
    let tempo = 1;
    let pitch = 0;
    let loop: LoopRegion = null;
    let volumeTarget = 1;
    let volumeNow = 1;
    let sinceReport = 0;
    let reportNow = false;
    let broken = false;

    function report(frames: number): void {
      if (!engine) return;
      sinceReport = 0;
      reportNow = false;
      host.post({ type: 'pos', epoch, sec: engine.positionSec, playing: engine.running, t: host.time() + frames / host.sampleRate });
    }

    function handle(message: ToWorklet): void {
      if (broken) return;
      try {
        switch (message.type) {
          case 'load': {
            epoch = message.epoch;
            const channels = message.right ? [message.left, message.right] : [message.left];
            engine = createEngine({ sampleRate: message.sampleRate, channels }, host.sampleRate);
            engine.setTempo(tempo);
            engine.setPitchSemitones(pitch);
            engine.setLoop(loop);
            engine.onEnded = () => {
              host.post({ type: 'ended', epoch });
              reportNow = true;
            };
            host.post({ type: 'ready', epoch, durationSec: engine.durationSec });
            reportNow = true;
            break;
          }
          case 'tempo':
            tempo = message.value;
            if (engine) engine.setTempo(tempo);
            break;
          case 'pitch':
            pitch = message.value;
            if (engine) engine.setPitchSemitones(pitch);
            break;
          case 'volume':
            volumeTarget = message.value;
            break;
          case 'loop':
            loop = message.region;
            if (engine) engine.setLoop(loop);
            break;
          case 'play':
            if (engine) engine.play();
            reportNow = true;
            break;
          case 'pause':
            if (engine) engine.pause();
            reportNow = true;
            break;
          case 'seek':
            epoch = message.epoch;
            if (engine) engine.seek(message.sec);
            reportNow = true;
            break;
          case 'dispose':
            engine = null;
            break;
        }
      } catch (err) {
        fail(err);
      }
    }

    function fail(err: unknown): void {
      broken = true;
      engine = null;
      host.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }

    function render(left: Float32Array, right: Float32Array, frames: number): void {
      if (!engine || broken) {
        left.fill(0, 0, frames);
        right.fill(0, 0, frames);
        sinceReport += frames;
        if (sinceReport >= idleEvery) {
          sinceReport = 0;
          host.post({ type: 'pos', epoch, sec: 0, playing: false, t: host.time() + frames / host.sampleRate });
        }
        return;
      }
      try {
        engine.render(left, right, frames);
      } catch (err) {
        left.fill(0, 0, frames);
        right.fill(0, 0, frames);
        fail(err);
        return;
      }
      // Volume: glide to the new value so a slider drag has no zipper noise.
      if (volumeNow !== volumeTarget || volumeTarget !== 1) {
        const from = volumeNow;
        const a = 1 - Math.exp(-frames / (host.sampleRate * VOLUME_SEC));
        const to = Math.abs(volumeTarget - from) < 0.0005 ? volumeTarget : from + (volumeTarget - from) * a;
        for (let i = 0; i < frames; i++) {
          const v = from + ((to - from) * (i + 1)) / frames;
          left[i] *= v;
          right[i] *= v;
        }
        volumeNow = to;
      }
      sinceReport += frames;
      if (reportNow || (engine.running ? sinceReport >= reportEvery : sinceReport >= idleEvery)) report(frames);
    }

    return { handle, render };
  };
}
