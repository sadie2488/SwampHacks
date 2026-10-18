import { describe, expect, it } from 'vitest';
import { createDragStepper, HAND_FIRST_STEP_PX, HAND_NUDGE_PX, HAND_STEP_PX } from './hand-drag';
import { createHoldMachine, MENU_FEEL, menuTarget, type MenuItem } from './hand-pointer';

// the record menu: chosen record in the middle, a side record to the right, a header button at the top
const items: MenuItem<string>[] = [
  { item: 'chosen', box: { left: 500, top: 300, right: 800, bottom: 600 }, record: true, chosen: true },
  { item: 'next', box: { left: 950, top: 350, right: 1150, bottom: 550 }, record: true },
  { item: 'header', box: { left: 40, top: 20, right: 140, bottom: 68 } },
];

/** Open hand, then a fist at (x0, y0); `path(i)` gives the offset at frame i (16 ms frames). Returns clicks and moves. */
function grab(target: string | null, frames: number, path: (i: number) => { dx: number; dy: number }, x0 = 650, y0 = 450) {
  const m = createHoldMachine<string>();
  const s = createDragStepper(HAND_STEP_PX, HAND_NUDGE_PX, HAND_FIRST_STEP_PX);
  const at = (t: number, x: number, y: number, fist: boolean) => m.update({ t, x, y, fist, open: !fist, target, enabled: true, feel: MENU_FEEL });
  at(0, x0, y0, false);
  at(16, x0, y0, true);
  const clicks: string[] = [];
  let steps = 0;
  let dragging = false;
  for (let i = 1; i <= frames; i++) {
    const { dx, dy } = path(i);
    const out = at(16 + i * 16, x0 + dx, y0 + dy, true);
    if (out.click) clicks.push(out.click);
    if (m.phase === 'dragging' && !dragging) s.feed({ phase: 'start', dx: 0 });
    dragging = m.phase === 'dragging';
    if (out.move?.dx) steps += s.feed({ phase: 'move', dx: out.move.dx });
  }
  return { clicks, steps, phase: m.phase };
}

describe('grabbing records on the menu', () => {
  it('a fist anywhere on the menu grabs the chosen record', () => {
    expect(menuTarget({ x: 650, y: 450 }, null, items)).toBe('chosen');
    expect(menuTarget({ x: 300, y: 700 }, null, items)).toBe('chosen'); // far from everything
    expect(menuTarget({ x: 860, y: 450 }, null, items)).toBe('chosen'); // within the chosen record's padding
  });
  it('a record reaches 80 px past its box; a button only 48 px', () => {
    expect(menuTarget({ x: 1220, y: 450 }, null, items)).toBe('next'); // 70 px right of the side record
    expect(menuTarget({ x: 160, y: 40 }, null, items)).toBe('header'); // 20 px from the button
    expect(menuTarget({ x: 240, y: 40 }, null, items)).toBe('chosen'); // 100 px from the button: too far
  });
  it('a fist right over a header button (or another record) grabs that one instead', () => {
    expect(menuTarget({ x: 90, y: 40 }, 'header', items)).toBe('header');
    expect(menuTarget({ x: 1000, y: 450 }, 'next', items)).toBe('next');
  });
  it('a fist with 30 px jitter for 700 ms enters the chosen record', () => {
    const jitter = (i: number) => ({ dx: 30 * Math.sin(i * 1.7), dy: 30 * Math.cos(i * 2.3) });
    const r = grab(menuTarget({ x: 650, y: 450 }, null, items), 44, jitter); // 44 frames x 16 ms = 704 ms
    expect(r.clicks).toEqual(['chosen']);
    expect(r.steps).toBe(0);
  });
  it('a 40 px vertical wobble never cancels the hold', () => {
    const wobble = (i: number) => ({ dx: 0, dy: 40 * Math.sin(i * 0.5) });
    const r = grab('chosen', 44, wobble);
    expect(r.clicks).toEqual(['chosen']);
  });
  it('a 60 px sideways move turns the carousel and does not click', () => {
    const swipe = (i: number) => ({ dx: -Math.min(60, i * 6), dy: 0 }); // 60 px left over 10 frames, then held there
    const r = grab('chosen', 60, swipe);
    expect(r.phase).toBe('dragging');
    expect(r.clicks).toEqual([]);
    expect(r.steps).toBe(1); // pulling left goes to the next record
  });
  it('a fist over a header button clicks that button', () => {
    const r = grab(menuTarget({ x: 90, y: 40 }, 'header', items), 44, (i) => ({ dx: 10 * Math.sin(i), dy: 10 * Math.cos(i) }), 90, 40);
    expect(r.clicks).toEqual(['header']);
  });
  it('other screens keep the strict feel: 12 px dead zone and a 1000 ms hold', () => {
    const m = createHoldMachine<string>();
    const at = (t: number, x: number, fist: boolean) => m.update({ t, x, y: 0, fist, open: !fist, target: 'btn', enabled: true });
    at(0, 0, false);
    at(16, 0, true);
    expect(at(720, 0, true).click).toBeUndefined(); // 700 ms is not enough off the menu
    at(740, 20, true);
    expect(m.phase).toBe('dragging');
  });
});
