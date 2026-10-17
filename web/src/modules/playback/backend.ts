// The two ways sound can get to the speakers. output.ts picks one and can swap the worklet for the script node if
// the worklet turns out not to work.
import type { LoopRegion, PcmSource } from './stretch-engine';

/** Everything a backend needs to carry on from where the last one was. */
export interface Snapshot {
  source: PcmSource | null;
  tempo: number;
  pitch: number;
  volume: number;
  loop: LoopRegion;
  playing: boolean;
  /** Song seconds. */
  positionSec: number;
}

export interface BackendEvents {
  /** A song that is not looping reached its end. */
  onEnded(): void;
  /** The backend cannot be trusted any more (only the worklet reports this); the owner should switch to the script node. */
  onProblem(reason: string, error?: unknown): void;
}

export interface Backend {
  readonly kind: 'script' | 'worklet';
  /** True when this backend applies the volume itself (the owner then leaves its gain node at 1). */
  readonly handlesVolume: boolean;
  /** Where in the song the sound being heard right now comes from. */
  positionSec(): number;
  loadSource(source: PcmSource): void;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  setTempo(t: number): void;
  setPitch(semitones: number): void;
  setLoop(region: LoopRegion): void;
  setVolume(v: number): void;
  /** The audio device is awake now (the watchdog only counts time the device was running). */
  contextRunning(): void;
  dispose(): void;
}
