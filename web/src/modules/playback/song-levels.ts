// Publishes the playing song's levels (levels.ts) about 30 times a second, ONLY while the song plays and the tab is visible.
// On pause, stop, or a hidden tab: one frame of zeros, then the timer stops, so nothing runs while idle.
// Where the readings come from is a "source": the real one taps the AnalyserNode after the volume stage (output.ts);
// fake mode (?fake=1) uses made-up bands that move gently, so the visuals can be tried without sound.
import type { SongLevels } from '@/bus';
import { BAND_COUNT, LevelMeter, bandBinRanges, bandsFromBytes, fakeBands, levelFromSamples } from './levels';

export const LEVELS_INTERVAL_MS = 33;

/** Fills `out` with raw band readings (0 to 1) and returns the raw overall level. */
export interface LevelSource {
  read(out: Float32Array, nowMs: number): number;
}

/** The part of an AnalyserNode we use (tests pass a pretend one). */
export interface AnalyserLike {
  readonly frequencyBinCount: number;
  readonly fftSize: number;
  readonly context: { readonly sampleRate: number };
  getByteFrequencyData(out: Uint8Array): void;
  getFloatTimeDomainData(out: Float32Array): void;
}

/** Reads a real analyser. The buffers are made once per analyser and reused every frame. */
export function analyserSource(getNode: () => AnalyserLike | null): LevelSource {
  let node: AnalyserLike | null = null;
  let bytes = new Uint8Array(0);
  let samples = new Float32Array(0);
  let ranges: Int32Array = new Int32Array(0);
  return {
    read(out) {
      const n = getNode();
      if (!n) {
        out.fill(0);
        return 0;
      }
      if (n !== node) {
        node = n;
        bytes = new Uint8Array(n.frequencyBinCount);
        samples = new Float32Array(n.fftSize);
        ranges = bandBinRanges(n.context.sampleRate, n.frequencyBinCount);
      }
      n.getByteFrequencyData(bytes);
      bandsFromBytes(bytes, ranges, out);
      n.getFloatTimeDomainData(samples);
      return levelFromSamples(samples);
    },
  };
}

/** Made-up bands for fake mode and tests. */
export const fakeSource = (): LevelSource => ({ read: (out, nowMs) => fakeBands(nowMs / 1000, out) });

export interface SongLevelsDeps {
  source: LevelSource;
  publish: (levels: SongLevels) => void;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  isHidden: () => boolean;
  /** Call `fn` whenever the tab is shown or hidden; returns a function that stops listening. */
  onVisibilityChange: (fn: () => void) => () => void;
}

export function createSongLevels(deps: SongLevelsDeps) {
  const meter = new LevelMeter();
  const raw = new Float32Array(BAND_COUNT);
  let playing = false;
  let timer: unknown = null;
  let lastAt = 0;

  const zeros = () => deps.publish({ bands: new Array<number>(BAND_COUNT).fill(0), level: 0, at: deps.now() });

  function tick(): void {
    const now = deps.now();
    const rawLevel = deps.source.read(raw, now);
    meter.push(raw, rawLevel, now - lastAt);
    lastAt = now;
    deps.publish({ bands: Array.from(meter.bands, r3), level: r3(meter.level), at: now });
  }

  /** Start or stop the timer to match "playing and visible". Stopping publishes one frame of zeros. */
  function sync(): void {
    const run = playing && !deps.isHidden();
    if (run && timer === null) {
      meter.reset();
      lastAt = deps.now();
      timer = deps.setInterval(tick, LEVELS_INTERVAL_MS);
    } else if (!run && timer !== null) {
      deps.clearInterval(timer);
      timer = null;
      meter.reset();
      zeros();
    }
  }

  const stopVisibility = deps.onVisibilityChange(sync);
  zeros();

  return {
    setPlaying(on: boolean): void {
      if (on === playing) return;
      playing = on;
      sync();
    },
    /** True while the timer is running (for tests). */
    get running(): boolean {
      return timer !== null;
    },
    dispose(): void {
      stopVisibility();
      playing = false;
      sync();
    },
  };
}
export type SongLevelsRunner = ReturnType<typeof createSongLevels>;

/** Three decimals is plenty for visuals and keeps the TouchDesigner frames small. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;
