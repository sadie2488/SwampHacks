import { describe, expect, it } from 'vitest';
import {
  FACE,
  assignSides,
  curlMax,
  curlMin,
  detectNod,
  downwardSpeed,
  handHeight,
  handX,
  handsDistanceValue,
  handsDistanceWidths,
  headTiltDegrees,
  isFist,
  isOpenPalm,
  isPinch,
  isRaised,
  mirrorPoints,
  pinchRatio,
  raisedLine,
  SWAP_HANDEDNESS,
  THRESHOLDS,
  isThumbsUp,
  thumbRise,
  tiltToSlider,
  type NoseSample,
  type RawHand,
} from './gestures';
import { makeFace, makeHand } from './synthetic';

describe('one hand: fist, open palm, pinch', () => {
  const fist = makeHand({ curl: 1, thumb: 'tucked' });
  const open = makeHand({ curl: 0 });
  const pinch = makeHand({ curl: [0.45, 0.1, 0.1, 0.1], thumb: 'pinch' });

  it('a fist has every fingertip closer to the wrist than its middle joint', () => {
    expect(curlMax(fist)).toBeLessThan(0.85);
    expect(isFist(fist)).toBe(true);
    expect(isOpenPalm(fist)).toBe(false);
  });

  it('an open palm has every finger straight', () => {
    expect(curlMin(open)).toBeGreaterThan(1.25);
    expect(isOpenPalm(open)).toBe(true);
    expect(isFist(open)).toBe(false);
  });

  it('one pointing finger is neither a fist nor an open palm', () => {
    const pointing = makeHand({ curl: [0, 1, 1, 1], thumb: 'tucked' });
    expect(isFist(pointing)).toBe(false);
    expect(isOpenPalm(pointing)).toBe(false);
  });

  it('a relaxed, slightly curled hand is neither', () => {
    const relaxed = makeHand({ curl: 0.35 });
    expect(isFist(relaxed)).toBe(false);
    expect(isOpenPalm(relaxed)).toBe(false);
  });

  it('a pinch has the thumb tip on the index tip, with the other fingers not in a fist', () => {
    expect(pinchRatio(pinch)).toBeLessThan(0.1);
    expect(isPinch(pinch)).toBe(true);
    expect(isFist(pinch)).toBe(false);
    expect(isOpenPalm(pinch)).toBe(false);
    expect(isPinch(open)).toBe(false);
  });

  it('a thumb tucked against a fist does not count as a pinch', () => {
    expect(pinchRatio(fist)).toBeLessThan(0.3); // the thumb really is close to the index finger...
    expect(isPinch(fist)).toBe(false); // ...but it is a fist
  });

  it('sizes do not matter: the same pose far away gives the same answer', () => {
    const far = makeHand({ curl: 1, thumb: 'tucked', size: 0.04 });
    expect(isFist(far)).toBe(true);
    expect(isPinch(makeHand({ curl: [0.45, 0.1, 0.1, 0.1], thumb: 'pinch', size: 0.04 }))).toBe(true);
  });

  it('a thumbs-up is curled fingers with the thumb pointing up; it is not an open palm or a pinch', () => {
    const up = makeHand({ curl: 1, thumb: 'up' });
    expect(thumbRise(up)).toBeGreaterThan(THRESHOLDS.thumbUpOn);
    expect(isThumbsUp(up)).toBe(true);
    expect(isOpenPalm(up)).toBe(false);
    expect(isPinch(up)).toBe(false);
    expect(isThumbsUp(makeHand({ curl: 1, thumb: 'up', size: 0.04 }))).toBe(true);
  });

  it('a plain fist, a fist with the thumb out sideways, and an open hand are not thumbs-ups', () => {
    expect(isThumbsUp(fist)).toBe(false);
    expect(isThumbsUp(makeHand({ curl: 1, thumb: 'out' }))).toBe(false);
    expect(isThumbsUp(makeHand({ curl: 0.5 }))).toBe(false);
    expect(isThumbsUp(makeHand({ curl: 0, thumb: 'up' }))).toBe(false);
  });
});

describe('hand position, raised hand, two hands', () => {
  it('height is 1 at the top of the picture and 0 at the bottom', () => {
    const top = makeHand({ wrist: { x: 0.5, y: 0.2 } });
    const bottom = makeHand({ wrist: { x: 0.5, y: 0.95 } });
    expect(handHeight(top)).toBeGreaterThan(handHeight(bottom));
    // palm centre is about one hand-length above the wrist
    expect(handHeight(makeHand({ wrist: { x: 0.5, y: 0.8 } }))).toBeCloseTo(1 - (0.8 - 0.088), 2);
  });

  it('x is 0 at the left edge of the mirrored picture and grows to the right', () => {
    expect(handX(makeHand({ wrist: { x: 0.2, y: 0.7 } }))).toBeLessThan(handX(makeHand({ wrist: { x: 0.8, y: 0.7 } })));
  });

  it('a hand is raised when its palm is above the forehead (or the top third when no face is seen)', () => {
    const face = makeFace({ center: { x: 0.5, y: 0.45 } }); // forehead near y = 0.45 - 1.2 * 0.12 = 0.31
    expect(raisedLine(face)).toBeCloseTo(0.306, 2);
    expect(isRaised(makeHand({ wrist: { x: 0.5, y: 0.3 } }), face)).toBe(true); // palm at y ~ 0.21
    expect(isRaised(makeHand({ wrist: { x: 0.5, y: 0.7 } }), face)).toBe(false);
    expect(raisedLine(null)).toBe(0.3);
    expect(isRaised(makeHand({ wrist: { x: 0.5, y: 0.3 } }), null)).toBe(true);
    expect(isRaised(makeHand({ wrist: { x: 0.5, y: 0.6 } }), null)).toBe(false);
  });

  it('a face very near the top or bottom of the picture does not move the raised line off the sensible range', () => {
    expect(raisedLine(makeFace({ center: { x: 0.5, y: 0.1 } }))).toBe(0.2);
    expect(raisedLine(makeFace({ center: { x: 0.5, y: 0.9 } }))).toBe(0.5);
  });

  it('two-hand distance is 0 when touching and 1 when far apart', () => {
    const a = makeHand({ wrist: { x: 0.5, y: 0.8 } });
    expect(handsDistanceValue(handsDistanceWidths(a, a))).toBe(0);
    const left = makeHand({ wrist: { x: 0.1, y: 0.8 } });
    const right = makeHand({ wrist: { x: 0.9, y: 0.8 } });
    const widths = handsDistanceWidths(left, right);
    expect(widths).toBeGreaterThan(0.75);
    expect(handsDistanceValue(widths)).toBeCloseTo(1, 5);
    expect(handsDistanceValue(1.5)).toBe(1);
    const middle = handsDistanceWidths(makeHand({ wrist: { x: 0.4, y: 0.8 } }), makeHand({ wrist: { x: 0.6, y: 0.8 } }));
    expect(middle).toBeCloseTo(0.2, 2);
    expect(handsDistanceValue(middle)).toBeCloseTo(0.25, 2);
  });
});

describe('head tilt', () => {
  it('upright is 0 degrees and 0.5 on the slider', () => {
    const deg = headTiltDegrees(makeFace());
    expect(deg).toBeCloseTo(0, 5);
    expect(tiltToSlider(deg)).toBeCloseTo(0.5, 5);
  });

  it('tilting toward the right shoulder is positive, toward the left is negative', () => {
    expect(headTiltDegrees(makeFace({ tiltDeg: 20 }))).toBeCloseTo(20, 3);
    expect(headTiltDegrees(makeFace({ tiltDeg: -30 }))).toBeCloseTo(-30, 3);
    expect(tiltToSlider(20)).toBeCloseTo(65 / 90, 5);
    expect(tiltToSlider(-30)).toBeCloseTo(15 / 90, 5);
  });

  it('maps -45..45 degrees onto 0..1 and stops at the ends', () => {
    expect(tiltToSlider(-45)).toBe(0);
    expect(tiltToSlider(45)).toBe(1);
    expect(tiltToSlider(-80)).toBe(0);
    expect(tiltToSlider(80)).toBe(1);
  });

  it('does not depend on the picture shape or which eye point is which', () => {
    const wide = makeFace({ tiltDeg: 12, aspect: 16 / 9 });
    expect(headTiltDegrees(wide, 16 / 9)).toBeCloseTo(12, 3);
    const swapped = makeFace({ tiltDeg: 12 });
    [swapped[FACE.EYE_OUTER_A], swapped[FACE.EYE_OUTER_B]] = [swapped[FACE.EYE_OUTER_B], swapped[FACE.EYE_OUTER_A]];
    expect(headTiltDegrees(swapped)).toBeCloseTo(12, 3);
  });
});

describe('nod and drum-hit math', () => {
  const at = (ys: number[], step = 1000 / 15): NoseSample[] => ys.map((y, i) => ({ t: i * step, y }));

  it('sees a quick dip and recovery as a nod', () => {
    expect(detectNod(at([2, 2, 2, 2.1, 2.3, 2.45, 2.3, 2.1, 2]))).toBe(true);
  });

  it('does not call it a nod while the head is still going down, or if it never comes back', () => {
    expect(detectNod(at([2, 2, 2, 2.1, 2.3, 2.45]))).toBe(false);
    expect(detectNod(at([2, 2, 2, 2.1, 2.3, 2.45, 2.44, 2.43, 2.43]))).toBe(false);
  });

  it('ignores tiny wobbles and a slow lean', () => {
    expect(detectNod(at([2, 2.02, 2, 2.03, 2.01, 2.02, 2, 2.03, 2]))).toBe(false);
    expect(detectNod(at([2, 2.03, 2.06, 2.09, 2.12, 2.15, 2.18, 2.21, 2.24, 2.27, 2.24, 2.21, 2.18, 2.15, 2.12], 120))).toBe(false);
  });

  it('measures downward wrist speed in hand-sizes per second', () => {
    expect(downwardSpeed({ t: 0, y: 0.5 }, { t: 100, y: 0.62 }, 0.12)).toBeCloseTo(10, 5);
    expect(downwardSpeed({ t: 0, y: 0.5 }, { t: 100, y: 0.38 }, 0.12)).toBeCloseTo(-10, 5);
    expect(downwardSpeed({ t: 100, y: 0.5 }, { t: 100, y: 0.6 }, 0.12)).toBe(0);
  });
});

describe('left and right: MediaPipe sees the plain camera picture, we report the mirrored one', () => {
  const pts = (x: number) => makeHand({ wrist: { x, y: 0.8 } });
  const raw = (label: 'Left' | 'Right', x: number): RawHand => ({ label, score: 0.9, points: pts(x) });

  it('flips every x', () => {
    const m = mirrorPoints([{ x: 0.2, y: 0.3, z: 0.1 }]);
    expect(m[0].x).toBeCloseTo(0.8, 10);
    expect(m[0].y).toBe(0.3);
  });

  it("MediaPipe's label is the user's own hand, and the user's right hand ends up on the right of the mirrored picture", () => {
    // The user's right hand is on the LEFT of the plain camera picture (x small). Tested on real photos: MediaPipe says "Right".
    const [hand] = assignSides([raw('Right', 0.25)]);
    expect(hand.side).toBe('right');
    expect(hand.points[0].x).toBeGreaterThan(0.6);
  });

  it("the user's left hand is on the left of the mirrored picture", () => {
    const [hand] = assignSides([raw('Left', 0.75)]);
    expect(hand.side).toBe('left');
    expect(hand.points[0].x).toBeLessThan(0.4);
  });

  it('if the label ever turns out to be the other way round on a real camera, SWAP_HANDEDNESS fixes it in one place', () => {
    expect(SWAP_HANDEDNESS).toBe(false);
    expect(assignSides([raw('Right', 0.25)], true)[0].side).toBe('left');
    expect(assignSides([raw('Left', 0.75)], true)[0].side).toBe('right');
  });

  it('two hands keep their own sides', () => {
    const hands = assignSides([raw('Right', 0.25), raw('Left', 0.75)]);
    expect(hands.map((h) => h.side)).toEqual(['right', 'left']);
  });

  it('if MediaPipe gives both hands the same label, the one further left on screen is the left hand', () => {
    const hands = assignSides([raw('Left', 0.25), raw('Left', 0.75)]);
    const left = hands.find((h) => h.side === 'left')!;
    const right = hands.find((h) => h.side === 'right')!;
    expect(left.points[0].x).toBeLessThan(right.points[0].x);
  });
});
