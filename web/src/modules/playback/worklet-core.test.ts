// The audio worklet's logic, driven by hand: the message protocol (what the page can say, what comes back) and the
// 15-a-second position reports. The same code, as text in a pretend worklet, is checked in worklet-source.test.ts.
import { describe, expect, it } from 'vitest';
import { defineEngine } from './engine-core';
import { createPipeline } from './soundtouch-lib';
import { defineWorkletCore, type FromWorklet, type ToWorklet } from './worklet-core';
import { maxStep, noise, rms, sine } from './test-utils';

const SR = 48000;
const QUANTUM = 128;

function makeCore() {
  const posted: FromWorklet[] = [];
  let time = 0;
  const core = defineWorkletCore(defineEngine(createPipeline))({ post: (m) => posted.push(m), sampleRate: SR, time: () => time });
  /** Render `frames` of sound the way the audio thread does (128 at a time). */
  const run = (wanted: number) => {
    const frames = Math.ceil(wanted / QUANTUM) * QUANTUM;
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    const bl = new Float32Array(QUANTUM);
    const br = new Float32Array(QUANTUM);
    for (let at = 0; at < frames; at += QUANTUM) {
      core.render(bl, br, QUANTUM);
      l.set(bl, at);
      r.set(br, at);
      time += QUANTUM / SR;
    }
    return { l, r };
  };
  const send = (m: ToWorklet) => core.handle(m);
  const last = <T extends FromWorklet['type']>(type: T) => [...posted].reverse().find((m) => m.type === type) as Extract<FromWorklet, { type: T }> | undefined;
  return { core, posted, run, send, last };
}

const load = (epoch: number, left: Float32Array, right: Float32Array | null = null, sampleRate = SR): ToWorklet => ({ type: 'load', epoch, sampleRate, left, right });

describe('worklet messages', () => {
  it('says ready with the length of the song once it has it, and is silent until told to play', () => {
    const t = makeCore();
    t.send(load(1, sine(440, 3, SR)));
    expect(t.last('ready')).toEqual({ type: 'ready', epoch: 1, durationSec: 3 });
    const quiet = t.run(SR / 2);
    expect(rms(quiet.l)).toBe(0);
  });

  it('plays after play, stops after pause, and reports where it is', () => {
    const t = makeCore();
    t.send(load(1, sine(440, 5, SR)));
    t.send({ type: 'play' });
    const a = t.run(SR);
    expect(rms(a.l, SR / 2, SR)).toBeGreaterThan(0.3);
    const playing = t.last('pos')!;
    expect(playing.playing).toBe(true);
    expect(playing.sec).toBeGreaterThan(0.8);
    expect(playing.sec).toBeLessThan(1.05);
    t.send({ type: 'pause' });
    t.run(SR / 4);
    const b = t.run(SR / 2);
    expect(rms(b.l)).toBe(0);
    expect(t.last('pos')!.playing).toBe(false);
  });

  it('reports the position about 15 times a second while playing, and stamps each report with the audio clock', () => {
    const t = makeCore();
    t.send(load(1, sine(440, 10, SR)));
    t.send({ type: 'play' });
    t.run(SR); // settle
    t.posted.length = 0;
    t.run(2 * SR);
    const reports = t.posted.filter((m) => m.type === 'pos') as Extract<FromWorklet, { type: 'pos' }>[];
    expect(reports.length).toBeGreaterThanOrEqual(28);
    expect(reports.length).toBeLessThanOrEqual(32);
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i].t).toBeGreaterThan(reports[i - 1].t);
      expect(reports[i].sec).toBeGreaterThanOrEqual(reports[i - 1].sec);
    }
  });

  it('still says hello now and then when nothing is playing', () => {
    const t = makeCore();
    t.send(load(1, sine(440, 3, SR)));
    t.posted.length = 0;
    t.run(3 * SR);
    const hellos = t.posted.filter((m) => m.type === 'pos');
    expect(hellos.length).toBeGreaterThanOrEqual(2);
    expect(hellos.length).toBeLessThanOrEqual(4);
  });

  it('a seek moves the position at once, and the answer carries the new epoch so late reports can be told apart', () => {
    const t = makeCore();
    t.send(load(1, sine(440, 10, SR)));
    t.send({ type: 'play' });
    t.run(SR / 2);
    t.send({ type: 'seek', epoch: 2, sec: 6 });
    t.run(QUANTUM);
    const pos = t.last('pos')!;
    expect(pos.epoch).toBe(2);
    expect(pos.sec).toBeGreaterThanOrEqual(6);
    expect(pos.sec).toBeLessThan(6.2);
  });

  it('applies tempo, pitch and loop that arrived BEFORE the song, and later changes while playing', () => {
    const t = makeCore();
    t.send({ type: 'tempo', value: 0.5 });
    t.send({ type: 'pitch', value: 12 });
    t.send({ type: 'loop', region: [1, 2] });
    t.send(load(1, sine(440, 5, SR)));
    t.send({ type: 'seek', epoch: 2, sec: 1 });
    t.send({ type: 'play' });
    const a = t.run(SR * 2);
    // half speed: after 2 s of sound we are only about 1 s further, so the position is still inside the 1-2 s loop
    expect(t.last('pos')!.sec).toBeGreaterThanOrEqual(1);
    expect(t.last('pos')!.sec).toBeLessThanOrEqual(2);
    expect(rms(a.l, SR, 2 * SR)).toBeGreaterThan(0.3);
    t.send({ type: 'loop', region: null });
    t.send({ type: 'tempo', value: 1 });
    t.send({ type: 'pitch', value: 0 });
    t.run(SR * 2);
    expect(t.last('pos')!.sec).toBeGreaterThan(2);
  });

  it('tells the page once when the song ends', () => {
    const t = makeCore();
    t.send(load(1, sine(440, 1, SR)));
    t.send({ type: 'play' });
    t.run(SR * 2);
    expect(t.posted.filter((m) => m.type === 'ended')).toEqual([{ type: 'ended', epoch: 1 }]);
    expect(t.last('pos')!.playing).toBe(false);
  });

  it('volume glides: a drop is smooth (no click) and settles on the new level', () => {
    const t = makeCore();
    t.send(load(1, sine(440, 5, SR)));
    t.send({ type: 'play' });
    const a = t.run(SR / 2);
    t.send({ type: 'volume', value: 0.25 });
    const b = t.run(SR / 2);
    expect(maxStep(b.l, 0)).toBeLessThan(0.05);
    expect(rms(b.l, (SR * 3) / 8, SR / 2)).toBeCloseTo(rms(a.l, SR / 4, SR / 2) * 0.25, 2);
  });

  it('a new song replaces the old one', () => {
    const t = makeCore();
    t.send(load(1, sine(440, 5, SR)));
    t.send({ type: 'play' });
    t.run(SR / 2);
    t.send({ type: 'pause' });
    t.send(load(2, sine(880, 3, SR)));
    expect(t.last('ready')).toEqual({ type: 'ready', epoch: 2, durationSec: 3 });
    t.send({ type: 'play' });
    const a = t.run(SR / 2);
    expect(rms(a.l, SR / 4, SR / 2)).toBeGreaterThan(0.3);
    expect(t.last('pos')!.epoch).toBe(2);
  });

  it('a stereo song keeps its two sides, a mono one is sent once', () => {
    const t = makeCore();
    t.send(load(1, noise(SR * 2, 1), noise(SR * 2, 2)));
    t.send({ type: 'play' });
    const stereo = t.run(SR / 2);
    expect(stereo.l[SR / 4]).not.toBe(stereo.r[SR / 4]);
    const m = makeCore();
    m.send(load(1, noise(SR * 2, 1), null));
    m.send({ type: 'play' });
    const mono = m.run(SR / 2);
    expect(mono.l[SR / 4]).toBe(mono.r[SR / 4]);
  });

  it('an engine that blows up is reported once and the worklet goes quiet instead of dying', () => {
    const t = makeCore();
    t.send({ type: 'load', epoch: 1, sampleRate: SR, left: undefined as unknown as Float32Array, right: null });
    expect(t.posted.filter((m) => m.type === 'error')).toHaveLength(1);
    t.send({ type: 'play' });
    const a = t.run(SR / 4);
    expect(rms(a.l)).toBe(0);
    expect(t.posted.filter((m) => m.type === 'error')).toHaveLength(1);
  });

  it('dispose lets go of the song and goes quiet', () => {
    const t = makeCore();
    t.send(load(1, sine(440, 5, SR)));
    t.send({ type: 'play' });
    t.run(SR / 4);
    t.send({ type: 'dispose' });
    expect(rms(t.run(SR / 4).l)).toBe(0);
  });
});
