import { describe, expect, it } from 'vitest';
import { createHandPicker, createHoldMachine, createShapeTracker, handsOf, HOLD_MS, hitBox, nearest, pickHand, smoothPoint } from './hand-pointer';
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

// A 21-point hand: palm at (x, y); `shape` curls the fingers (fist), straightens them (open), or a fist with the thumb up.
const shaped = (handedness: 'Left' | 'Right', x: number, y: number, shape: 'open' | 'fist' | 'thumbs') => {
  const p = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  const set = (i: number, dx: number, dy: number) => (p[i] = { x: x + dx, y: y + dy, z: 0 });
  set(0, 0, 0.1); // wrist below the palm
  for (const [mcp, dx] of [[5, -0.03], [9, -0.01], [13, 0.01], [17, 0.03]] as const) set(mcp, dx, 0);
  for (const [pip, tip, dx] of [[6, 8, -0.03], [10, 12, -0.01], [14, 16, 0.01], [18, 20, 0.03]] as const) {
    set(pip, dx, -0.04);
    set(tip, dx, shape === 'open' ? -0.1 : 0.03); // open: tip far above; fist: tip folded back near the palm
  }
  set(2, -0.04, 0.03);
  set(3, -0.05, -0.01);
  set(4, -0.05, shape === 'thumbs' ? -0.06 : 0.0);
  return { handedness, points: p };
};
const frame = (...hands: ReturnType<typeof shaped>[]) => ({ t_ms: 0, width: 1, height: 1, hands });

describe('either hand drives the cursor', () => {
  // the same pipeline as HandPointer.tsx: pick the active hand, read its shape, feed the grab machine
  const rig = () => {
    const picker = createHandPicker();
    const shapes = createShapeTracker();
    const m = createHoldMachine<string>();
    let t = 0;
    const step = (lm: ReturnType<typeof frame>, target: string | null = 'btn') => {
      t += 50;
      const picked = picker.pick(handsOf(lm));
      if (!picked) return null;
      if (picked.switched) m.reset();
      const s = shapes.update(picked.hand.side, picked.hand.points, 1);
      const out = m.update({ t, x: picked.hand.x * 1000, y: picked.hand.y * 1000, fist: s.fist, open: s.open, target, enabled: true });
      return { side: picked.hand.side, out, s };
    };
    return { step, m };
  };
  for (const side of ['Left', 'Right'] as const) {
    it(`${side} hand alone points, grabs, drags and clicks`, () => {
      const { step, m } = rig();
      expect(step(frame(shaped(side, 0.5, 0.5, 'open')))).toMatchObject({ side: side.toLowerCase(), s: { open: true, fist: false } });
      expect(step(frame(shaped(side, 0.5, 0.5, 'fist')))?.s.fist).toBe(true);
      expect(m.grabbed).toBe(true);
      let clicked: string | undefined;
      for (let i = 0; i < 25 && !clicked; i++) clicked = step(frame(shaped(side, 0.5, 0.5, 'fist')))?.out.click;
      expect(clicked).toBe('btn');
      // open again, grab, and drag sideways
      step(frame(shaped(side, 0.5, 0.5, 'open')));
      step(frame(shaped(side, 0.5, 0.5, 'fist')));
      const out = step(frame(shaped(side, 0.45, 0.5, 'fist')))?.out;
      expect(m.phase).toBe('dragging');
      expect(out?.move?.dx).toBeCloseTo(-50);
    });
  }
  it('a left thumbs-up is never a fist, a left fist is', () => {
    const shapes = createShapeTracker();
    expect(shapes.update('left', shaped('Left', 0.5, 0.5, 'thumbs').points, 1).fist).toBe(false);
    expect(shapes.update('left', shaped('Left', 0.5, 0.5, 'fist').points, 1).fist).toBe(true);
  });
  it('with both hands seen, the one moving follows; a still pair does not flicker', () => {
    const picker = createHandPicker();
    const pick = (lx: number, rx: number) => picker.pick(handsOf(frame(shaped('Left', lx, 0.6, 'open'), shaped('Right', rx, 0.4, 'open'))));
    expect(pick(0.2, 0.8)?.hand.side).toBe('right'); // no history: the higher hand
    for (let i = 0; i < 5; i++) expect(pick(0.2, 0.8)?.hand.side).toBe('right');
    let side: string | undefined;
    for (let i = 1; i <= 6; i++) side = pick(0.2 + i * 0.03, 0.8)?.hand.side; // the left hand moves
    expect(side).toBe('left');
    expect(pick(0.38, 0.801)?.hand.side).toBe('left'); // the right hand twitching does not take it back
  });
  it('switching hands mid-grab releases the grab', () => {
    const { step, m } = rig();
    const both = (lx: number, ls: 'open' | 'fist', rx: number, rs: 'open' | 'fist') => step(frame(shaped('Left', lx, 0.6, ls), shaped('Right', rx, 0.4, rs)));
    both(0.2, 'open', 0.8, 'open');
    both(0.2, 'open', 0.8, 'fist');
    expect(m.grabbed).toBe(true);
    let side: string | undefined;
    for (let i = 1; i <= 6; i++) side = both(0.2 + i * 0.03, 'fist', 0.8, 'fist')?.side;
    expect(side).toBe('left');
    expect(m.grabbed).toBe(false); // the right hand's grab ended; the left fist must open first to grab
  });
});
