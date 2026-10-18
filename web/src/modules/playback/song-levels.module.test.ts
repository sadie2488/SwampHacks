// The playback module publishes songLevels on the bus: made-up moving bands in fake mode while playing, zeros after pause.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import twinkleJson from '@fixtures/song-analysis/twinkle.json';
import { bus, reportStatus, resetControls, sendCommand } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { start } from './index';

const twinkle = twinkleJson as unknown as SongAnalysis;
const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0];

class FakeNode {
  gain = { value: 1, setTargetAtTime: (v: number) => void (this.gain.value = v) };
  onaudioprocess: unknown = null;
  connect(): void {}
  disconnect(): void {}
}
class FakeAudioContext {
  sampleRate = 11025;
  currentTime = 0;
  state = 'suspended';
  destination = {};
  createGain = () => new FakeNode();
  createScriptProcessor = () => new FakeNode();
  async resume(): Promise<void> {
    this.state = 'running';
  }
}

let stop: () => void;

beforeAll(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  vi.stubGlobal('location', { search: '?fake=1' }); // the page was opened with ?fake=1
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.useFakeTimers();
  resetControls();
  stop = start();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('playback publishes songLevels', () => {
  it('zeros at first, moving levels while playing, zeros after pause, and no level timer left running', async () => {
    expect(bus.last('songLevels')).toMatchObject({ bands: ZEROS, level: 0 });
    bus.emit('analysis', twinkle);
    const timersIdle = vi.getTimerCount();

    sendCommand('playback.play', 'button');
    await vi.advanceTimersByTimeAsync(0);
    expect(bus.last('transport')?.playing).toBe(true);
    vi.advanceTimersByTime(300);
    const a = bus.last('songLevels')!;
    vi.advanceTimersByTime(300);
    const b = bus.last('songLevels')!;
    expect(a.level).toBeGreaterThan(0);
    expect(a.bands.every((v) => v > 0 && v <= 1)).toBe(true);
    expect(b.bands).not.toEqual(a.bands);

    sendCommand('playback.pause', 'button');
    expect(bus.last('songLevels')).toMatchObject({ bands: ZEROS, level: 0 });
    expect(vi.getTimerCount()).toBe(timersIdle);
    vi.advanceTimersByTime(300);
    expect(bus.last('songLevels')).toMatchObject({ bands: ZEROS, level: 0 });
  });
});

describe('playback follows the TouchDesigner status for hidden tabs', () => {
  it('keeps publishing while hidden when TouchDesigner is on, and stops when it goes idle', async () => {
    let hidden = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal('document', {
      get visibilityState() {
        return hidden ? 'hidden' : 'visible';
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    });
    stop(); // restart so the module sees the pretend document
    stop = start();
    bus.emit('analysis', twinkle);
    reportStatus('touchdesigner', 'error', 'relay not running'); // on, but retrying the relay
    sendCommand('playback.play', 'button');
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(300);
    expect(bus.last('songLevels')!.level).toBeGreaterThan(0);
    reportStatus('touchdesigner', 'idle', 'TouchDesigner is off.');
    expect(bus.last('songLevels')).toMatchObject({ bands: ZEROS, level: 0 });
    vi.advanceTimersByTime(300);
    expect(bus.last('songLevels')).toMatchObject({ bands: ZEROS, level: 0 });
    hidden = false;
    for (const fn of listeners) fn();
    vi.advanceTimersByTime(300);
    expect(bus.last('songLevels')!.level).toBeGreaterThan(0);
    sendCommand('playback.pause', 'button');
    vi.stubGlobal('document', undefined);
  });
});

describe('the analyser tap in the sound path', () => {
  it('hangs off the gain node (after volume) as a side branch; the gain still goes straight to the speakers', async () => {
    const { WebAudioOutput } = await import('./output');
    const links: Array<[string, unknown]> = [];
    const analyser = { fftSize: 0, smoothingTimeConstant: 1, minDecibels: 0, maxDecibels: 0, connect: vi.fn(), disconnect: vi.fn() };
    const destination = {};
    const gain = { gain: { value: 1, setTargetAtTime() {} }, connect: (to: unknown) => links.push(['gain', to]), disconnect() {} };
    const ctx = { sampleRate: 48000, currentTime: 0, state: 'running', destination, createGain: () => gain, createAnalyser: () => analyser, createScriptProcessor: () => new FakeNode() };
    const output = new WebAudioOutput(() => ctx as unknown as AudioContext, async () => {}, { worklet: false });
    expect(output.analyserNode()).toBeNull();
    output.load({ sampleRate: 48000, channels: [new Float32Array(48000)] });
    expect(output.analyserNode()).toBe(analyser);
    expect(links).toEqual([
      ['gain', destination],
      ['gain', analyser],
    ]);
    expect(analyser.connect).not.toHaveBeenCalled(); // nothing comes back out of the tap, so no added delay
    expect(analyser.fftSize).toBe(2048);
    output.dispose();
    expect(analyser.disconnect).toHaveBeenCalled();
    expect(output.analyserNode()).toBeNull();
  });
});
