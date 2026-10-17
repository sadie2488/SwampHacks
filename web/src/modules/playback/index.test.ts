// The whole module through the real bus, with a pretend AudioContext that we drive by hand
// (the way the browser would call the script node once per block of sound).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import twinkleJson from '@fixtures/song-analysis/twinkle.json';
import { bus, resetControls, sendCommand, type TransportState } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { seek, start } from './index';
import { rms, sine, zeroCrossingFreq } from './test-utils';

const SR = 11025;
const BLOCK = 4096;
const twinkle = twinkleJson as unknown as SongAnalysis;

class FakeParam {
  value = 1;
  setTargetAtTime(v: number): void {
    this.value = v;
  }
}
class FakeNode {
  gain = new FakeParam();
  onaudioprocess: ((e: unknown) => void) | null = null;
  connected = true;
  connect(): void {}
  disconnect(): void {
    this.connected = false;
  }
}
class FakeAudioContext {
  static last: FakeAudioContext;
  sampleRate = SR;
  currentTime = 0;
  state = 'suspended';
  destination = {};
  script = new FakeNode();
  gainNode = new FakeNode();
  constructor() {
    FakeAudioContext.last = this;
  }
  createGain() {
    return this.gainNode;
  }
  createScriptProcessor() {
    return this.script;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
}

/** Ask the module for this many blocks of sound, the way the browser would. Returns the left channel. */
function pump(blocks: number): Float32Array {
  const ctx = FakeAudioContext.last;
  const out = new Float32Array(blocks * BLOCK);
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    ctx.script.onaudioprocess?.({ outputBuffer: { numberOfChannels: 2, getChannelData: (i: number) => (i === 0 ? l : r) } });
    out.set(l, b * BLOCK);
  }
  return out;
}

/** The latest published position (waits for the next 15-per-second update first). */
const livePos = () => {
  vi.advanceTimersByTime(70);
  return now().positionSec;
};
const flush = () => vi.advanceTimersByTimeAsync(0);

let stop: () => void;
let seen: TransportState[];
let stopWatching: () => void;
const now = () => seen[seen.length - 1];

beforeAll(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});
beforeEach(() => {
  vi.useFakeTimers();
  resetControls();
  seen = [];
  stopWatching = bus.on('transport', (t) => seen.push(t));
  stop = start();
});
afterEach(() => {
  stop();
  stopWatching();
  vi.useRealTimers();
});

describe('playback module on the bus', () => {
  it('says it is empty at first, then loads the demo song when its analysis arrives, with no audio file', () => {
    expect(now()).toMatchObject({ loaded: false, playing: false });
    bus.emit('analysis', twinkle);
    expect(now()).toMatchObject({ loaded: true, songId: 'demo-twinkle', playing: false, positionSec: 0, tempo: 1, pitch: 0, volume: 0.8, loop: false });
    expect(now().durationSec).toBeCloseTo(28.8, 1);
    expect(bus.last('status')).toMatchObject({ module: 'playback', state: 'running' });
  });

  it('play, speed change, pause and resume with sound that really comes out', async () => {
    bus.emit('analysis', twinkle);
    sendCommand('playback.play', 'button');
    await flush();
    expect(now().playing).toBe(true);
    expect(FakeAudioContext.last.state).toBe('running'); // the module woke the audio device

    const first = pump(6);
    expect(rms(first, BLOCK, first.length)).toBeGreaterThan(0.02);
    const p1 = now().positionSec;
    vi.advanceTimersByTime(70);
    const secondsPlayed = (6 * BLOCK) / SR;
    expect(now().positionSec).toBeGreaterThan(secondsPlayed - 0.3);
    expect(now().positionSec).toBeLessThan(secondsPlayed + 0.1);
    expect(now().positionSec).toBeGreaterThanOrEqual(p1);

    // faster, while playing: no restart, no jump back
    sendCommand('playback.tempo', 'button', { how: 'set', value: 1.5 });
    expect(now()).toMatchObject({ playing: true, tempo: 1.5 });
    expect(now().bpm).toBeCloseTo(150, 6);
    const before = now().positionSec;
    pump(4);
    vi.advanceTimersByTime(70);
    const moved = now().positionSec - before;
    expect(moved).toBeGreaterThan(((4 * BLOCK) / SR) * 1.5 * 0.85);
    expect(moved).toBeLessThan(((4 * BLOCK) / SR) * 1.5 * 1.1);

    // pause freezes it and goes quiet; play carries on from the same place
    sendCommand('playback.toggle', 'button');
    expect(now().playing).toBe(false);
    pump(1);
    const frozen = now().positionSec;
    const quiet = pump(3);
    expect(rms(quiet)).toBe(0);
    expect(now().positionSec).toBe(frozen);
    sendCommand('playback.play', 'button');
    pump(2);
    expect(now().positionSec).toBeGreaterThan(frozen);
    expect(now().positionSec).toBeLessThan(frozen + 2);
  });

  it('publishes about 15 times a second while playing and stays quiet when paused', async () => {
    bus.emit('analysis', twinkle);
    sendCommand('playback.play', 'button');
    await flush();
    seen.length = 0;
    vi.advanceTimersByTime(1000);
    expect(seen.length).toBeGreaterThanOrEqual(14);
    expect(seen.length).toBeLessThanOrEqual(16);
    sendCommand('playback.pause', 'button');
    seen.length = 0;
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(0);
  });

  it('loops inside a section, and stops and rewinds at the end of a song that is not looping', async () => {
    bus.emit('analysis', twinkle);
    sendCommand('playback.loop_section', 'button', { how: 'set', value: [2, 4] });
    sendCommand('playback.loop', 'button', { how: 'set', value: true });
    expect(now()).toMatchObject({ loop: true, loopSection: [2, 4] });
    seek(2);
    sendCommand('playback.play', 'button');
    await flush();
    for (let i = 0; i < 12; i++) {
      pump(1);
      expect(now().positionSec).toBeGreaterThan(1.9);
      expect(now().positionSec).toBeLessThan(4.1);
    }
    expect(now().playing).toBe(true);

    sendCommand('playback.loop', 'button', { how: 'set', value: false });
    seek(28.3);
    pump(3);
    expect(now()).toMatchObject({ playing: false, positionSec: 0 });
    seek(0);
  });

  it('plays an uploaded song from its decoded audio, and pitch and tempo change independently end to end', async () => {
    const tone = sine(440, 8, SR);
    const buffer = { sampleRate: SR, numberOfChannels: 2, length: tone.length, getChannelData: () => tone } as unknown as AudioBuffer;
    bus.emit('analysis', { ...twinkle, song_id: 'upload-9', source: { kind: 'upload', file_name: 'tone.wav' } });
    expect(now()).toMatchObject({ loaded: false, songId: 'upload-9' });
    bus.emit('songAudio', { songId: 'upload-9', buffer, fileName: 'tone.wav' });
    expect(now()).toMatchObject({ loaded: true, songId: 'upload-9' });
    expect(now().durationSec).toBeCloseTo(8, 2);

    sendCommand('playback.pitch', 'button', { how: 'set', value: 12 });
    sendCommand('playback.play', 'button');
    await flush();
    pump(3); // let the pitch glide settle
    const audio = pump(2);
    const hz = zeroCrossingFreq(audio, SR, 0, audio.length);
    expect(hz).toBeGreaterThan(880 * 0.99);
    expect(hz).toBeLessThan(880 * 1.01);
    const pos = livePos();
    sendCommand('playback.pitch', 'button', { how: 'set', value: 0 });
    sendCommand('playback.tempo', 'button', { how: 'set', value: 0.5 });
    pump(4);
    const audio2 = pump(2);
    const hz2 = zeroCrossingFreq(audio2, SR, 0, audio2.length);
    expect(hz2).toBeGreaterThan(440 * 0.99);
    expect(hz2).toBeLessThan(440 * 1.01);
    const moved = livePos() - pos;
    expect(moved).toBeGreaterThan(((6 * BLOCK) / SR) * 0.5 * 0.8); // half speed: about half a second of song per second played
    expect(moved).toBeLessThan(((6 * BLOCK) / SR) * 0.5 * 1.2);
  });

  it('does nothing after it is stopped', async () => {
    bus.emit('analysis', twinkle);
    stop();
    seen.length = 0;
    sendCommand('playback.play', 'button');
    await flush();
    expect(seen).toHaveLength(0);
    expect(FakeAudioContext.last.script.connected).toBe(false);
    stop = start(); // so afterEach has something to stop
  });
});

describe('playback module and the mode', () => {
  afterEach(() => bus.emit('mode', 'learn')); // the bus keeps the last mode between tests

  /** Start a song playing in the given mode and let it run for a moment. */
  async function playingIn(mode: 'learn' | 'play' | 'create') {
    bus.emit('mode', mode);
    bus.emit('analysis', twinkle);
    sendCommand('playback.play', 'button');
    await flush();
    pump(4);
    expect(livePos()).toBeGreaterThan(0.5);
    expect(now().playing).toBe(true);
  }

  it('pauses a playing song when the mode switches to create, and keeps the position', async () => {
    await playingIn('learn');
    seen.length = 0;
    bus.emit('mode', 'create');
    expect(now().playing).toBe(false); // the new state was published right away
    const frozen = now().positionSec;
    expect(frozen).toBeGreaterThan(0.5);
    pump(1);
    expect(rms(pump(3))).toBe(0); // quiet, so nothing bleeds into the microphone
    vi.advanceTimersByTime(1000);
    expect(seen.every((t) => !t.playing && t.positionSec === frozen)).toBe(true);

    // back in Learn: still paused at the same place, and play carries on from there
    bus.emit('mode', 'learn');
    expect(now()).toMatchObject({ playing: false, positionSec: frozen });
    sendCommand('playback.play', 'button');
    pump(2);
    expect(now().playing).toBe(true);
    expect(now().positionSec).toBeGreaterThan(frozen);
    expect(now().positionSec).toBeLessThan(frozen + 2);
  });

  it('also pauses when the switch to create comes from play mode', async () => {
    await playingIn('play');
    bus.emit('mode', 'create');
    expect(now().playing).toBe(false);
  });

  it('does nothing when the song is already paused', async () => {
    bus.emit('mode', 'learn');
    bus.emit('analysis', twinkle);
    seek(3);
    const count = seen.length;
    bus.emit('mode', 'create');
    expect(seen).toHaveLength(count); // no pause, no extra transport message
    expect(now()).toMatchObject({ playing: false, positionSec: 3 });
  });

  it('keeps playing when the mode moves between learn and play', async () => {
    await playingIn('learn');
    bus.emit('mode', 'play');
    expect(now().playing).toBe(true);
    bus.emit('mode', 'learn');
    expect(now().playing).toBe(true);
    pump(2);
    expect(rms(pump(2))).toBeGreaterThan(0.02);
  });

  it('does not start the song again when the user leaves create', async () => {
    await playingIn('learn');
    bus.emit('mode', 'create');
    expect(now().playing).toBe(false);
    for (const mode of ['learn', 'play', 'learn'] as const) {
      bus.emit('mode', mode);
      await flush();
      expect(now().playing).toBe(false);
    }
    pump(1);
    expect(rms(pump(3))).toBe(0);
  });

  it('ignores the mode it is told about when it starts, and a repeat of the mode it is already in', async () => {
    stop();
    bus.emit('mode', 'create'); // the shell was already in Create before this module started
    stop = start();
    bus.emit('analysis', twinkle);
    expect(now().playing).toBe(false);
    sendCommand('playback.play', 'button'); // e.g. a play command in Create from somewhere else
    await flush();
    expect(now().playing).toBe(true); // the replayed mode did not pause anything
    bus.emit('mode', 'create'); // still Create: not a change
    expect(now().playing).toBe(true);
  });

  it('stops listening to the mode after it is stopped', async () => {
    await playingIn('learn');
    stop();
    seen.length = 0;
    bus.emit('mode', 'create');
    expect(seen).toHaveLength(0);
    stop = start(); // so afterEach has something to stop
  });
});
