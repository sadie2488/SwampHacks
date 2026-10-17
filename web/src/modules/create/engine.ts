// The sound side of Create mode as a small interface, so the logic can be tested with a fake and the real one (Tone.js) stays in one place.
import type { Layer } from './layers';

export interface LoopHooks {
  /** The take starts now: the count-in bar is over. `atMs` is when that is heard, on the page clock (performance.now()). */
  onGo(atMs?: number): void;
  /** A fake engine may invoke this to simulate the user's manual stop; the real engine does not auto-end a take. */
  onPassEnd(atMs?: number): void;
}

export interface LoopEngine {
  /** Make the sound match the layers (notes, instrument, volume, mute, effect) and the loop length. Safe to call often. */
  syncLayers(layers: readonly Layer[], bpm: number, bars: number): void;
  /** Overall volume, 0 to 1. */
  setMasterVolume(volume: number): void;
  /** Start the loop from the top. With countIn the loop is preceded by one bar of clicks and the hooks are called. Restarts if already running. */
  startLoop(opts: { countIn: boolean }, hooks?: LoopHooks): void;
  /** Silence the loop and forget the hooks. */
  stopLoop(): void;
  dispose(): void;
}
