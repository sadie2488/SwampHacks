import { describe, expect, it } from 'vitest';
import type { Point } from './hand-pointer';
import { createPinchMachine, PINCH_DEBOUNCE_MS, PINCH_OFF, PINCH_ON, pinchGap } from './pinch';

/** A 21-point hand with the thumb tip (4) and index tip (8) `gap` frame heights apart (aspect 1). */
function hand(gap: number): Point[] {
  const p: Point[] = Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.5 + i * 0.02 }));
  p[4] = { x: 0.4, y: 0.4 };
  p[8] = { x: 0.4, y: 0.4 + gap };
  return p;
}
const OPEN = hand(0.15);
const PINCH = hand(0.02);
const base = { aspect: 1, fist: false, grabbed: false, enabled: true };

describe('pinch to click', () => {
  it('measures the thumb-to-index gap in frame heights, with x scaled by the aspect', () => {
    expect(pinchGap(hand(0.1), 1)).toBeCloseTo(0.1);
    const wide = hand(0);
    wide[8] = { x: 0.5, y: 0.4 };
    expect(pinchGap(wide, 16 / 9)).toBeCloseTo(0.1 * (16 / 9));
    expect(pinchGap([], 1)).toBeNull();
    expect(PINCH_ON).toBeLessThan(PINCH_OFF);
  });

  it('fires once as the pinch starts and holding it never repeats', () => {
    const m = createPinchMachine<string>();
    expect(m.update({ ...base, t: 0, points: OPEN, target: 'a' }).click).toBeUndefined();
    expect(m.update({ ...base, t: 16, points: PINCH, target: 'a' }).click).toBe('a');
    for (let t = 32; t < 2000; t += 16) expect(m.update({ ...base, t, points: PINCH, target: 'a' }).click).toBeUndefined();
    expect(m.pinched).toBe(true);
  });

  it('release and re-pinch fires again only after the 400 ms debounce', () => {
    const m = createPinchMachine<string>();
    m.update({ ...base, t: 0, points: OPEN, target: 'a' });
    expect(m.update({ ...base, t: 16, points: PINCH, target: 'a' }).click).toBe('a');
    m.update({ ...base, t: 100, points: OPEN, target: 'a' });
    expect(m.pinched).toBe(false);
    expect(m.update({ ...base, t: 200, points: PINCH, target: 'a' }).click).toBeUndefined(); // too soon
    m.update({ ...base, t: 300, points: OPEN, target: 'a' });
    expect(m.update({ ...base, t: 16 + PINCH_DEBOUNCE_MS, points: PINCH, target: 'a' }).click).toBe('a');
  });

  it('has hysteresis: a pinch ends only once the fingers part past PINCH_OFF', () => {
    const m = createPinchMachine<string>();
    m.update({ ...base, t: 0, points: OPEN, target: 'a' });
    m.update({ ...base, t: 16, points: PINCH, target: 'a' });
    expect(m.update({ ...base, t: 32, points: hand((PINCH_ON + PINCH_OFF) / 2), target: 'a' }).pinched).toBe(true);
    expect(m.update({ ...base, t: 48, points: hand(PINCH_OFF + 0.01), target: 'a' }).pinched).toBe(false);
  });

  it('a fist is never a pinch, and a pinch during a grab does nothing', () => {
    const m = createPinchMachine<string>();
    m.update({ ...base, t: 0, points: OPEN, target: 'a' });
    expect(m.update({ ...base, t: 16, points: PINCH, fist: true, target: 'a' }).click).toBeUndefined();
    // the fist opens with the fingers still touching: still no click until they part first
    expect(m.update({ ...base, t: 32, points: PINCH, target: 'a' }).click).toBeUndefined();
    m.update({ ...base, t: 1000, points: OPEN, target: 'a' });
    expect(m.update({ ...base, t: 1016, points: PINCH, grabbed: true, target: 'a' }).click).toBeUndefined();
    m.update({ ...base, t: 2000, points: OPEN, target: 'a' });
    expect(m.update({ ...base, t: 2016, points: PINCH, target: 'a' }).click).toBe('a');
  });

  it('clicks the target from the frame before the pinch, not the one under the shifted hand', () => {
    const m = createPinchMachine<string>();
    m.update({ ...base, t: 0, points: OPEN, target: 'a' });
    expect(m.update({ ...base, t: 16, points: PINCH, target: 'b' }).click).toBe('a');
    m.update({ ...base, t: 1000, points: OPEN, target: null });
    expect(m.update({ ...base, t: 1016, points: PINCH, target: 'b' }).click).toBeUndefined();
  });

  it('does nothing while disabled and needs an open hand first', () => {
    const m = createPinchMachine<string>();
    expect(m.update({ ...base, t: 0, points: PINCH, target: 'a' }).click).toBeUndefined(); // started pinched
    m.update({ ...base, t: 16, points: OPEN, target: 'a' });
    expect(m.update({ ...base, t: 32, points: PINCH, enabled: false, target: 'a' }).click).toBeUndefined();
  });
});
