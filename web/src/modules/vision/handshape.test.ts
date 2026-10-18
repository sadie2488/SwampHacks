import { describe, expect, it } from 'vitest';
import { DEFAULT_ASPECT, type Side } from './gestures';
import { HandShape } from './handshape';
import { LETTERS, bestLetter, scoreLetters } from './letters';
import { LETTER_POSES, RELAXED_POSE, countPose, makePose, type PoseSpec } from './synthetic';

const shape = (spec: PoseSpec, side: Side = 'right'): HandShape => {
  const h = new HandShape();
  expect(h.measure(makePose({ ...spec, side }), DEFAULT_ASPECT, side === 'left')).toBe(true);
  return h;
};
const scores = new Float64Array(26);
const top = (h: HandShape): string => {
  scoreLetters(h, scores);
  return [...scores].map((s, i) => [LETTERS[i], s] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l, s]) => `${l}=${s.toFixed(2)}`).join(' ');
};
const read = (h: HandShape): string => {
  const r = bestLetter(h, scores);
  return r.letter < 0 ? '-' : LETTERS[r.letter];
};

/** Letters that are easy to mix up with each one: the pose must not read as any of these. */
const LOOK_ALIKES: Record<string, string> = {
  a: 'senmt', b: 'u4', c: 'o', d: 'lfz', e: 'smna', f: 'bo', g: 'qlhd', h: 'ugk', i: 'yj', k: 'vprh', l: 'gd', m: 'nst', n: 'mts',
  o: 'ce', p: 'kq', q: 'gp', r: 'uv', s: 'atne', t: 'sna', u: 'vrh', v: 'ukr', w: 'vf', x: 'dz', y: 'il',
};
const STATIC = [...'abcdefghiklmnopqrstuvwxy'];

describe('fingerspelling letters from made-up hand poses', () => {
  for (const side of ['right', 'left'] as const) {
    for (const c of STATIC) {
      it(`${side} hand ${c.toUpperCase()} reads as ${c.toUpperCase()}, not a look-alike`, () => {
        const h = shape(LETTER_POSES[c], side);
        const got = read(h);
        expect(got, top(h)).toBe(c);
        for (const other of LOOK_ALIKES[c] ?? '') expect(got).not.toBe(other);
      });
    }
  }

  it('the J and Z starting shapes are not static letters (I aside, J starts as I)', () => {
    expect(read(shape(LETTER_POSES.j))).toBe('i');
    expect(read(shape(LETTER_POSES.z))).toBe('-');
  });

  it('a relaxed hand and an open five read as no letter', () => {
    expect(read(shape(RELAXED_POSE)), top(shape(RELAXED_POSE))).toBe('-');
    expect(read(shape(countPose(5)))).toBe('-');
  });

  it('a weak, in-between shape is not reported (below the confidence bar)', () => {
    // halfway between S (thumb in front) and T (thumb between index and middle)
    const h = shape({ ...LETTER_POSES.s, thumb: [-0.07, 0.85, 0.49] });
    expect(read(h), top(h)).toBe('-');
  });
});

describe('finger counts', () => {
  for (const side of ['right', 'left'] as const) {
    for (let n = 0; n <= 5; n++) {
      it(`${side} hand holding up ${n}`, () => {
        expect(shape(countPose(n), side).fingerCount()).toBe(n);
      });
    }
  }
  it('letters count the way they look: L = 2, Y = 2, W = 3, B = 4, A = 0', () => {
    expect(shape(LETTER_POSES.l).fingerCount()).toBe(2);
    expect(shape(LETTER_POSES.y).fingerCount()).toBe(2);
    expect(shape(LETTER_POSES.w).fingerCount()).toBe(3);
    expect(shape(LETTER_POSES.b).fingerCount()).toBe(4);
    expect(shape(LETTER_POSES.a).fingerCount()).toBe(0);
  });
});
