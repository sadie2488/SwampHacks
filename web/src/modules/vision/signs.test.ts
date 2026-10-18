import { describe, expect, it } from 'vitest';
import { DEFAULT_ASPECT, GestureTracker, type HandObs, type Pt, type Side, type SignalOut } from './gestures';
import { LETTER_POSES, RELAXED_POSE, countPose, makePose, type PoseSpec } from './synthetic';

const FRAME = 1000 / 15;
const SIZE = 0.15;
/** A hand at a spot given in hand sizes from its home position (x toward the signer's right on screen). */
const at = (side: Side, spec: PoseSpec, dx = 0, dy = 0, homeY = 0.7): HandObs => {
  const home: Pt = { x: side === 'right' ? 0.65 : 0.35, y: homeY };
  return { side, score: 0.95, points: makePose({ ...spec, side, size: SIZE, wrist: { x: home.x + (dx * SIZE) / DEFAULT_ASPECT, y: home.y + dy * SIZE } }) };
};

class Rig {
  tracker = new GestureTracker();
  t = 0;
  out: SignalOut[] = [];
  frames(n: number, make: (i: number) => HandObs[]): this {
    for (let i = 0; i < n; i++) {
      this.out.push(...this.tracker.update({ t_ms: this.t, hands: make(i) }));
      this.t += FRAME;
    }
    return this;
  }
  signs(): string[] {
    return this.out.filter((s) => s.id.startsWith('vision.sign.')).map((s) => `${s.state} ${s.id.slice(12)}`);
  }
  firstStart(): number | undefined {
    return this.out.find((s) => s.id.startsWith('vision.sign.') && s.state === 'start')?.t_ms;
  }
  last(id: string): SignalOut | undefined {
    return [...this.out].reverse().find((s) => s.id === id);
  }
}

describe('fingerspelling letters over time', () => {
  it('a letter starts only after about 0.3 s held steady, and ends when the hand leaves', () => {
    const rig = new Rig().frames(15, () => [at('right', LETTER_POSES.b)]);
    expect(rig.firstStart()).toBeGreaterThanOrEqual(300);
    expect(rig.firstStart()).toBeLessThan(400);
    rig.frames(6, () => []);
    expect(rig.signs()).toEqual(['start b', 'end b']);
  });

  it('a quick glimpse (under 0.3 s) fires nothing', () => {
    const rig = new Rig().frames(3, () => [at('right', LETTER_POSES.v)]).frames(10, () => [at('right', RELAXED_POSE)]);
    expect(rig.signs()).toEqual([]);
  });

  it('flicker between look-alikes (S/T, U/V) fires nothing', () => {
    const st = new Rig().frames(20, (i) => [at('right', i % 2 ? LETTER_POSES.s : LETTER_POSES.t)]);
    expect(st.signs()).toEqual([]);
    const uv = new Rig().frames(20, (i) => [at('right', i % 3 ? LETTER_POSES.u : LETTER_POSES.v)]);
    expect(uv.signs()).toEqual([]);
  });

  it('changing letter ends the old one before the new one starts; one letter at a time', () => {
    const rig = new Rig().frames(10, () => [at('right', LETTER_POSES.a)]).frames(10, () => [at('right', LETTER_POSES.l)]);
    expect(rig.signs()).toEqual(['start a', 'end a', 'start l']);
  });

  it('a relaxed hand fires no letter', () => {
    expect(new Rig().frames(30, () => [at('right', RELAXED_POSE), at('left', RELAXED_POSE)]).signs()).toEqual([]);
  });

  it('works with the left hand, and when both hands sign the higher hand wins', () => {
    expect(new Rig().frames(10, () => [at('left', LETTER_POSES.y)]).signs()).toEqual(['start y']);
    const both = new Rig().frames(10, () => [at('left', LETTER_POSES.w, 0, 0, 0.5), at('right', LETTER_POSES.c, 0, 0, 0.8)]);
    expect(both.signs()).toEqual(['start w']);
  });

  for (const side of ['right', 'left'] as const) {
    it(`J: the ${side} hand in the I shape draws a hook`, () => {
      // toward the thumb = screen left for the right hand, screen right for the (mirrored) left hand
      const toThumb = side === 'right' ? -1 : 1;
      const rig = new Rig().frames(6, () => [at(side, LETTER_POSES.j)]);
      rig.frames(6, (i) => [at(side, LETTER_POSES.j, 0, 0.1 * (i + 1))]);
      rig.frames(5, (i) => [at(side, LETTER_POSES.j, toThumb * 0.1 * (i + 1), 0.6 - 0.03 * i)]);
      rig.frames(3, () => [at(side, LETTER_POSES.j, toThumb * 0.5, 0.48)]);
      expect(rig.signs()).toEqual(['start i', 'end i', 'start j']);
    });

    it(`Z: the ${side} index finger draws a Z`, () => {
      const across = side === 'right' ? 1 : -1;
      const rig = new Rig().frames(4, () => [at(side, LETTER_POSES.z)]);
      rig.frames(5, (i) => [at(side, LETTER_POSES.z, across * 0.15 * (i + 1), 0)]);
      rig.frames(5, (i) => [at(side, LETTER_POSES.z, across * (0.75 - 0.15 * (i + 1)), 0.12 * (i + 1))]);
      rig.frames(5, (i) => [at(side, LETTER_POSES.z, across * 0.15 * (i + 1), 0.6)]);
      expect(rig.signs()).toEqual(['start z']);
      rig.frames(5, () => [at(side, LETTER_POSES.b)]);
      expect(rig.signs().slice(0, 2)).toEqual(['start z', 'end z']);
    });
  }

  it('an index finger moving straight across (no Z) and an I hand moving straight down (no J) fire nothing', () => {
    const z = new Rig().frames(15, (i) => [at('right', LETTER_POSES.z, 0.1 * i, 0)]);
    expect(z.signs()).toEqual([]);
    const j = new Rig().frames(4, () => [at('right', LETTER_POSES.j)]).frames(10, (i) => [at('right', LETTER_POSES.j, 0, 0.08 * i)]);
    expect(j.signs().filter((s) => s.endsWith(' j'))).toEqual([]);
  });
});

describe('finger count sliders', () => {
  it('0..5 per hand and 0..10 for both, with raw = the count', () => {
    for (let l = 0; l <= 5; l++) {
      const r = 5 - Math.min(l, 3);
      const rig = new Rig().frames(4, () => [at('left', countPose(l)), at('right', countPose(r))]);
      expect(rig.last('vision.hand.left.fingers')?.raw).toBe(l);
      expect(rig.last('vision.hand.left.fingers')?.value).toBeCloseTo(l / 5);
      expect(rig.last('vision.hand.right.fingers')?.raw).toBe(r);
      expect(rig.last('vision.hands.fingers')?.raw).toBe(l + r);
      expect(rig.last('vision.hands.fingers')?.value).toBeCloseTo((l + r) / 10);
    }
    expect(new Rig().frames(4, () => [at('left', countPose(5)), at('right', countPose(5))]).last('vision.hands.fingers')?.raw).toBe(10);
    expect(new Rig().frames(4, () => [at('right', countPose(0))]).last('vision.hands.fingers')?.raw).toBe(0);
  });

  it('one odd frame does not change the count', () => {
    const rig = new Rig().frames(4, () => [at('right', countPose(3))]).frames(1, () => [at('right', countPose(1))]).frames(1, () => [at('right', countPose(3))]);
    expect(rig.out.filter((s) => s.id === 'vision.hand.right.fingers').map((s) => s.raw)).not.toContain(1);
  });
});
