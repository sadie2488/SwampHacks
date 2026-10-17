// The clicks of the clap check against a stand-in AudioContext whose clock lags the page clock in whole render blocks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PAGE_MINUS_AUDIO_MS = 7000; // the page clock is 7 s ahead of the audio clock
const BLOCK_SEC = 128 / 48000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  vi.setSystemTime(100_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function load() {
  vi.resetModules();
  const started: Array<{ at: number; hz: number }> = [];
  class FakeContext {
    state = 'running';
    sampleRate = 48000;
    destination = {};
    // like a real one: it only moves in whole render blocks, so a reading is up to one block behind
    get currentTime() {
      const trueSec = (performance.now() - PAGE_MINUS_AUDIO_MS) / 1000;
      return Math.floor(trueSec / BLOCK_SEC) * BLOCK_SEC;
    }
    resume = async () => {};
    createGain() {
      const node = { gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: (n: unknown) => n };
      return node;
    }
    createOscillator() {
      const osc = {
        type: '',
        frequency: { value: 0 },
        connect: () => ({ connect: () => {} }),
        start: (at: number) => started.push({ at, hz: osc.frequency.value }),
        stop: () => {},
      };
      return osc;
    }
  }
  vi.stubGlobal('AudioContext', FakeContext);
  const mod = await import('./browser');
  return { ...mod, started };
}

describe('measuring the page clock against the audio clock', () => {
  it('is within a few ms of the truth even though the audio clock only moves in blocks', async () => {
    const m = await load();
    const ctx = new (globalThis as unknown as { AudioContext: new () => AudioContext }).AudioContext();
    const p = m.measureClockOffsetMs(ctx);
    await vi.advanceTimersByTimeAsync(300);
    const offset = await p;
    expect(offset).toBeGreaterThanOrEqual(PAGE_MINUS_AUDIO_MS);
    expect(offset - PAGE_MINUS_AUDIO_MS).toBeLessThan(3); // a block is 2.7 ms
  });
});

describe('the real clicks', () => {
  it('are six, 60/90 s apart, the first one higher, and reported on the page clock', async () => {
    const m = await load();
    const env = m.browserCalibrationEnv();
    const p = env.startClicks(6, 90, 1);
    await vi.advanceTimersByTimeAsync(300);
    const clicks = await p;
    expect(m.started).toHaveLength(6);
    expect(m.started.map((c) => c.hz)).toEqual([1500, 1000, 1000, 1000, 1000, 1000]);
    for (let k = 1; k < 6; k++) expect(m.started[k].at - m.started[k - 1].at).toBeCloseTo(60 / 90, 9);
    // the first click is 1 s after the moment the audio clock was last read
    const firstAudioSec = m.started[0].at;
    expect(clicks).toHaveLength(6);
    expect(clicks[0]).toBeGreaterThanOrEqual(firstAudioSec * 1000 + PAGE_MINUS_AUDIO_MS);
    expect(clicks[0] - (firstAudioSec * 1000 + PAGE_MINUS_AUDIO_MS)).toBeLessThan(3);
    for (let k = 1; k < 6; k++) expect(clicks[k] - clicks[k - 1]).toBeCloseTo(666.667, 2);
    // and it really is about a second from now
    expect(clicks[0] - performance.now()).toBeGreaterThan(600);
    expect(clicks[0] - performance.now()).toBeLessThan(1000);
  });
});

describe('sleeping', () => {
  it('waits, and gives up early when told to', async () => {
    const m = await load();
    const abort = new AbortController();
    const done = vi.fn();
    void m.sleep(1000, abort.signal).then(done);
    await vi.advanceTimersByTimeAsync(500);
    expect(done).not.toHaveBeenCalled();
    abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledWith(false);
    expect(await m.sleep(10, abort.signal)).toBe(false);
    const ok = m.sleep(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await ok).toBe(true);
  });
});
