// Tests for hold_ms: a rule that fires only after its gesture stayed on long enough (Lalitha's sign shortcuts).
import { describe, expect, it } from 'vitest';
import type { Mode, Signal } from '@/contracts';
import { createEngine, loadMappings } from './engine';

const SIGN_Y = `
- name: hold Y for Play
  when: vision.sign.y
  do: app.mode
  how: trigger
  value: play
  hold_ms: 2000
`;

function setup(yaml: string, mode: Mode = 'learn') {
  let now = 0;
  const engine = createEngine({ now: () => now });
  engine.load(yaml);
  engine.setMode(mode);
  const at = (t: number) => (now = t);
  const sign = (id: string, t: number, state: 'start' | 'end' = 'start'): Signal => ({ version: 1, id, kind: 'moment', state, t_ms: t });
  const feed = (s: Signal) => {
    at(s.t_ms);
    return engine.handleSignal(s);
  };
  const tickAt = (t: number) => {
    at(t);
    return engine.tick();
  };
  return { engine, feed, sign, tickAt, at };
}

describe('hold_ms', () => {
  it('loads with no issues and keeps the hold time', () => {
    const r = loadMappings(SIGN_Y);
    expect(r.issues).toEqual([]);
    expect(r.rules[0].holdMs).toBe(2000);
  });

  it('does not fire on start; fills up; fires once after 2 seconds', () => {
    const { engine, feed, sign, tickAt, at } = setup(SIGN_Y);
    expect(feed(sign('vision.sign.y', 1000))).toEqual([]);
    at(2000);
    expect(engine.holds()).toEqual([{ rule: 'hold Y for Play', control: 'app.mode', value: 'play', progress: 0.5 }]);
    expect(tickAt(2999)).toEqual([]);
    const out = tickAt(3000);
    expect(out).toHaveLength(1);
    expect(out[0].command).toMatchObject({ command: 'app.mode', value: 'play', how: 'trigger', source: 'gesture', mapping: 'hold Y for Play' });
    expect(engine.holds()).toEqual([]); // done: the ring goes away
    expect(tickAt(5000)).toEqual([]); // still held: no second fire
  });

  it('letting go early cancels it', () => {
    const { engine, feed, sign, tickAt } = setup(SIGN_Y);
    feed(sign('vision.sign.y', 0));
    feed(sign('vision.sign.y', 1500, 'end'));
    expect(engine.holds()).toEqual([]);
    expect(tickAt(2500)).toEqual([]);
  });

  it('let go and sign again to fire again; a repeated start does not restart the timer', () => {
    const { feed, sign, tickAt } = setup(SIGN_Y);
    feed(sign('vision.sign.y', 0));
    feed(sign('vision.sign.y', 1000));
    expect(tickAt(2000)).toHaveLength(1);
    feed(sign('vision.sign.y', 2100, 'end'));
    feed(sign('vision.sign.y', 3000));
    expect(tickAt(4900)).toEqual([]);
    expect(tickAt(5000)).toHaveLength(1);
  });

  it('release() (camera off or no hands) cancels camera holds', () => {
    const { engine, feed, sign, tickAt } = setup(SIGN_Y);
    feed(sign('vision.sign.y', 0));
    engine.release('vision.');
    expect(engine.holds()).toEqual([]);
    expect(tickAt(3000)).toEqual([]);
  });

  it('a hold stops when the mode no longer matches', () => {
    const { engine, feed, sign, tickAt } = setup(SIGN_Y.replace('how: trigger', 'how: trigger\n  mode: learn'));
    feed(sign('vision.sign.y', 0));
    engine.setMode('play');
    expect(tickAt(3000)).toEqual([]);
  });

  it('explains hold_ms mistakes in plain words', () => {
    const notHoldable = loadMappings(SIGN_Y.replace('vision.sign.y', 'audio.clap'));
    expect(notHoldable.rules).toEqual([]);
    expect(notHoldable.issues[0].message).toMatch(/needs a gesture you can hold/);
    const follow = loadMappings('- when: vision.hand.right.height\n  do: playback.tempo\n  how: follow\n  hold_ms: 500\n');
    expect(follow.issues[0].message).toMatch(/only works with moments/);
    const bad = loadMappings(SIGN_Y.replace('2000', '"long"'));
    expect(bad.issues[0].message).toMatch(/"hold_ms:" must be a number of milliseconds/);
  });

  it('rules without hold_ms still fire at once', () => {
    const { feed, sign } = setup(SIGN_Y.replace('  hold_ms: 2000\n', ''));
    expect(feed(sign('vision.sign.y', 0))).toHaveLength(1);
  });
});
