// Tests for the hand-cursor gate: while the hand is used as a mouse, mode-bound hand rules stay quiet.
import { afterEach, describe, expect, it } from 'vitest';
import { bus } from '@/bus';
import type { Signal } from '@/contracts';
import { createEngine } from './engine';
import { start } from './index';

const RULES = `
- name: right fist stops the loop
  mode: create
  when: vision.hand.right.fist
  do: create.loop.stop
  how: trigger
- name: hold Y for Play
  when: vision.sign.y
  do: app.mode
  how: trigger
  value: play
- name: right fist toggles everywhere
  mode: any
  when: vision.hand.right.fist
  do: playback.toggle
  how: trigger
`;

const moment = (id: string, state: 'start' | 'end' = 'start'): Signal => ({ version: 1, id, kind: 'moment', state, t_ms: 0 });

function setup() {
  const engine = createEngine({ now: () => 0 });
  expect(engine.load(RULES).filter((i) => i.level === 'error')).toEqual([]);
  engine.setMode('create');
  const fired = (s: Signal) => engine.handleSignal(s).map((e) => e.command.command);
  return { engine, fired };
}

describe('hand pointer gate', () => {
  afterEach(() => bus.reset());

  it('runs mode-bound hand rules normally when the pointer is off', () => {
    const { fired } = setup();
    expect(fired(moment('vision.hand.right.fist'))).toEqual(['create.loop.stop', 'playback.toggle']);
  });

  it('skips mode-bound hand rules while the pointer is active, keeps mode: any and non-hand rules', () => {
    const { engine, fired } = setup();
    engine.setPointerActive(true);
    expect(fired(moment('vision.hand.right.fist'))).toEqual(['playback.toggle']);
    expect(fired(moment('vision.sign.y'))).toEqual(['app.mode']);
    engine.setPointerActive(false);
    expect(fired(moment('vision.hand.right.fist', 'end'))).toEqual([]);
    expect(fired(moment('vision.hand.right.fist'))).toEqual(['create.loop.stop', 'playback.toggle']);
  });

  it('follows the handPointer topic on the bus', () => {
    const stop = start();
    const seen: string[] = [];
    const off = bus.on('command', (c) => seen.push(c.command));
    bus.emit('mode', 'create');
    bus.emit('handPointer', { active: true });
    bus.emit('signal', moment('vision.hand.right.fist'));
    expect(seen).not.toContain('create.loop.stop');
    bus.emit('signal', moment('vision.hand.right.fist', 'end'));
    bus.emit('handPointer', { active: false });
    bus.emit('signal', moment('vision.hand.right.fist'));
    expect(seen).toContain('create.loop.stop');
    off();
    stop();
  });
});
