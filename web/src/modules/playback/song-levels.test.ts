// The level runner: runs only while playing and visible, sends zeros when it stops, reuses its buffers.
import { describe, expect, it } from 'vitest';
import type { SongLevels } from '@/bus';
import { BAND_COUNT, bandBinRanges } from './levels';
import { LEVELS_INTERVAL_MS, analyserSource, createSongLevels, fakeSource, type AnalyserLike } from './song-levels';

const ZEROS = new Array(BAND_COUNT).fill(0);

function setup(opts: { hidden?: boolean } = {}) {
  let now = 0;
  let hidden = opts.hidden ?? false;
  let visibilityFn: (() => void) | null = null;
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const sent: SongLevels[] = [];
  const runner = createSongLevels({
    source: fakeSource(),
    publish: (v) => sent.push(v),
    now: () => now,
    setInterval: (fn, ms) => {
      expect(ms).toBe(LEVELS_INTERVAL_MS);
      timers.set(nextId, fn);
      return nextId++;
    },
    clearInterval: (id) => void timers.delete(id as number),
    isHidden: () => hidden,
    onVisibilityChange: (fn) => {
      visibilityFn = fn;
      return () => (visibilityFn = null);
    },
  });
  /** Let `n` timer ticks happen. */
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += LEVELS_INTERVAL_MS;
      for (const fn of [...timers.values()]) fn();
    }
  };
  const setHidden = (h: boolean) => {
    hidden = h;
    visibilityFn?.();
  };
  return { runner, sent, timers, tick, setHidden, last: () => sent[sent.length - 1] };
}

describe('song levels runner', () => {
  it('starts with zeros and does no work until the song plays', () => {
    const t = setup();
    expect(t.sent).toEqual([{ bands: ZEROS, level: 0, at: 0 }]);
    expect(t.runner.running).toBe(false);
    expect(t.timers.size).toBe(0);
  });

  it('publishes moving non-zero levels while playing, then one frame of zeros and no timer after pause', () => {
    const t = setup();
    t.runner.setPlaying(true);
    expect(t.timers.size).toBe(1);
    t.tick(10);
    const a = t.last();
    t.tick(5);
    const b = t.last();
    expect(a.bands).toHaveLength(BAND_COUNT);
    expect(a.level).toBeGreaterThan(0);
    expect(a.bands.every((v) => v > 0 && v <= 1)).toBe(true);
    expect(b.bands).not.toEqual(a.bands);
    expect(b.at).toBe(15 * LEVELS_INTERVAL_MS);

    const before = t.sent.length;
    t.runner.setPlaying(false);
    expect(t.sent.length).toBe(before + 1);
    expect(t.last()).toMatchObject({ bands: ZEROS, level: 0 });
    expect(t.runner.running).toBe(false);
    expect(t.timers.size).toBe(0);
    t.tick(5);
    t.runner.setPlaying(false); // a repeat pause sends nothing more
    expect(t.sent.length).toBe(before + 1);
  });

  it('never runs while the tab is hidden', () => {
    const t = setup({ hidden: true });
    t.runner.setPlaying(true);
    expect(t.timers.size).toBe(0);
    t.setHidden(false);
    expect(t.timers.size).toBe(1);
    t.tick(3);
    expect(t.last().level).toBeGreaterThan(0);
    t.setHidden(true);
    expect(t.timers.size).toBe(0);
    expect(t.last()).toMatchObject({ bands: ZEROS, level: 0 });
  });

  it('dispose stops the timer and leaves zeros behind', () => {
    const t = setup();
    t.runner.setPlaying(true);
    t.tick(3);
    t.runner.dispose();
    expect(t.timers.size).toBe(0);
    expect(t.last()).toMatchObject({ bands: ZEROS, level: 0 });
  });
});

describe('analyserSource', () => {
  it('reads the real analyser into bands and a level, reusing the same buffers every frame', () => {
    const bins = 1024;
    const r = bandBinRanges(48000, bins);
    const byteBuffers = new Set<Uint8Array>();
    const sampleBuffers = new Set<Float32Array>();
    const node: AnalyserLike = {
      frequencyBinCount: bins,
      fftSize: bins * 2,
      context: { sampleRate: 48000 },
      getByteFrequencyData(out) {
        byteBuffers.add(out);
        out.fill(0);
        out.fill(255, r[0], r[1]); // only the lowest band (20-60 Hz) is loud
      },
      getFloatTimeDomainData(out) {
        sampleBuffers.add(out);
        out.fill(0.5);
      },
    };
    let connected: AnalyserLike | null = null;
    const source = analyserSource(() => connected);
    const out = new Float32Array(BAND_COUNT).fill(9);
    expect(source.read(out, 0)).toBe(0); // no song yet: nothing to read
    expect(Array.from(out)).toEqual(ZEROS);

    connected = node;
    for (let i = 0; i < 5; i++) {
      const level = source.read(out, i * 33);
      expect(level).toBeGreaterThan(0.85);
    }
    expect(Array.from(out)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(byteBuffers.size).toBe(1);
    expect(sampleBuffers.size).toBe(1);
  });
});
