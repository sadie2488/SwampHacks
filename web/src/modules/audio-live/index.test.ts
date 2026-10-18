// The module as the rest of the app sees it: bus events in, bus events out. The browser pieces (microphone, audio
// context, speech recognition) are replaced by small stand-ins so this can run in Node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleStatus, PitchFrame } from '@/bus';
import type { PerformanceEvent, Signal } from '@/contracts';
import { signalCatalog } from '@/contracts/catalogs';
import { clapSound, concat, mix, silence, sine, voice } from './test-signals';

const SR = 48000;
const STATUS_FAKE = 'Using made-up microphone data (fake mode)';

// ---- stand-ins for the browser ----
let signalSource: Float32Array = new Float32Array(0);
let analyserCreated = 0;
const workletNodes: Array<{ port: { onmessage: ((e: { data: Float32Array }) => void) | null } }> = [];
const ctxStub = {
  sampleRate: SR,
  state: 'running',
  currentTime: 0,
  destination: {},
  resume: async () => {},
  audioWorklet: undefined as undefined | { addModule: ReturnType<typeof vi.fn> },
  createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
  createGain: () => ({ gain: { value: 1 }, connect: (n: unknown) => n, disconnect: () => {} }),
  createAnalyser: () => {
    analyserCreated++;
    return {
      fftSize: 2048,
      smoothingTimeConstant: 0,
      connect: () => {},
      disconnect: () => {},
      // the newest samples, as the real AnalyserNode would give them: the last fftSize samples before "now"
      getFloatTimeDomainData: (out: Float32Array) => {
        for (let i = 0; i < out.length; i++) out[i] = signalSource[Math.round(ctxStub.currentTime * SR) - (out.length - i)] ?? 0;
      },
    };
  },
};

class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  abort = vi.fn();
  constructor() {
    FakeRecognizer.instances.push(this);
  }
  say(text: string, index = 0) {
    this.onresult?.({ resultIndex: index, results: Object.assign([], { [index]: [{ transcript: text }] }, { length: index + 1 }) });
  }
}

function makeStream() {
  const track = { stop: vi.fn(), onended: null as null | (() => void) };
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } };
}

/** Load a fresh copy of the module and the bus, with a log of everything published. */
async function load(opts: { fake?: boolean } = {}) {
  vi.resetModules();
  vi.stubGlobal('location', { search: opts.fake ? '?fake=1' : '' });
  vi.stubGlobal('AudioContext', class { constructor() { return ctxStub; } });
  const getUserMedia = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  const busModule = await import('@/bus');
  const mod = await import('./index');
  const log = { status: [] as ModuleStatus[], signals: [] as Signal[], pitch: [] as PitchFrame[], performance: [] as PerformanceEvent[] };
  busModule.bus.on('status', (s) => log.status.push(s));
  busModule.bus.on('signal', (s) => log.signals.push(s));
  busModule.bus.on('pitch', (p) => log.pitch.push(p));
  busModule.bus.on('performance', (p) => log.performance.push(p));
  const enable = (on: boolean, module: 'audio-live' | 'vision' = 'audio-live') => busModule.bus.emit('enable', { module, on });
  const fist = (state: 'start' | 'end') => busModule.sendSignal({ id: 'vision.hand.left.fist', kind: 'moment', state });
  return { ...busModule, ...mod, log, getUserMedia, enable, fist };
}

/** Let time pass: audio time, timers and promises together, in 20 ms steps. */
async function pass(seconds: number) {
  for (let i = 0; i < Math.round(seconds / 0.02); i++) {
    ctxStub.currentTime += 0.02;
    await vi.advanceTimersByTimeAsync(20);
  }
}
const lastMessage = (log: { status: ModuleStatus[] }) => log.status[log.status.length - 1];
const ids = (signals: Signal[], id: string) => signals.filter((s) => s.id === id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  ctxStub.currentTime = 0;
  ctxStub.state = 'running';
  ctxStub.audioWorklet = undefined;
  signalSource = new Float32Array(0);
  analyserCreated = 0;
  workletNodes.length = 0;
  FakeRecognizer.instances = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the module waits for the user', () => {
  it('does not open the microphone just because it started', async () => {
    const m = await load();
    const stop = m.start();
    await pass(0.5);
    expect(m.getUserMedia).not.toHaveBeenCalled();
    expect(m.log.status).toEqual([]);
    stop();
  });

  it('ignores enable events meant for other modules', async () => {
    const m = await load();
    m.start();
    m.enable(true, 'vision');
    await pass(0.1);
    expect(m.getUserMedia).not.toHaveBeenCalled();
    expect(m.log.status).toEqual([]);
  });
});

describe('real microphone (stand-in browser)', () => {
  const hum = () => concat(silence(0.5, SR), voice([[1.0, 69]], SR), silence(0.5, SR));

  async function enabled(extra: (m: Awaited<ReturnType<typeof load>>) => void = () => {}) {
    const m = await load();
    const { stream, track } = makeStream();
    m.getUserMedia.mockResolvedValue(stream);
    extra(m);
    m.start();
    m.enable(true);
    await pass(0.04);
    return { m, track };
  }

  it('asks for the mic with echo cancelling, noise removal and auto-volume all off', async () => {
    const { m } = await enabled();
    expect(m.getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    expect(m.log.status.map((s) => s.state).slice(0, 2)).toEqual(['starting', 'running']);
  });

  it('with the polling fallback: publishes pitch, loudness and the hum slider, then shuts everything down', async () => {
    signalSource = hum();
    const { m, track } = await enabled();
    expect(analyserCreated).toBe(1);
    await pass(2);
    const voiced = m.log.pitch.filter((p) => p.midi !== null);
    expect(voiced.length).toBeGreaterThan(40);
    for (const p of voiced) expect(Math.abs(p.midi! - 69)).toBeLessThan(0.6);
    const humSignals = ids(m.log.signals, 'audio.hum.pitch');
    expect(humSignals.length).toBeGreaterThan(10);
    expect(humSignals[0].value).toBeCloseTo((69 - 36) / 60, 1);
    expect(Math.abs(humSignals[0].raw! - 69)).toBeLessThan(0.6);
    const loud = ids(m.log.signals, 'audio.loudness');
    expect(loud.length).toBeGreaterThan(30);
    expect(Math.max(...loud.map((s) => s.value!))).toBeGreaterThan(0.3);
    expect(m.log.performance.filter((e) => e.type === 'note').map((e) => e.pitch)).toEqual([69]);

    m.enable(false);
    expect(track.stop).toHaveBeenCalled();
    expect(lastMessage(m.log)).toMatchObject({ module: 'audio-live', state: 'idle' });
    const frames = m.log.pitch.length;
    await pass(0.5);
    expect(m.log.pitch.length).toBe(frames);
  });

  it('hears a clap through the whole chain', async () => {
    signalSource = mix(concat(silence(0.6, SR), silence(1.5, SR)), clapSound({ seconds: 2.1, at: 1.0, sr: SR }));
    const { m } = await enabled();
    await pass(2);
    expect(ids(m.log.signals, 'audio.clap').length).toBe(1);
    expect(ids(m.log.signals, 'audio.snap').length).toBe(0);
    expect(ids(m.log.signals, 'audio.onset').length).toBe(1);
    expect(ids(m.log.signals, 'audio.clap')[0].state).toBe('start');
  });

  it('hears a double clap through the whole chain, and is stricter while the song plays', async () => {
    const twoClaps = (seconds: number, at: number, amp?: number) =>
      mix(silence(seconds, SR), clapSound({ seconds, at, sr: SR, amp }), clapSound({ seconds, at: at + 0.4, sr: SR, amp, seed: 9 }));
    // two fairly quiet claps (peak about 0.05): heard while the song is stopped ...
    signalSource = twoClaps(2.1, 1.0, 0.15);
    const { m } = await enabled();
    await pass(2);
    expect(ids(m.log.signals, 'audio.clap').length).toBe(2);
    expect(ids(m.log.signals, 'audio.clap.double').map((s) => [s.kind, s.state])).toEqual([['moment', 'start']]);
    m.enable(false);

    // ... but ignored while it plays (they need a peak of 0.064 then)
    const loaded = await load();
    const { stream } = makeStream();
    loaded.getUserMedia.mockResolvedValue(stream);
    loaded.bus.emit('transport', { loaded: true, playing: true, positionSec: 0, durationSec: 10, tempo: 1, pitch: 0, volume: 1, loop: false, loopSection: null });
    loaded.start();
    loaded.enable(true);
    await pass(2.04);
    expect(ids(loaded.log.signals, 'audio.clap')).toEqual([]);
    expect(ids(loaded.log.signals, 'audio.clap.double')).toEqual([]);
  });

  it('only publishes signals that are in the catalog, with the right kind and sane values', async () => {
    signalSource = mix(hum(), clapSound({ seconds: 2.1, at: 1.9, sr: SR }));
    const { m } = await enabled();
    await pass(2.2);
    const known = new Map(signalCatalog.signals.map((s) => [s.id, s.kind]));
    expect(m.log.signals.length).toBeGreaterThan(50);
    for (const s of m.log.signals) {
      expect(known.get(s.id), s.id).toBe(s.kind);
      expect(s.version).toBe(1);
      expect(s.t_ms).toBeGreaterThanOrEqual(0);
      if (s.kind === 'slider') {
        expect(s.value).toBeGreaterThanOrEqual(0);
        expect(s.value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('with the audio worklet: takes samples from it and does not need the polling fallback', async () => {
    const { m } = await enabled((mm) => {
      void mm;
      ctxStub.audioWorklet = { addModule: vi.fn(async () => {}) };
      vi.stubGlobal(
        'AudioWorkletNode',
        class {
          port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
          constructor() {
            workletNodes.push(this);
          }
          connect(n: unknown) {
            return n;
          }
          disconnect() {}
        },
      );
    });
    expect(ctxStub.audioWorklet!.addModule).toHaveBeenCalledTimes(1);
    expect(workletNodes.length).toBe(1);
    const tone = sine(440, 1, SR, 0.3);
    for (let i = 0; i + 512 <= tone.length; i += 512) workletNodes[0].port.onmessage!({ data: tone.slice(i, i + 512) });
    const voiced = m.log.pitch.filter((p) => p.midi !== null);
    expect(voiced.length).toBeGreaterThan(40);
    expect(Math.abs(voiced[10].midi! - 69)).toBeLessThan(0.1);
    await pass(2); // longer than the watchdog: it must not switch to polling because data did arrive
    expect(analyserCreated).toBe(0);
  });

  it('falls back to polling if the worklet sends nothing', async () => {
    signalSource = voice([[5, 69]], SR);
    const { m } = await enabled(() => {
      ctxStub.audioWorklet = { addModule: vi.fn(async () => {}) };
      vi.stubGlobal(
        'AudioWorkletNode',
        class {
          port = { onmessage: null };
          connect(n: unknown) {
            return n;
          }
          disconnect() {}
        },
      );
    });
    expect(analyserCreated).toBe(0);
    await pass(3);
    expect(analyserCreated).toBe(1);
    expect(m.log.pitch.filter((p) => p.midi !== null).length).toBeGreaterThan(20);
  });

  it('says in plain words when the microphone is blocked, and lets the user try again', async () => {
    const m = await load();
    m.getUserMedia.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    m.start();
    m.enable(true);
    await pass(0.04);
    expect(lastMessage(m.log)).toEqual({ module: 'audio-live', state: 'error', message: 'Microphone permission was blocked: click the lock icon in the address bar and allow it' });
    const { stream } = makeStream();
    m.getUserMedia.mockResolvedValueOnce(stream);
    m.enable(true);
    await pass(0.04);
    expect(m.getUserMedia).toHaveBeenCalledTimes(2);
    expect(m.log.status.some((s) => s.state === 'running')).toBe(true);
  });

  it('explains the other things that can go wrong', async () => {
    const { micErrorMessage } = await load();
    expect(micErrorMessage({ name: 'NotFoundError' })).toMatch(/No microphone was found/);
    expect(micErrorMessage({ name: 'NotReadableError' })).toMatch(/busy/);
    expect(micErrorMessage(new Error('weird'))).toMatch(/could not start/);
    expect(micErrorMessage(undefined)).toMatch(/could not start/);
  });

  it('reports an error when the page has no microphone support at all', async () => {
    const m = await load();
    vi.stubGlobal('navigator', {});
    m.start();
    m.enable(true);
    await pass(0.04);
    expect(lastMessage(m.log).state).toBe('error');
    expect(lastMessage(m.log).message).toMatch(/localhost/);
  });

  it('lets go of the microphone if it is switched off while permission is still being asked', async () => {
    const m = await load();
    const { stream, track } = makeStream();
    let allow!: (s: unknown) => void;
    m.getUserMedia.mockReturnValue(new Promise((r) => (allow = r)));
    m.start();
    m.enable(true);
    await pass(0.04);
    m.enable(false);
    allow(stream);
    await pass(0.1);
    expect(track.stop).toHaveBeenCalled();
    expect(m.log.pitch).toEqual([]);
    expect(lastMessage(m.log).state).toBe('idle');
  });

  it('reports an error if the microphone disappears', async () => {
    const { m, track } = await enabled();
    track.onended!();
    expect(lastMessage(m.log).state).toBe('error');
    expect(lastMessage(m.log).message).toMatch(/unplugged/);
  });

  it('the returned stop function turns everything off', async () => {
    signalSource = hum();
    const m = await load();
    const { stream, track } = makeStream();
    m.getUserMedia.mockResolvedValue(stream);
    const stop = m.start();
    m.enable(true);
    await pass(0.5);
    stop();
    expect(track.stop).toHaveBeenCalled();
    const frames = m.log.pitch.length;
    m.enable(true); // nobody is listening any more
    await pass(0.5);
    expect(m.log.pitch.length).toBe(frames);
  });
});

describe('spoken keywords (stand-in speech recogniser)', () => {
  async function ready(opts: { speech?: boolean; fistFirst?: boolean } = {}) {
    if (opts.speech !== false) vi.stubGlobal('webkitSpeechRecognition', FakeRecognizer);
    const m = await load();
    const { stream } = makeStream();
    m.getUserMedia.mockResolvedValue(stream);
    m.start();
    if (opts.fistFirst) m.fist('start');
    m.enable(true);
    await pass(0.1);
    return m;
  }
  const DISARMED = 'Keywords off: hold your left fist to give voice commands';
  const ARMED = 'Listening for commands (fist held)';

  it('stays quiet and says how to turn voice commands on', async () => {
    const m = await ready();
    expect(lastMessage(m.log)).toEqual({ module: 'audio-live', state: 'running', message: DISARMED });
    expect(FakeRecognizer.instances.length).toBe(0); // not even created until the fist closes
  });

  it('listens only while the left fist is held, in English with interim results', async () => {
    const m = await ready();
    m.fist('start');
    const rec = FakeRecognizer.instances[0];
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect([rec.continuous, rec.interimResults, rec.lang]).toEqual([true, true, 'en-US']);
    expect(lastMessage(m.log).message).toBe(ARMED);

    rec.say('play');
    expect(ids(m.log.signals, 'audio.keyword.play')).toHaveLength(1);
    expect(ids(m.log.signals, 'audio.keyword.play')[0]).toMatchObject({ kind: 'moment', state: 'start' });
    rec.say('play the song'); // the same sentence growing: not a second "play"
    expect(ids(m.log.signals, 'audio.keyword.play')).toHaveLength(1);
    await pass(1);
    rec.say('slower', 1);
    expect(ids(m.log.signals, 'audio.keyword.slower')).toHaveLength(1);

    m.fist('end');
    expect(rec.abort).toHaveBeenCalled();
    expect(lastMessage(m.log).message).toBe(DISARMED);
    await pass(1);
    rec.say('faster', 2);
    rec.say('pause', 3);
    expect(ids(m.log.signals, 'audio.keyword.faster')).toHaveLength(0);
    expect(ids(m.log.signals, 'audio.keyword.pause')).toHaveLength(0);
  });

  it('knows all six words and ignores other speech', async () => {
    const m = await ready({ fistFirst: true });
    const rec = FakeRecognizer.instances[0];
    expect(rec.start).toHaveBeenCalledTimes(1); // the fist was already closed when the mic came on
    expect(lastMessage(m.log).message).toBe(ARMED);
    for (const [i, w] of ['play', 'pause', 'slower', 'faster', 'higher', 'lower'].entries()) rec.say(`please ${w}`, i);
    rec.say('nice weather today', 6);
    const words = m.log.signals.filter((s) => s.id.startsWith('audio.keyword.')).map((s) => s.id);
    expect(words).toEqual(['play', 'pause', 'slower', 'faster', 'higher', 'lower'].map((w) => `audio.keyword.${w}`));
  });

  it('starts listening again by itself when the browser ends a session while the fist is still held', async () => {
    const m = await ready();
    m.fist('start');
    const rec = FakeRecognizer.instances[0];
    rec.onend!();
    await pass(0.5);
    expect(rec.start).toHaveBeenCalledTimes(2);
    m.fist('end');
    rec.onend!();
    await pass(0.5);
    expect(rec.start).toHaveBeenCalledTimes(2);
  });

  it('in Create, without the fist, only a word said on its own counts; with the fist any phrase does (its first word)', async () => {
    const m = await ready();
    m.bus.emit('mode', 'create');
    const rec = FakeRecognizer.instances[0];
    expect(rec.start).toHaveBeenCalledTimes(1); // Create listens without the fist
    const heard = () => m.log.signals.filter((s) => s.id.startsWith('audio.keyword.')).map((s) => s.id);
    rec.say("let's start", 0);
    rec.say("next I'll add drums", 1);
    rec.say('none of this is ready', 2);
    expect(heard()).toEqual([]);
    rec.say('start', 3);
    expect(heard()).toEqual(['audio.keyword.start']);
    await pass(1);
    m.fist('start');
    rec.say("next I'll add drums", 4);
    expect(heard()).toEqual(['audio.keyword.start', 'audio.keyword.next']); // one phrase = one command
  });

  it('keeps retrying after a network error and says when it is listening again', async () => {
    const m = await ready();
    m.bus.emit('mode', 'create');
    const rec = FakeRecognizer.instances[0];
    rec.onerror!({ error: 'network' });
    rec.onend!();
    expect(lastMessage(m.log).message).toMatch(/need an internet connection/);
    await pass(2.1);
    expect(rec.start).toHaveBeenCalledTimes(2);
    rec.say('start', 0);
    expect(ids(m.log.signals, 'audio.keyword.start')).toHaveLength(1);
    expect(lastMessage(m.log).message).toMatch(/Listening for Create commands/);
  });

  it('explains a blocked speech service without stopping the microphone', async () => {
    const m = await ready();
    m.fist('start');
    FakeRecognizer.instances[0].onerror!({ error: 'not-allowed' });
    expect(lastMessage(m.log).state).toBe('running');
    expect(lastMessage(m.log).message).toMatch(/Voice commands were blocked/);
  });

  it('says once that voice commands are not available when the browser has no speech recognition, and carries on', async () => {
    const m = await ready({ speech: false });
    const messages = m.log.status.filter((s) => /Voice commands are not available/.test(s.message ?? ''));
    expect(messages).toHaveLength(1);
    m.fist('start');
    m.fist('end');
    expect(m.log.status.filter((s) => /Voice commands are not available/.test(s.message ?? ''))).toHaveLength(1);
    expect(lastMessage(m.log).state).toBe('running');
  });
});

describe('fake mode', () => {
  it('plays the Twinkle melody without touching the microphone', async () => {
    const m = await load({ fake: true });
    const stop = m.start();
    m.enable(true);
    await pass(2);
    expect(m.getUserMedia).not.toHaveBeenCalled();
    expect(m.log.status.map((s) => [s.state, s.message])).toEqual([
      ['starting', 'Starting made-up microphone data...'],
      ['running', STATUS_FAKE],
    ]);
    expect(m.log.pitch.length).toBeGreaterThan(95);
    expect(Math.abs(m.log.pitch[10].midi! - 60)).toBeLessThan(0.3);
    expect(ids(m.log.signals, 'audio.loudness').length).toBeGreaterThan(30);
    expect(ids(m.log.signals, 'audio.hum.pitch').length).toBeGreaterThan(30);
    expect(ids(m.log.signals, 'audio.onset').length).toBe(4); // notes at 0, 0.6, 1.2, 1.8
    const notes = m.log.performance.filter((e) => e.type === 'note');
    expect(notes.map((n) => n.pitch)).toEqual([60, 60, 67]);
    stop();
  });

  it('stops when disabled', async () => {
    const m = await load({ fake: true });
    m.start();
    m.enable(true);
    await pass(1);
    m.enable(false);
    expect(lastMessage(m.log)).toMatchObject({ state: 'idle' });
    const n = m.log.pitch.length;
    await pass(1);
    expect(m.log.pitch.length).toBe(n);
  });

  it('keywords still need the fist (fakeSay stands in for speech)', async () => {
    const m = await load({ fake: true });
    m.start();
    m.enable(true);
    await pass(0.1);
    expect(m.fakeSay('play')).toEqual([]);
    m.fist('start');
    expect(m.fakeSay('play')).toEqual(['play']);
    expect(ids(m.log.signals, 'audio.keyword.play')).toHaveLength(1);
    await pass(0.3);
    expect(m.fakeSay('play')).toEqual([]); // too soon after the last one
    await pass(1);
    expect(m.fakeSay('play')).toEqual(['play']);
    m.fist('end');
    await pass(1);
    expect(m.fakeSay('pause')).toEqual([]);
    expect(lastMessage(m.log).message).toBe(STATUS_FAKE); // no keyword chatter over the fake-mode message
  });

  it('exports fakeHum for tests', async () => {
    const m = await load({ fake: true });
    m.fakeHum([{ pitch: 72, onset_sec: 0, duration_sec: 0.3 }], { instant: true });
    expect(m.log.performance.filter((e) => e.type === 'note').map((e) => e.pitch)).toEqual([72]);
    expect(m.log.pitch.length).toBeGreaterThan(10);
  });
});
