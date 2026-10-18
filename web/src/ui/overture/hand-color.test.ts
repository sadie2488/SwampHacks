import { describe, expect, it } from 'vitest';
import { createHoldMachine, createInkLatch, DRAG_PX, HOLD_MS, isVisibleInk, PAPER, parseColor, pickHandColor } from './hand-pointer';
import { MODES, modeLook } from './modes';

describe('cursor colour', () => {
  it('a record takes its mode colour from data-hand-color', () => {
    const want = { learn: '#1fb3bf', play: '#ff7a00', create: '#c9a8ff', lab: '#2f5bff' };
    for (const m of MODES) expect(pickHandColor({ data: m.a, background: 'rgb(0, 0, 0)' }, PAPER)).toBe(want[m.id]);
  });
  it('an explicit data-hand-color wins over computed styles', () => {
    expect(pickHandColor({ data: ' #ff2d8a ', border: 'rgb(31, 179, 191)', background: 'rgb(255, 122, 0)' }, PAPER)).toBe('#ff2d8a');
  });
  it('uses a drawn border, then a background, when they are visible', () => {
    expect(pickHandColor({ border: 'rgb(31, 179, 191)', background: 'rgb(255, 122, 0)' }, PAPER)).toBe('rgb(31, 179, 191)');
    expect(pickHandColor({ border: null, background: 'rgb(255, 122, 0)' }, PAPER)).toBe('rgb(255, 122, 0)');
  });
  it('transparent or near-black falls back to the mode colour', () => {
    const ink = modeLook('play').a;
    expect(pickHandColor({ border: 'rgba(0, 0, 0, 0)', background: 'transparent' }, ink)).toBe(ink);
    expect(pickHandColor({ border: 'rgb(10, 10, 12)', background: 'rgba(255, 255, 255, 0.1)' }, ink)).toBe(ink);
    expect(pickHandColor(null, PAPER)).toBe('#f2eee6');
  });
  it('reads common colour forms', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#2f5bff80')?.a).toBeCloseTo(0.5, 1);
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor('oklch(0.7 0.1 200)')).toBeNull();
    expect(isVisibleInk('oklch(0.7 0.1 200)')).toBe(false);
  });
  it('keeps the colour from where a grab started until the hand opens', () => {
    const latch = createInkLatch();
    expect(latch(false, '#1fb3bf')).toBe('#1fb3bf');
    expect(latch(true, '#1fb3bf')).toBe('#1fb3bf');
    expect(latch(true, '#ff7a00')).toBe('#1fb3bf'); // dragged over another record
    expect(latch(false, '#ff7a00')).toBe('#ff7a00');
  });
});

describe('grab, drag, hold to click', () => {
  const run = () => {
    const m = createHoldMachine<string>();
    const at = (t: number, o: Partial<{ x: number; fist: boolean; open: boolean; target: string | null }> = {}) =>
      m.update({ t, x: o.x ?? 0, y: 0, fist: o.fist ?? true, open: o.open ?? false, target: o.target === undefined ? 'rec' : o.target, enabled: true });
    return { m, at };
  };
  it('open -> grabbed at once on the fist -> released when the hand opens', () => {
    const { m, at } = run();
    at(0, { fist: false, open: true });
    expect(m.grabbed).toBe(false);
    expect(m.held).toBeNull();
    at(10);
    expect(m.grabbed).toBe(true);
    expect(m.held).toBe('rec');
    at(200, { fist: false, open: true });
    expect(m.grabbed).toBe(false);
    expect(m.held).toBeNull();
  });
  it('a fist over nothing does not count as grabbed until it drags', () => {
    const { m, at } = run();
    at(0, { fist: false, open: true, target: null });
    at(10, { target: null });
    expect(m.grabbed).toBe(false);
    at(30, { x: DRAG_PX + 5, target: null });
    expect(m.grabbed).toBe(true);
  });
  it('the dead zone is 12 px: jitter inside it still clicks after a full second', () => {
    const { at } = run();
    expect(DRAG_PX).toBe(12);
    at(0, { fist: false, open: true });
    at(10);
    at(300, { x: 6 });
    at(600, { x: -8 });
    expect(at(HOLD_MS + 5, { x: 10 }).click).toBeUndefined();
    expect(at(HOLD_MS + 15, { x: 10 }).click).toBe('rec');
  });
  it('drags from the first movement past the dead zone, and that grab never clicks', () => {
    const { m, at } = run();
    at(0, { fist: false, open: true });
    at(10);
    const first = at(40, { x: 20 });
    expect(first.wheel?.dx).toBeLessThan(0); // the whole 20 px move counts, from the first frame
    expect(Math.abs(first.wheel?.dx ?? 0)).toBeGreaterThan(20);
    expect(m.held).toBe('rec');
    expect(at(80, { x: 20 }).wheel).toBeUndefined();
    expect(at(2000, { x: 20 }).click).toBeUndefined();
  });
});
