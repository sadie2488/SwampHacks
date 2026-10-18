// On the entrance and the record menu, only the `mode: any` rules may react (sign shortcuts, grab to enter).
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import realYaml from '../modules/mappings/mappings.yaml?raw';
import type { Mode, Signal } from '@/contracts';
import { createEngine } from '@/modules/commands/engine';
import { logoTarget, MENU_MODE, publishedMode } from './navigation';

const moment = (id: string, t_ms: number, state: 'start' | 'end' = 'start'): Signal => ({ version: 1, id, kind: 'moment', state, t_ms });
const slider = (id: string, value: number, t_ms: number): Signal => ({ version: 1, id, kind: 'slider', value, t_ms });

function setup(mode: Mode) {
  let now = 0;
  const engine = createEngine({ now: () => now });
  engine.load(realYaml);
  engine.setMode(mode);
  const fired: string[] = [];
  const feed = (s: Signal) => {
    now = s.t_ms;
    for (const e of engine.handleSignal(s)) if (e.fire) fired.push(`${e.command.command}${e.command.value === undefined ? '' : `=${String(e.command.value)}`}`);
  };
  const tick = (t: number) => {
    now = t;
    for (const e of engine.tick()) if (e.fire) fired.push(`${e.command.command}=${String(e.command.value)}`);
  };
  return { feed, tick, fired };
}

/** Everything a presenter might do by mistake on the menu: Create and Play words with the fist held, hand moves. */
function presenterOnTheMenu(feed: (s: Signal) => void) {
  let t = 1000;
  feed(moment('vision.hand.left.fist', (t += 100)));
  for (const w of ['start', 'beat', 'next', 'drums', 'play', 'pause', 'slower', 'faster', 'higher', 'lower']) feed(moment(`audio.keyword.${w}`, (t += 1500)));
  feed(moment('vision.hand.left.fist', (t += 100), 'end'));
  feed(moment('vision.hand.right.fist', (t += 100)));
  feed(moment('vision.hand.right.fist', (t += 100), 'end'));
  for (const v of [0.1, 0.9, 0.2, 0.8]) feed(slider('vision.hand.right.height', v, (t += 100)));
  feed(slider('vision.hand.right.x', 0.9, (t += 100)));
  feed(moment('audio.clap.double', (t += 100)));
  return t;
}

describe('the entrance and the record menu are neutral', () => {
  it('publishes the open mode inside a mode, and the neutral mode on the entrance and the menu', () => {
    expect(publishedMode('mode', 'create')).toBe('create');
    expect(publishedMode('mode', 'play')).toBe('play');
    expect(publishedMode('menu', 'create')).toBe(MENU_MODE);
    expect(publishedMode('entrance', 'play')).toBe(MENU_MODE);
  });

  it('mappings.yaml has no Learn rules, so the neutral mode only leaves the "any" rules live', () => {
    const rules = parse(realYaml) as Array<{ mode?: string }>;
    expect(rules.filter((r) => r.mode === MENU_MODE)).toEqual([]);
  });

  it('on the menu, Create and Play words and hand moves do nothing (after leaving Create or Play)', () => {
    const { feed, fired } = setup(publishedMode('menu', 'create'));
    presenterOnTheMenu(feed);
    expect(fired).toEqual([]);
  });

  it('on the menu, a held sign still switches mode (a grab no longer enters: the hand cursor\'s hold-to-click replaced it)', () => {
    const { feed, tick, fired } = setup(publishedMode('menu', 'play'));
    feed(moment('vision.hand.right.grab', 100));
    feed(moment('vision.sign.y', 200));
    tick(2300);
    expect(fired).toEqual(['app.mode=play']);
  });

  it('for comparison, inside Create the same moves do fire Create commands', () => {
    const { feed, fired } = setup('create');
    presenterOnTheMenu(feed);
    expect(fired.some((c) => c.startsWith('create.'))).toBe(true);
  });
});

describe('the Overture logo', () => {
  it('goes to the entrance from the menu and from a mode, and stays put on the entrance', () => {
    expect(logoTarget('mode')).toBe('entrance');
    expect(logoTarget('menu')).toBe('entrance');
    expect(logoTarget('entrance')).toBeNull();
  });
});
