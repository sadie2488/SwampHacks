import { beforeEach, describe, expect, it } from 'vitest';
import { bus, type ModuleStatus } from '@/bus';
import type { TdMessage } from '@/contracts';
import { startWith } from './index';
import { createTracker } from './frame';
import { shapeProblems } from './frame.test-util';
import { DEFAULT_RELAY_URL, createSender, relayUrl, type SenderState, type WebSocketLike } from './sender';

// ---- fakes: a clock you move by hand, and a WebSocket you control ----
class FakeClock {
  t = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; every?: number; fn: () => void }>();
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => this.add(fn, ms);
  setInterval = (fn: () => void, ms: number) => this.add(fn, ms, ms);
  clear = (id: unknown) => void this.timers.delete(id as number);
  private add(fn: () => void, ms: number, every?: number) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, every, fn });
    return id;
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; every?: number; fn: () => void }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      const [id, timer] = next;
      this.t = Math.max(this.t, timer.at);
      if (timer.every) timer.at += timer.every;
      else this.timers.delete(id);
      timer.fn();
    }
    this.t = end;
  }
}

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  static throwOnCreate = false;
  readyState = 0;
  bufferedAmount = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  closeCode: number | undefined;
  failSends = false;
  createdAt: number;
  constructor(
    readonly url: string,
    clock: FakeClock,
  ) {
    if (FakeSocket.throwOnCreate) throw new Error('bad address');
    this.createdAt = clock.t;
    FakeSocket.all.push(this);
  }
  send(data: string) {
    if (this.failSends) throw new Error('not open');
    this.sent.push(data);
  }
  close(code?: number) {
    this.closeCode = code;
    this.readyState = 3;
  }
  // what the relay or the network does:
  accept() {
    this.readyState = 1;
    this.onopen?.({});
  }
  breakDown() {
    this.readyState = 3;
    this.onerror?.({});
    this.onclose?.({});
  }
}

function setup() {
  const clock = new FakeClock();
  FakeSocket.all = [];
  FakeSocket.throwOnCreate = false;
  const tracker = createTracker(clock.now);
  const frames: TdMessage[] = [];
  const reports: Array<{ state: SenderState; message: string }> = [];
  const sender = createSender({
    url: 'ws://relay.test:1',
    createSocket: (url) => new FakeSocket(url, clock),
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clear,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    makeFrame: tracker.frame,
    publish: (f) => frames.push(f),
    report: (state, message) => reports.push({ state, message }),
  });
  const last = () => reports[reports.length - 1];
  return { clock, tracker, sender, frames, reports, last, socket: () => FakeSocket.all[FakeSocket.all.length - 1] };
}

describe('sender: turning on and off', () => {
  it('does nothing until it is enabled', () => {
    const { clock, frames, reports } = setup();
    clock.advance(5000);
    expect(FakeSocket.all).toHaveLength(0);
    expect(frames).toHaveLength(0);
    expect(reports).toHaveLength(0);
  });

  it('opens the socket and says it is connecting', () => {
    const { sender, socket, last } = setup();
    sender.enable();
    expect(FakeSocket.all).toHaveLength(1);
    expect(socket().url).toBe('ws://relay.test:1');
    expect(last()).toEqual({ state: 'starting', message: 'Connecting to the TouchDesigner relay...' });
  });

  it('enabling twice does not open a second connection', () => {
    const { sender } = setup();
    sender.enable();
    sender.enable();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('closes cleanly when turned off: no more frames, no reconnect, status is idle', () => {
    const { clock, sender, socket, frames, last } = setup();
    sender.enable();
    socket().accept();
    clock.advance(200);
    const before = frames.length;
    sender.disable();
    expect(socket().closeCode).toBe(1000);
    expect(last()).toEqual({ state: 'idle', message: 'TouchDesigner is off.' });
    clock.advance(20000);
    expect(frames).toHaveLength(before);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('turning off while waiting to retry cancels the retry', () => {
    const { clock, sender, socket } = setup();
    sender.enable();
    socket().breakDown();
    sender.disable();
    clock.advance(60000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('can be turned on again afterwards, with the counts starting over', () => {
    const { clock, sender, socket, last } = setup();
    sender.enable();
    socket().accept();
    clock.advance(1500);
    sender.disable();
    sender.enable();
    expect(FakeSocket.all).toHaveLength(2);
    socket().accept();
    clock.advance(1100); // the message with the count refreshes about once a second
    expect(last().message).toMatch(/Sending to TouchDesigner \((29|30|31|32|33) frames sent\)/);
  });
});

describe('sender: no relay running', () => {
  it('keeps publishing frames and says how to start the relay, with a count', () => {
    const { clock, sender, socket, frames, last } = setup();
    sender.enable();
    socket().breakDown();
    expect(last().state).toBe('error');
    expect(last().message).toContain('Relay not found: start it with: node bridge/relay.mjs');
    clock.advance(3000);
    expect(frames.length).toBeGreaterThanOrEqual(88);
    expect(last().message).toMatch(/\((\d+) frames made so far\)/);
    const shown = Number(/\((\d+) frames made/.exec(last().message)![1]);
    expect(shown).toBeGreaterThan(60);
    expect(shown).toBeLessThanOrEqual(frames.length);
    for (const f of frames) expect(shapeProblems(f)).toEqual([]);
  });

  it('treats a socket that cannot even be created like a missing relay', () => {
    const { clock, sender, last } = setup();
    FakeSocket.throwOnCreate = true;
    sender.enable();
    expect(last().state).toBe('error');
    expect(last().message).toContain('Relay not found');
    FakeSocket.throwOnCreate = false;
    clock.advance(500);
    expect(FakeSocket.all).toHaveLength(1); // retried and this time it worked
  });

  it('retries with growing waits (0.5, 1, 2, 4 seconds, then every 5)', () => {
    const { clock, sender, socket } = setup();
    sender.enable();
    const waits: number[] = [];
    for (let n = 0; n < 7; n++) {
      socket().breakDown();
      const failedAt = clock.t;
      const count = FakeSocket.all.length;
      while (FakeSocket.all.length === count) clock.advance(100);
      waits.push(clock.t - failedAt);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000]);
  });

  it('starts the waits over after a good connection', () => {
    const { clock, sender, socket, last } = setup();
    sender.enable();
    socket().breakDown();
    clock.advance(500);
    socket().breakDown();
    clock.advance(1000);
    socket().accept(); // third try works
    expect(last().state).toBe('running');
    socket().breakDown(); // then it drops
    expect(last().message).toContain('Lost the TouchDesigner relay');
    const count = FakeSocket.all.length;
    clock.advance(499);
    expect(FakeSocket.all).toHaveLength(count);
    clock.advance(1);
    expect(FakeSocket.all).toHaveLength(count + 1);
  });
});

describe('sender: relay connected', () => {
  it('sends about 30 valid JSON frames a second and publishes each one too', () => {
    const { clock, sender, socket, frames, last } = setup();
    sender.enable();
    socket().accept();
    clock.advance(1000);
    const sentFrames = socket().sent.map((text) => JSON.parse(text) as TdMessage);
    expect(sentFrames.length).toBeGreaterThanOrEqual(29);
    expect(sentFrames.length).toBeLessThanOrEqual(31);
    expect(frames).toHaveLength(sentFrames.length);
    expect(sentFrames).toEqual(frames);
    for (const f of sentFrames) expect(shapeProblems(f)).toEqual([]);
    // the clock in the frames moves forward
    expect(sentFrames[sentFrames.length - 1].t_ms).toBeGreaterThan(sentFrames[0].t_ms);
    expect(last()).toMatchObject({ state: 'running' });
    expect(last().message).toMatch(/^Sending to TouchDesigner \(\d+ frames sent\)/);
  });

  it('carries what the tracker has heard', () => {
    const { clock, sender, socket, tracker } = setup();
    sender.enable();
    socket().accept();
    tracker.setMode('create');
    tracker.onSignal({ version: 1, id: 'audio.onset', kind: 'moment', state: 'start', t_ms: 0 });
    clock.advance(70);
    const sent = socket().sent.map((t) => JSON.parse(t) as TdMessage);
    expect(sent[0].mode).toBe('create');
    expect(sent.map((f) => f.audio.onset)).toEqual([true, false]);
  });

  it('skips sending (but still publishes) while the relay is backed up', () => {
    const { clock, sender, socket, frames } = setup();
    sender.enable();
    socket().accept();
    socket().bufferedAmount = 5_000_000;
    clock.advance(500);
    expect(socket().sent).toHaveLength(0);
    expect(frames.length).toBeGreaterThan(10);
  });

  it('survives a send that throws', () => {
    const { clock, sender, socket, frames } = setup();
    sender.enable();
    socket().accept();
    socket().failSends = true;
    clock.advance(200);
    expect(frames.length).toBeGreaterThan(3);
  });

  it('does not react to events from a connection it already gave up', () => {
    const { clock, sender, socket, last } = setup();
    sender.enable();
    const old = socket();
    sender.disable();
    sender.enable();
    old.accept();
    clock.advance(10);
    expect(last().state).toBe('starting');
  });
});

describe('relayUrl', () => {
  it('defaults to the local relay', () => {
    expect(relayUrl('')).toBe(DEFAULT_RELAY_URL);
    expect(relayUrl(undefined)).toBe(DEFAULT_RELAY_URL);
    expect(relayUrl('?fake=1')).toBe('ws://localhost:9980');
  });
  it('can be pointed somewhere else with ?td=', () => {
    expect(relayUrl('?td=ws://192.168.1.20:9981')).toBe('ws://192.168.1.20:9981');
    expect(relayUrl('?fake=1&td=wss://example.com:443/td')).toBe('wss://example.com:443/td');
  });
  it('ignores values that are not websocket addresses', () => {
    expect(relayUrl('?td=http://localhost:9980')).toBe(DEFAULT_RELAY_URL);
    expect(relayUrl('?td=')).toBe(DEFAULT_RELAY_URL);
    expect(relayUrl('?td=javascript:alert(1)')).toBe(DEFAULT_RELAY_URL);
  });
});

describe('module wired to the bus', () => {
  const statuses: ModuleStatus[] = [];
  const tdFrames: TdMessage[] = [];
  beforeEach(() => {
    bus.reset();
    statuses.length = 0;
    tdFrames.length = 0;
    bus.on('status', (s) => s.module === 'touchdesigner' && statuses.push(s));
    bus.on('td', (f) => tdFrames.push(f));
  });
  const boot = () => {
    const clock = new FakeClock();
    FakeSocket.all = [];
    FakeSocket.throwOnCreate = false;
    const stop = startWith({
      url: 'ws://localhost:9980',
      createSocket: (url) => new FakeSocket(url, clock),
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clear,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clear,
    });
    return { clock, stop };
  };

  it('stays quiet (no connection, no frames) until the enable event for touchdesigner', () => {
    const { clock, stop } = boot();
    bus.emit('enable', { module: 'vision', on: true });
    clock.advance(1000);
    expect(FakeSocket.all).toHaveLength(0);
    expect(tdFrames).toHaveLength(0);
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'idle' });
    stop();
  });

  it('streams frames built from bus state, on and off with the enable event', () => {
    bus.emit('mode', 'play');
    bus.emit('controls', { 'visual.intensity': 0.8 });
    const { clock, stop } = boot(); // replayed values are picked up even though they came first
    bus.emit('enable', { module: 'touchdesigner', on: true });
    expect(FakeSocket.all[0].url).toBe('ws://localhost:9980');
    FakeSocket.all[0].accept();
    bus.emit('pitch', { t_ms: 0, midi: 60, confidence: 0.9, rms: 0.4 });
    bus.emit('transport', { loaded: true, playing: true, positionSec: 0, durationSec: 10, tempo: 1, pitch: 0, volume: 1, loop: false, loopSection: null, bpm: 90, beatPhase: 0.5 });
    bus.emit('signal', { version: 1, id: 'vision.hand.left.x', kind: 'slider', value: 0.25, t_ms: 0 });
    clock.advance(100);
    expect(tdFrames.length).toBeGreaterThanOrEqual(2);
    const frame = tdFrames[tdFrames.length - 1];
    expect(shapeProblems(frame)).toEqual([]);
    expect(frame).toMatchObject({ mode: 'play', intensity: 0.8, audio: { rms: 0.4, pitch_midi: 60, bpm: 90, beat_phase: 0.5 } });
    expect(frame.hands.left).toMatchObject({ x: 0.25 });
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'running' });

    bus.emit('enable', { module: 'touchdesigner', on: false });
    const count = tdFrames.length;
    clock.advance(1000);
    expect(tdFrames).toHaveLength(count);
    expect(FakeSocket.all[0].closeCode).toBe(1000);
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'idle' });
    stop();
  });

  it('still publishes frames on the bus when no relay is running', () => {
    const { clock, stop } = boot();
    bus.emit('enable', { module: 'touchdesigner', on: true });
    FakeSocket.all[0].breakDown();
    clock.advance(500);
    expect(tdFrames.length).toBeGreaterThan(10);
    expect(statuses[statuses.length - 1].message).toContain('node bridge/relay.mjs');
    stop();
  });

  it('stop() turns everything off and stops listening', () => {
    const { clock, stop } = boot();
    bus.emit('enable', { module: 'touchdesigner', on: true });
    FakeSocket.all[0].accept();
    stop();
    const count = tdFrames.length;
    clock.advance(1000);
    expect(tdFrames).toHaveLength(count);
    expect(FakeSocket.all[0].closeCode).toBe(1000);
    bus.emit('enable', { module: 'touchdesigner', on: true });
    expect(FakeSocket.all).toHaveLength(1);
  });
});
