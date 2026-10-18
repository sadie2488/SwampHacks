// Turns per-frame hand shapes into steady signals: finger counts per hand, and one fingerspelling letter at a time.
// A letter starts only after it has been the clear best guess for `stableMs` (so look-alikes flickering doesn't fire),
// and ends when the hand shows something else (or leaves) for `releaseMs`. If both hands show a letter, the hand
// higher in the picture is the one signing. Pure code; no memory is allocated per frame except the signals sent.
import { HAND, palmCenter, type HandObs, type Side, type SignalOut } from './gestures';
import { HandShape } from './handshape';
import { LETTERS, indexOnlyScore, pickBest, pinkyOnlyScore, scoreLetters } from './letters';
import { Trail, detectJ, detectZ } from './motion';

/**
 * Switched off Sun 6:30 AM: not used (the mode shortcuts that read letters are off); saves CPU; flip to true to
 * bring the letters back. While false, no letter is classified and no `vision.sign.*` signal is sent. Finger counts
 * (`vision.hand.*.fingers`, `vision.hands.fingers`) keep working either way.
 */
export const SIGNS_ENABLED = false;

export interface SignOptions {
  stableMs: number;
  releaseMs: number;
  /** While a letter is on, it stays on as long as its own score is at least this (hysteresis). */
  holdScore: number;
  /** Classify fingerspelling letters and send `vision.sign.*` (defaults to SIGNS_ENABLED). */
  letters: boolean;
}
export const DEFAULT_SIGNS: SignOptions = { stableMs: 300, releaseMs: 200, holdScore: 0.35, letters: SIGNS_ENABLED };

const J = LETTERS.indexOf('j');
const Z = LETTERS.indexOf('z');
const I_ = LETTERS.indexOf('i');
/** Frames a moving hand shape may wobble before its trail is thrown away. */
const TRAIL_GRACE = 3;

class SideSlot {
  readonly shape = new HandShape();
  readonly scores = new Float64Array(26);
  readonly best = { letter: -1, score: 0 };
  readonly pinky = new Trail();
  readonly index = new Trail();
  pinkyMiss = 0;
  indexMiss = 0;
  present = false;
  palmY = 0;
  score = 0;
  /** -1 = nothing, else a letter index; J/Z when their move just finished this frame. */
  letter = -1;
  count = 0;
  private pending = -1;
  measure(t: number, h: HandObs, aspect: number, letters: boolean): void {
    const s = this.shape;
    this.present = s.measure(h.points, aspect, h.side === 'left');
    this.score = h.score;
    if (!this.present) return this.lose();
    this.palmY = palmCenter(h.points).y;
    // Finger count: changes only when the new count is seen two frames running.
    const c = s.fingerCount();
    if (c === this.count) this.pending = -1;
    else if (c === this.pending) this.count = c;
    else this.pending = c;
    if (!letters) {
      this.letter = -1;
      return;
    }
    scoreLetters(s, this.scores);
    this.letter = pickBest(this.scores, this.best).letter;
    // Motion letters: follow the fingertip while the hand keeps the right shape.
    // (x mirrored for a left hand, in picture heights like s.size)
    const sx = h.side === 'left' ? -aspect : aspect;
    const p = h.points;
    if (pinkyOnlyScore(s) >= 0.5) {
      this.pinky.push(t, p[HAND.PINKY_TIP].x * sx, p[HAND.PINKY_TIP].y);
      this.pinkyMiss = 0;
    } else if (++this.pinkyMiss > TRAIL_GRACE) this.pinky.clear();
    if (indexOnlyScore(s) >= 0.5) {
      this.index.push(t, p[HAND.INDEX_TIP].x * sx, p[HAND.INDEX_TIP].y);
      this.indexMiss = 0;
    } else if (++this.indexMiss > TRAIL_GRACE) this.index.clear();
    if (detectJ(this.pinky, s.size)) {
      this.letter = J;
      this.pinky.clear();
    } else if (detectZ(this.index, s.size)) {
      this.letter = Z;
      this.index.clear();
    }
  }
  lose(): void {
    this.present = false;
    this.letter = -1;
    this.count = 0;
    this.pending = -1;
    this.pinky.clear();
    this.index.clear();
  }
  /** Does this hand still show `letter` well enough to keep it on? */
  holds(letter: number, holdScore: number): boolean {
    if (!this.present) return false;
    if (letter === J) return pinkyOnlyScore(this.shape) >= holdScore;
    if (letter === Z) return indexOnlyScore(this.shape) >= holdScore;
    return this.scores[letter] >= holdScore && (this.letter === -1 || this.letter === letter);
  }
}

export class SignTracker {
  readonly sides: Record<Side, SideSlot> = { left: new SideSlot(), right: new SideSlot() };
  /** The letter that is on (-1 = none). */
  active = -1;
  private readonly o: SignOptions;
  private candidate = -1;
  private candidateSince = 0;
  private candidateSeen = 0;
  private missSince = -1;

  constructor(opts: Partial<SignOptions> = {}) {
    this.o = { ...DEFAULT_SIGNS, ...opts };
  }

  /** `hands` holds at most one hand per side. Pushes letter starts/ends onto `out`. */
  update(t: number, left: HandObs | undefined, right: HandObs | undefined, aspect: number, out: SignalOut[]): void {
    const L = this.sides.left;
    const R = this.sides.right;
    if (left) L.measure(t, left, aspect, this.o.letters);
    else L.lose();
    if (right) R.measure(t, right, aspect, this.o.letters);
    else R.lose();
    // Letters switched off (SIGNS_ENABLED): finger counts are measured above, nothing else to do.
    if (!this.o.letters) return;
    // Whichever hand shows a letter; if both, the higher one (smaller y).
    const signer = L.letter >= 0 && R.letter >= 0 ? (L.palmY <= R.palmY ? L : R) : L.letter >= 0 ? L : R;
    // After a J, the hand is still in the I shape: that is the J being held, not a new I.
    const letter = this.active === J && signer.letter === I_ ? J : signer.letter;
    const conf = Math.round(Math.min(1, Math.max(signer.best.score, letter === J || letter === Z ? 0.6 : 0)) * 100) / 100;

    if (this.active >= 0) {
      const held = letter === this.active || (letter === -1 && (L.holds(this.active, this.o.holdScore) || R.holds(this.active, this.o.holdScore)));
      if (held) this.missSince = -1;
      else {
        if (this.missSince < 0) this.missSince = t;
        if (t - this.missSince >= this.o.releaseMs || letter === J || letter === Z) this.end(t, out);
      }
    }
    if (letter === J || letter === Z) {
      // A finished move counts at once (the move itself took longer than the steady time).
      if (this.active !== letter) {
        if (this.active >= 0) this.end(t, out);
        this.start(letter, conf || 0.6, t, out);
      }
      this.candidate = -1;
      return;
    }
    if (letter >= 0) {
      if (letter !== this.candidate) {
        this.candidate = letter;
        this.candidateSince = t;
      }
      this.candidateSeen = t;
    } else if (this.candidate >= 0 && t - this.candidateSeen > this.o.releaseMs) this.candidate = -1;
    if (this.candidate >= 0 && this.candidate !== this.active && letter === this.candidate && t - this.candidateSince >= this.o.stableMs) {
      if (this.active >= 0) this.end(t, out);
      this.start(this.candidate, conf, t, out);
    }
  }

  /** Ends the letter that is on, if any (tracking stopped). */
  reset(t: number, out: SignalOut[]): void {
    if (this.active >= 0) this.end(t, out);
    this.sides.left.lose();
    this.sides.right.lose();
    this.candidate = -1;
  }

  private start(letter: number, conf: number, t: number, out: SignalOut[]): void {
    this.active = letter;
    this.missSince = -1;
    out.push({ id: `vision.sign.${LETTERS[letter]}`, kind: 'moment', state: 'start', confidence: Math.max(0.01, conf), t_ms: t });
  }
  private end(t: number, out: SignalOut[]): void {
    out.push({ id: `vision.sign.${LETTERS[this.active]}`, kind: 'moment', state: 'end', confidence: 1, t_ms: t });
    this.active = -1;
    this.missSince = -1;
  }
}
