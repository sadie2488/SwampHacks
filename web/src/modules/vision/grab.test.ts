import { describe, expect, it } from 'vitest';
import { GestureTracker, type HandObs, type Side, type SignalOut } from './gestures';
import { makeHand, type HandSpec } from './synthetic';

// Grab = an open palm held for a moment, then closed into a fist quickly (Lalitha's "enter" gesture on the menu).
const FRAME = 1000 / 15;
const OPEN: HandSpec = { curl: 0 };
const FIST: HandSpec = { curl: 1, thumb: 'tucked' };
const THUMBS_UP: HandSpec = { curl: 1, thumb: 'up' };
const HALF: HandSpec = { curl: 0.5 }; // half closed: neither an open palm nor a fist

const hand = (side: Side, spec: HandSpec): HandObs => ({ side, score: 0.95, points: makeHand({ wrist: { x: side === 'right' ? 0.7 : 0.3, y: 0.85 }, ...spec }) });

class Rig {
  tracker = new GestureTracker();
  t = 0;
  out: SignalOut[] = [];
  frames(n: number, spec: HandSpec | null, side: Side = 'right'): this {
    for (let i = 0; i < n; i++) {
      this.out.push(...this.tracker.update({ t_ms: this.t, hands: spec ? [hand(side, spec)] : [] }));
      this.t += FRAME;
    }
    return this;
  }
  grabs(side: Side = 'right'): SignalOut[] {
    return this.out.filter((s) => s.id === `vision.hand.${side}.grab`);
  }
}

describe('grab: open palm, then a fist', () => {
  it('fires once, as a one-shot moment, when an open hand closes into a fist', () => {
    const rig = new Rig().frames(8, OPEN).frames(10, FIST);
    const grabs = rig.grabs();
    expect(grabs).toHaveLength(1);
    expect(grabs[0]).toMatchObject({ kind: 'moment', state: 'start' });
    expect(grabs[0].t_ms).toBeGreaterThan(8 * FRAME);
    expect(grabs[0].t_ms).toBeLessThan(8 * FRAME + 300);
    // the plain fist still starts as usual
    expect(rig.out.some((s) => s.id === 'vision.hand.right.fist' && s.state === 'start')).toBe(true);
    // the left hand saw nothing
    expect(rig.grabs('left')).toHaveLength(0);
  });

  it('works for the left hand too', () => {
    const rig = new Rig().frames(8, OPEN, 'left').frames(10, FIST, 'left');
    expect(rig.grabs('left')).toHaveLength(1);
    expect(rig.grabs('right')).toHaveLength(0);
  });

  it('does not fire for a fist alone', () => {
    expect(new Rig().frames(20, FIST).grabs()).toHaveLength(0);
    expect(new Rig().frames(5, null).frames(20, FIST).grabs()).toHaveLength(0);
  });

  it('does not fire for an open palm alone', () => {
    expect(new Rig().frames(30, OPEN).grabs()).toHaveLength(0);
  });

  it('does not fire for a slow close (more than 0.6 s from open to fist)', () => {
    expect(new Rig().frames(8, OPEN).frames(15, HALF).frames(10, FIST).grabs()).toHaveLength(0);
  });

  it('does not fire when the palm only flashed open (shorter than 0.15 s)', () => {
    expect(new Rig().frames(10, FIST).frames(2, OPEN).frames(10, FIST).grabs()).toHaveLength(0);
  });

  it('a thumbs-up after an open palm is not a grab', () => {
    expect(new Rig().frames(8, OPEN).frames(15, THUMBS_UP).grabs()).toHaveLength(0);
    expect(new Rig().frames(8, OPEN, 'left').frames(15, THUMBS_UP, 'left').grabs('left')).toHaveLength(0);
  });

  it('fires at most once a second per hand, and again after that', () => {
    const rig = new Rig().frames(6, OPEN).frames(4, FIST).frames(6, OPEN).frames(4, FIST); // two grabs ~0.7 s apart
    expect(rig.grabs()).toHaveLength(1);
    rig.frames(10, OPEN).frames(6, FIST); // well over a second later
    expect(rig.grabs()).toHaveLength(2);
  });
});
