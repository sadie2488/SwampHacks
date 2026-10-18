// ASL fingerspelling: scores every static letter for one measured hand (see handshape.ts for the hand frame).
// Each letter's score is a product of soft 0-1 checks, so one clearly wrong finger sinks it. J and Z move: see signs.ts.
import { HAND } from './gestures';
import { fall, rise, type HandShape } from './handshape';

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** A letter is reported only when its score is at least this... */
export const MIN_SCORE = 0.5;
/** ...and beats the runner-up (usually its look-alike) by at least this much. */
export const MIN_MARGIN = 0.15;

const I = (c: string): number => c.charCodeAt(0) - 97;
const TIP = [8, 12, 16, 20] as const;

/**
 * Where the thumb tip sits (hand frame) for the closed-fist letters. They differ only in the thumb:
 * A beside the index finger, S across the front of the fingers, T poking up between index and middle,
 * N under index+middle (tip between middle and ring), M under three fingers (tip between ring and little finger).
 */
const FIST_THUMB = { a: [-0.42, 0.78, 0.15], s: [0, 0.75, 0.6], t: [-0.14, 0.95, 0.38], n: [0.12, 0.8, 0.25], m: [0.37, 0.8, 0.25] } as const;
const FIST_KEYS = ['a', 's', 't', 'n', 'm'] as const;
/** K (and P): thumb tip between the spread index and middle fingers, against the middle finger. */
const K_THUMB = [-0.12, 1.3, 0.2] as const;
const SIGMA = 0.15;

function near(h: HandShape, c: readonly number[]): number {
  const p = h.p;
  const t = 3 * HAND.THUMB_TIP;
  const d2 = (p[t] - c[0]) ** 2 + (p[t + 1] - c[1]) ** 2 + (p[t + 2] - c[2]) ** 2;
  return Math.exp(-d2 / (2 * SIGMA * SIGMA));
}
const touching = (h: HandShape, a: number, b: number): number => fall(h.dist(a, b), 0.15, 0.3);

const FIST_NEAR = new Float64Array(5);

/** Fills `out` (26 slots, a..z) with 0-1 scores. J and Z stay 0 here. */
export function scoreLetters(h: HandShape, out: Float64Array): void {
  out.fill(0);
  const S = h.straight;
  const C = h.curled;
  const si = S[0], sm = S[1], sr = S[2], sp = S[3];
  const ci = C[0], cm = C[1], cr = C[2], cp = C[3];
  const thumbX = h.p[3 * HAND.THUMB_TIP];
  const thumbY = h.p[3 * HAND.THUMB_TIP + 1];
  const out_ = h.thumbOut;
  const notSide = 1 - Math.max(h.side, h.down);

  // Closed fist: A, S, T, N, M by where the thumb tip is (shares of the nearest-template weights).
  const fist = ci * cm * cr * cp;
  if (fist > 0) {
    let sum = 0;
    let best = 0;
    for (let k = 0; k < 5; k++) {
      FIST_NEAR[k] = near(h, FIST_THUMB[FIST_KEYS[k]]);
      sum += FIST_NEAR[k];
      if (FIST_NEAR[k] > best) best = FIST_NEAR[k];
    }
    const gate = rise(best, 0.05, 0.2);
    for (let k = 0; k < 5; k++) out[I(FIST_KEYS[k])] = (fist * gate * FIST_NEAR[k]) / (sum + 1e-9);
  }
  const hooked = h.hooked[0] * h.hooked[1] * h.hooked[2] * h.hooked[3];
  // E: all four fingertips hooked down onto a thumb that lies low across the palm.
  out[I('e')] = hooked * rise(thumbX, -0.3, -0.1) * fall(thumbY, 0.8, 0.95);

  const allStraight = si * sm * sr * sp;
  // B: flat hand, fingers together, thumb folded across the palm.
  const together = fall(Math.abs(h.spreadIM), 10, 18);
  out[I('b')] = allStraight * together * rise(thumbX, -0.3, -0.15);

  const allBent = h.bent[0] * h.bent[1] * h.bent[2] * h.bent[3];
  const thumbIndex = h.dist(HAND.THUMB_TIP, HAND.INDEX_TIP);
  // C: curved hand with a gap between thumb and fingertips. O: the same curve closed (thumb tip touches the index tip).
  out[I('c')] = allBent * rise(thumbIndex, 0.25, 0.4) * (1 - out_);
  out[I('o')] = allBent * fall(thumbIndex, 0.15, 0.3);

  // D: index up, the other three bent onto the thumb tip.
  out[I('d')] = si * (1 - sm) * (1 - sr) * (1 - sp) * touching(h, HAND.THUMB_TIP, TIP[1]) * notSide;
  // F: thumb and index tips touch, the other three straight.
  out[I('f')] = (1 - si) * sm * sr * sp * touching(h, HAND.THUMB_TIP, TIP[0]);

  // Index only (G, Q, L): G/Q have the thumb along the index (G sideways, Q pointing down); L has it out at a right angle.
  const indexOnly = si * cm * cr * cp;
  const thumbAlong = rise(thumbY, 0.95, 1.1) * rise(-thumbX, 0.25, 0.35) * (1 - out_);
  out[I('g')] = indexOnly * thumbAlong * h.side;
  out[I('q')] = indexOnly * thumbAlong * h.down;
  out[I('l')] = indexOnly * out_ * notSide;

  // Index + middle up (H, U, V, R, K, P).
  const two = si * sm * cr * cp;
  const kThumb = near(h, K_THUMB);
  const crossed = rise(h.crossIM, 0, 0.06);
  const apart = rise(h.spreadIM, 10, 16);
  const closed = fall(h.spreadIM, 8, 14) * (1 - crossed);
  out[I('h')] = two * closed * (1 - kThumb) * h.side;
  out[I('u')] = two * closed * (1 - kThumb) * notSide;
  out[I('v')] = two * apart * (1 - kThumb) * notSide;
  out[I('r')] = two * crossed * (1 - kThumb);
  out[I('k')] = two * rise(h.spreadIM, 4, 10) * kThumb * (1 - h.down);
  out[I('p')] = two * rise(h.spreadIM, 4, 10) * kThumb * h.down;

  // W: index, middle, ring up and spread; little finger down.
  out[I('w')] = si * sm * sr * cp * rise(h.spreadIM, 6, 12);
  // X: index hooked, the others curled.
  out[I('x')] = h.hooked[0] * (1 - si) * cm * cr * cp;
  // I and Y: little finger up; Y also has the thumb out.
  const pinkyOnly = sp * ci * cm * cr;
  out[I('i')] = pinkyOnly * (1 - out_);
  out[I('y')] = pinkyOnly * out_;
}

/** Index finger alone up (the Z hand shape, also the number 1), 0-1. */
export const indexOnlyScore = (h: HandShape): number => h.straight[0] * h.curled[1] * h.curled[2] * h.curled[3] * (1 - h.thumbOut);
/** Little finger alone up (the I and J hand shape), 0-1. */
export const pinkyOnlyScore = (h: HandShape): number => h.straight[3] * h.curled[0] * h.curled[1] * h.curled[2] * (1 - h.thumbOut);

/** The best letter's index (0 = a) and its score, or -1 when nothing is clear enough. Uses `scores` as scratch. */
export function bestLetter(h: HandShape, scores: Float64Array): { letter: number; score: number } {
  scoreLetters(h, scores);
  return pickBest(scores, RESULT);
}
const RESULT = { letter: -1, score: 0 };

export function pickBest(scores: Float64Array, r: { letter: number; score: number }): { letter: number; score: number } {
  let b = -1;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i];
    if (v > s1) {
      s2 = s1;
      s1 = v;
      b = i;
    } else if (v > s2) s2 = v;
  }
  r.letter = s1 >= MIN_SCORE && s1 - s2 >= MIN_MARGIN ? b : -1;
  r.score = s1;
  return r;
}
