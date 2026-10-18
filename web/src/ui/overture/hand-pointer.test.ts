import { describe, expect, it } from 'vitest';
import { createHoldMachine, HOLD_MS, hitBox, nearest, pickHand, smoothPoint } from './hand-pointer';
import { toScreen } from './guide';

const hand = (handedness: 'Left' | 'Right', x: number, y: number) => ({ handedness, points: Array.from({ length: 21 }, () => ({ x, y, z: 0 })) });

describe('cursor mapping', () => {
  it('follows the hand raised highest and maps straight to the screen (no flip)', () => {
    const p = pickHand({ t_ms: 0, width: 1280, height: 800, hands: [hand('Left', 0.2, 0.7), hand('Right', 0.8, 0.3)] });
    expect(p).toMatchObject({ side: 'right', x: 0.8, y: 0.3 });
    expect(toScreen(0.8, 0.3, 1280 / 800, 1280, 800)).toEqual([1024, 240]);
    expect(pickHand({ t_ms: 0, width: 1, height: 1, hands: [] })).toBeNull();
  });
  it('smooths part of the way each frame', () => {
    expect(smoothPoint(null, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
    const s = smoothPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.35);
    expect(s.x).toBeCloseTo(35);
  });
});

describe('magnet', () => {
  const items = [
    { item: 'a', box: hitBox({ left: 100, top: 100, right: 110, bottom: 110 }) },
    { item: 'b', box: { left: 300, top: 100, right: 400, bottom: 150 } },
  ];
  it('grows small targets to 48 px and snaps to the nearest within 48 px', () => {
    expect(items[0].box.right - items[0].box.left).toBe(48);
    expect(nearest({ x: 170, y: 105 }, items)).toBe('a');
    expect(nearest({ x: 280, y: 120 }, items)).toBe('b');
    expect(nearest({ x: 200, y: 400 }, items)).toBeNull();
  });
});

describe('hold to click', () => {
  const run = () => {
    const m = createHoldMachine<string>();
    const at = (t: number, o: Partial<{ x: number; fist: boolean; open: boolean; target: string | null; enabled: boolean }> = {}) =>
      m.update({ t, x: o.x ?? 0, y: 0, fist: o.fist ?? true, open: o.open ?? false, target: o.target === undefined ? 'btn' : o.target, enabled: o.enabled ?? true });
    return { m, at };
  };
  it('fires once at HOLD_MS after open hand then fist, and needs the hand to open again', () => {
    const { at } = run();
    expect(HOLD_MS).toBe(1000);
    at(0, { fist: false, open: true });
    at(10);
    expect(at(500).progress).toBeCloseTo(0.49);
    expect(at(999).click).toBeUndefined();
    expect(at(1010).click).toBe('btn');
    expect(at(1500).click).toBeUndefined();
    at(1600, { fist: false });
    at(1700); // fist again without opening: nothing
    expect(at(3000).click).toBeUndefined();
  });
  it('cancels when the hand opens or moves away', () => {
    const { at } = run();
    at(0, { fist: false, open: true });
    at(10);
    at(500, { fist: false, open: true });
    at(510);
    expect(at(1400).click).toBeUndefined(); // restarted at 510
    const b = run();
    b.at(0, { fist: false, open: true });
    b.at(10);
    b.at(300, { x: 60 });
    expect(b.at(1200, { x: 60 }).click).toBeUndefined();
  });
  it('does nothing while disabled (inside a mode with no panel open)', () => {
    const { at } = run();
    at(0, { fist: false, open: true, enabled: false });
    at(10, { enabled: false });
    expect(at(1200, { enabled: false })).toEqual({ progress: 0 });
  });
});

describe('grab and scroll', () => {
  it('a moving fist sends wheel deltas instead of clicking', () => {
    const m = createHoldMachine<string>();
    const u = (t: number, x: number, y: number, fist = true, open = false) => m.update({ t, x, y, fist, open, target: 'btn', enabled: true });
    u(0, 0, 0, false, true);
    u(10, 0, 0);
    const w = u(50, 0, -40).wheel;
    expect(w?.dy).toBeGreaterThan(0); // hand up: content scrolls down
    expect(u(80, 0, -50).wheel?.dy).toBeGreaterThan(0);
    expect(u(1500, 0, -50).click).toBeUndefined();
  });
});
