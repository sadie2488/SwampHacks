import { describe, expect, it } from 'vitest';
import { createDragStepper, HAND_STEP_PX } from './hand-drag';
import { createHoldMachine } from './hand-pointer';

describe('hand drag on the record menu', () => {
  it('a 330 px drag to the left moves 3 records (next), to the right 3 back', () => {
    const s = createDragStepper();
    expect(HAND_STEP_PX).toBe(110);
    s.feed({ phase: 'start', dx: 0 });
    let total = 0;
    for (let i = 0; i < 33; i++) total += s.feed({ phase: 'move', dx: -10 });
    expect(total).toBe(3);
    s.feed({ phase: 'end', dx: 0 });
    s.feed({ phase: 'start', dx: 0 });
    expect(s.feed({ phase: 'move', dx: 330 })).toBe(-3);
  });
  it('leans toward the drag, at most 40 px, and springs back on release', () => {
    const s = createDragStepper();
    s.feed({ phase: 'start', dx: 0 });
    s.feed({ phase: 'move', dx: 55 });
    expect(s.nudge).toBeCloseTo(20);
    s.feed({ phase: 'move', dx: 50 });
    expect(s.nudge).toBeLessThanOrEqual(40);
    s.feed({ phase: 'end', dx: 0 });
    expect(s.nudge).toBe(0);
  });
  it('resets between grabs and a release without movement does not step', () => {
    const s = createDragStepper();
    s.feed({ phase: 'start', dx: 0 });
    expect(s.feed({ phase: 'move', dx: -100 })).toBe(0);
    expect(s.feed({ phase: 'end', dx: 0 })).toBe(0);
    s.feed({ phase: 'start', dx: 0 });
    expect(s.feed({ phase: 'move', dx: -20 })).toBe(0); // the 100 from the last grab is gone
    expect(s.feed({ phase: 'end', dx: 0 })).toBe(0);
    expect(s.feed({ phase: 'start', dx: 0 }) + s.feed({ phase: 'end', dx: 0 })).toBe(0);
  });
  it('vertical hand motion moves no records (the drag only carries dx)', () => {
    const m = createHoldMachine<string>();
    const s = createDragStepper();
    m.update({ t: 0, x: 0, y: 0, fist: false, open: true, target: null, enabled: true });
    m.update({ t: 10, x: 0, y: 0, fist: true, open: false, target: null, enabled: true });
    s.feed({ phase: 'start', dx: 0 });
    let total = 0;
    for (let i = 1; i <= 40; i++) {
      const out = m.update({ t: 10 + i * 16, x: 0, y: -i * 15, fist: true, open: false, target: null, enabled: true });
      expect(m.phase).toBe('dragging');
      if (out.move?.dx) total += s.feed({ phase: 'move', dx: out.move.dx });
    }
    expect(total).toBe(0);
  });
});
