// Gesture math for the camera module. Pure code: no browser, no bus, so it can be tested in Node.
//
// Coordinates: every point is 0-1 across the camera image, x to the right and y DOWN, in the MIRRORED (selfie) view,
// so x = 0 is the user's own left edge as they see it on screen. Distances are measured in "picture-height" units
// (x is multiplied by the image's width/height ratio) so a circle stays a circle.
import type { Signal } from '@/contracts';

export interface Pt {
  x: number;
  y: number;
  z?: number;
}
export type Side = 'left' | 'right';
/** A reading ready to hand to sendSignal (version is added there). */
export type SignalOut = Omit<Signal, 'version'>;

// ---- landmark numbers (MediaPipe hand: 21 points, face mesh: 478 points) ----
export const HAND = { WRIST: 0, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_PIP: 6, INDEX_TIP: 8, MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12, RING_MCP: 13, RING_PIP: 14, RING_TIP: 16, PINKY_MCP: 17, PINKY_PIP: 18, PINKY_TIP: 20 } as const;
export const FACE = { FOREHEAD: 10, NOSE_TIP: 1, EYE_OUTER_A: 33, EYE_OUTER_B: 263, CHIN: 152 } as const;
/** [fingertip, middle joint] for index, middle, ring, pinky. The thumb is left out: it bends sideways. */
const FINGERS: ReadonlyArray<readonly [number, number]> = [
  [HAND.INDEX_TIP, HAND.INDEX_PIP],
  [HAND.MIDDLE_TIP, HAND.MIDDLE_PIP],
  [HAND.RING_TIP, HAND.RING_PIP],
  [HAND.PINKY_TIP, HAND.PINKY_PIP],
];
const PALM_POINTS = [HAND.WRIST, HAND.INDEX_MCP, HAND.MIDDLE_MCP, HAND.RING_MCP, HAND.PINKY_MCP];

export const DEFAULT_ASPECT = 4 / 3;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round = (v: number, places = 3): number => Math.round(v * 10 ** places) / 10 ** places;

/** Distance between two points in picture-height units. */
export function dist(a: Pt, b: Pt, aspect = DEFAULT_ASPECT): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

// ---- thresholds (lower = easier to trigger). "on" and "off" differ on purpose: that gap is the hysteresis ----
export const THRESHOLDS = {
  /** Fist: even the least curled finger has its tip closer to the wrist than (this x) its middle joint. */
  fistOn: 0.85,
  fistOff: 1.05,
  /** Thumb extension relative to hand size for a thumbs-up; lower release threshold provides hysteresis. */
  thumbUpOn: 0.12,
  thumbUpOff: 0.08,
  /** Thumb tip rises this share of hand size above its middle joint for a thumbs-up. */
  thumbUpMin: 0.12,
  /** Open palm: even the most curled finger has its tip farther from the wrist than (this x) its middle joint. */
  openOn: 1.25,
  openOff: 1.12,
  /** Pinch: thumb tip to index tip, as a fraction of hand size. */
  pinchOn: 0.3,
  pinchOff: 0.5,
  /** Raised: palm above the forehead line; the line is kept between these two heights (0 = top of picture). */
  raisedLineMin: 0.2,
  raisedLineMax: 0.5,
  /** Used when no face is being tracked. */
  raisedLineNoFace: 0.3,
  raisedOffMargin: 0.06,
  /** Two-hand distance (in picture widths) that counts as "far apart" = 1. */
  handsFarWidths: 0.8,
  /** Drum hit: wrist moving down faster than this many hand-sizes per second; must slow below drumRearm to hit again. */
  drumSpeed: 5,
  drumRearm: 1.5,
  /** Head tilt shown on the slider: -45..45 degrees maps to 0..1. */
  tiltMaxDeg: 45,
  /** Nod: nose dips down by at least this many eye-distances, then comes back up by this share of the dip, quickly. */
  nodDepth: 0.22,
  nodRecover: 0.6,
  nodMaxDownMs: 600,
  nodWindowMs: 1000,
} as const;

// ---- one hand ----
export function handSize(hand: Pt[], aspect = DEFAULT_ASPECT): number {
  return dist(hand[HAND.WRIST], hand[HAND.MIDDLE_MCP], aspect);
}

/** Middle of the palm (wrist and the four knuckles): steadier than the wrist or a fingertip. */
export function palmCenter(hand: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const i of PALM_POINTS) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

/** For each of the 4 fingers: distance(tip, wrist) / distance(middle joint, wrist). Above ~1.3 = straight, below ~0.8 = curled. */
export function fingerCurlRatios(hand: Pt[], aspect = DEFAULT_ASPECT): number[] {
  const wrist = hand[HAND.WRIST];
  return FINGERS.map(([tip, pip]) => dist(hand[tip], wrist, aspect) / Math.max(1e-6, dist(hand[pip], wrist, aspect)));
}

/** The least curled finger's ratio. Small = every finger is curled (fist). */
export const curlMax = (hand: Pt[], aspect = DEFAULT_ASPECT): number => Math.max(...fingerCurlRatios(hand, aspect));
/** The most curled finger's ratio. Large = every finger is straight (open palm). */
export const curlMin = (hand: Pt[], aspect = DEFAULT_ASPECT): number => Math.min(...fingerCurlRatios(hand, aspect));

/** Thumb tip to index tip, as a fraction of hand size. Near 0 = touching. */
export function pinchRatio(hand: Pt[], aspect = DEFAULT_ASPECT): number {
  return dist(hand[HAND.THUMB_TIP], hand[HAND.INDEX_TIP], aspect) / Math.max(1e-6, handSize(hand, aspect));
}

export const isFist = (hand: Pt[], aspect = DEFAULT_ASPECT): boolean => curlMax(hand, aspect) < THRESHOLDS.fistOn;
export const isOpenPalm = (hand: Pt[], aspect = DEFAULT_ASPECT): boolean => curlMin(hand, aspect) > THRESHOLDS.openOn;
export const isPinch = (hand: Pt[], aspect = DEFAULT_ASPECT): boolean => pinchRatio(hand, aspect) < THRESHOLDS.pinchOn && !isFist(hand, aspect);
export const isThumbsUp = (hand: Pt[], aspect = DEFAULT_ASPECT): boolean => {
  const size = handSize(hand, aspect);
  const rise = hand[HAND.THUMB_IP].y - hand[HAND.THUMB_TIP].y;
  return curlMax(hand, aspect) < THRESHOLDS.fistOff && rise / Math.max(1e-6, size) >= THRESHOLDS.thumbUpOn;
};

/** The height (0 = top of picture) a palm has to be above to count as "raised above the head". */
export function raisedLine(face?: Pt[] | null): number {
  const forehead = face?.[FACE.FOREHEAD];
  if (!forehead) return THRESHOLDS.raisedLineNoFace;
  return Math.min(THRESHOLDS.raisedLineMax, Math.max(THRESHOLDS.raisedLineMin, forehead.y));
}
export const isRaised = (hand: Pt[], face?: Pt[] | null): boolean => palmCenter(hand).y < raisedLine(face);

/** 1 = top of the picture, 0 = bottom. */
export const handHeight = (hand: Pt[]): number => clamp01(1 - palmCenter(hand).y);
/** 0 = the user's left edge as shown in the mirrored view, 1 = the right edge. */
export const handX = (hand: Pt[]): number => clamp01(palmCenter(hand).x);

// ---- two hands ----
/** Distance between the two palm centres in picture widths (0 = touching). */
export function handsDistanceWidths(a: Pt[], b: Pt[], aspect = DEFAULT_ASPECT): number {
  return dist(palmCenter(a), palmCenter(b), aspect) / aspect;
}
/** Slider form: 0 = touching, 1 = far apart (about 0.8 of the picture width or more). */
export const handsDistanceValue = (widths: number): number => clamp01(widths / THRESHOLDS.handsFarWidths);

// ---- head ----
/**
 * Head tilt in degrees from the line through the outer corners of the eyes: 0 = upright, positive = head tipped toward
 * the user's right shoulder (clockwise on the mirrored picture), negative = toward the left shoulder.
 * Works on whichever eye is on which side, so it doesn't care how the two corners are labelled.
 */
export function headTiltDegrees(face: Pt[], aspect = DEFAULT_ASPECT): number {
  const p = face[FACE.EYE_OUTER_A];
  const q = face[FACE.EYE_OUTER_B];
  const [left, right] = p.x <= q.x ? [p, q] : [q, p];
  return (Math.atan2(right.y - left.y, (right.x - left.x) * aspect) * 180) / Math.PI;
}
/** -45..45 degrees -> 0..1 with 0.5 upright. */
export const tiltToSlider = (deg: number): number => clamp01((deg + THRESHOLDS.tiltMaxDeg) / (2 * THRESHOLDS.tiltMaxDeg));

/** Distance between the outer eye corners: the yardstick for how big the head is in the picture. */
export function eyeDistance(face: Pt[], aspect = DEFAULT_ASPECT): number {
  return dist(face[FACE.EYE_OUTER_A], face[FACE.EYE_OUTER_B], aspect);
}

export interface NoseSample {
  t: number;
  /** Nose height in eye-distances (bigger = lower). */
  y: number;
}
/** Did the nose just dip down and come back up, quickly? `samples` are oldest first and end with "now". */
export function detectNod(samples: NoseSample[], o: Pick<typeof THRESHOLDS, 'nodDepth' | 'nodRecover' | 'nodMaxDownMs' | 'nodWindowMs'> = THRESHOLDS): boolean {
  const last = samples[samples.length - 1];
  if (!last) return false;
  const w = samples.filter((s) => last.t - s.t <= o.nodWindowMs);
  if (w.length < 4) return false;
  let bottom = 0;
  for (let i = 1; i < w.length; i++) if (w[i].y > w[bottom].y) bottom = i;
  if (bottom === 0 || bottom === w.length - 1) return false; // still going down, or never went down
  // The lowest the nose was in the short stretch just before the bottom: where the dip started.
  let top = -1;
  for (let i = 0; i < bottom; i++) if (w[i].t >= w[bottom].t - o.nodMaxDownMs && (top < 0 || w[i].y < w[top].y)) top = i;
  if (top < 0) return false;
  const depth = w[bottom].y - w[top].y;
  if (depth < o.nodDepth) return false; // too small, or a slow lean rather than a quick dip
  return w[bottom].y - last.y >= o.nodRecover * depth;
}

/** How fast the wrist is moving down, in hand-sizes per second (negative = moving up). */
export function downwardSpeed(prev: { t: number; y: number }, cur: { t: number; y: number }, size: number): number {
  const dt = (cur.t - prev.t) / 1000;
  if (dt <= 0 || size <= 0) return 0;
  return (cur.y - prev.y) / size / dt;
}

// ---- from MediaPipe's raw output to "the user's left and right hand" ----
export interface RawHand {
  /** MediaPipe's own label. */
  label: 'Left' | 'Right';
  score: number;
  /** Points exactly as MediaPipe returned them (NOT mirrored). */
  points: Pt[];
}
export interface HandObs {
  side: Side;
  score: number;
  /** Mirrored view coordinates. */
  points: Pt[];
}

export const mirrorPoints = (points: Pt[]): Pt[] => points.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0 }));

/**
 * Which way round MediaPipe's "Left"/"Right" label is, for the plain (unflipped) camera picture we give it.
 * MediaPipe's old documentation says its label assumes a flipped selfie picture, so for a plain picture "Left" would be the
 * user's RIGHT hand and this would be true. But when we ran the installed version (tasks-vision 1.1.1) on ordinary photos
 * of people facing the camera, its label was the person's own hand ("Right" for their right hand), so this is false.
 * If a real camera ever shows the hands swapped (raise your right hand and `vision.hand.left.*` moves), try the page
 * address with `?swaphands=1` and, if that fixes it, change this to true.
 */
export const SWAP_HANDEDNESS = false;

/**
 * Turns MediaPipe's hands into "the user's left and right hand" in the MIRRORED view: every x is flipped so the points
 * match the mirrored video the user sees (their right hand is on the right of the screen). If MediaPipe calls both hands
 * the same side, the hand further left on screen is the left one.
 */
export function assignSides(raw: RawHand[], swap = SWAP_HANDEDNESS): HandObs[] {
  const hands = raw.slice(0, 2).map((h) => ({ side: ((h.label === 'Left') !== swap ? 'left' : 'right') as Side, score: h.score, points: mirrorPoints(h.points) }));
  if (hands.length === 2 && hands[0].side === hands[1].side) {
    const [a, b] = hands[0].points[HAND.WRIST].x <= hands[1].points[HAND.WRIST].x ? hands : [hands[1], hands[0]];
    a.side = 'left';
    b.side = 'right';
  }
  return hands;
}

// ---- the stateful part ----
export interface FrameObs {
  t_ms: number;
  hands: HandObs[];
  /** Face landmarks in mirrored view coordinates, or null/undefined when no face is tracked. */
  face?: Pt[] | null;
  /** Picture width / height (default 4:3). */
  aspect?: number;
}

export interface TrackerOptions {
  /** A held gesture must be seen this long before "start" (about 2 frames at 15 per second). */
  onMs: number;
  /** ...and gone this long before "end". */
  offMs: number;
  /** A hand that vanishes ends its held gestures only after this long, so one dropped frame doesn't flicker. */
  lostMs: number;
  /** Sliders are sent at most this often (60 ms = about 15 per second). */
  sliderMs: number;
  drumCooldownMs: number;
  nodCooldownMs: number;
  /** Head signals have no per-frame score from MediaPipe, so they carry this fixed confidence while a face is tracked. */
  headConfidence: number;
}
export const DEFAULT_TRACKER: TrackerOptions = { onMs: 60, offMs: 120, lostMs: 300, sliderMs: 60, drumCooldownMs: 250, nodCooldownMs: 700, headConfidence: 0.9 };

/** A yes/no that only flips after the new answer has held for a while. A "don't know" answer (null) changes nothing. */
export class Latch {
  active = false;
  private since: number | null = null;
  constructor(
    private readonly onMs: number,
    private readonly offMs: number,
  ) {}
  /** `want`: true = looks on, false = looks off, null = in the grey zone between the thresholds. */
  update(t: number, want: boolean | null, offMs = this.offMs): 'start' | 'end' | null {
    if (want === null || want === this.active) {
      this.since = null;
      return null;
    }
    this.since ??= t;
    if (t - this.since < (want ? this.onMs : offMs)) return null;
    this.since = null;
    this.active = want;
    return want ? 'start' : 'end';
  }
}

/** true below `on`, false above `off`, null in between (smaller = more "on"). */
const bandBelow = (v: number, on: number, off: number): boolean | null => (v < on ? true : v > off ? false : null);
/** true above `on`, false below `off`, null in between (bigger = more "on"). */
const bandAbove = (v: number, on: number, off: number): boolean | null => (v > on ? true : v < off ? false : null);

const HOLDS = ['fist', 'open_palm', 'raised', 'pinch', 'thumbs_up'] as const;
type Hold = (typeof HOLDS)[number];

interface SideState {
  holds: Record<Hold, Latch>;
  wrist: Array<{ t: number; y: number }>;
  drumArmed: boolean;
  lastDrum: number;
}

/**
 * Feed it one FrameObs per camera frame (in time order); it returns the signals to send for that frame.
 * Sliders come out at most every `sliderMs`. Holdable moments (fist, open palm, raised, pinch) come out only when they
 * start or end. One-shots (drum hit, nod) come out once per event.
 */
export class GestureTracker {
  private readonly o: TrackerOptions;
  private readonly sides: Record<Side, SideState>;
  private readonly lastSlider = new Map<string, number>();
  private nose: NoseSample[] = [];
  private lastFace = -Infinity;
  private lastNod = -Infinity;
  private lastT = 0;

  constructor(opts: Partial<TrackerOptions> = {}) {
    this.o = { ...DEFAULT_TRACKER, ...opts };
    this.sides = { left: this.newSide(), right: this.newSide() };
  }

  private newSide(): SideState {
    const latch = () => new Latch(this.o.onMs, this.o.offMs);
    return { holds: { fist: latch(), open_palm: latch(), raised: latch(), pinch: latch(), thumbs_up: latch() }, wrist: [], drumArmed: true, lastDrum: -Infinity };
  }

  update(frame: FrameObs): SignalOut[] {
    const out: SignalOut[] = [];
    const t = frame.t_ms;
    const aspect = frame.aspect ?? DEFAULT_ASPECT;
    this.lastT = t;

    const seen = new Map<Side, HandObs>();
    for (const h of frame.hands) if (!seen.has(h.side)) seen.set(h.side, h);

    for (const side of ['left', 'right'] as const) {
      const hand = seen.get(side);
      if (hand) this.updateHand(out, side, hand, frame, aspect);
      else this.handMissing(out, side, t);
    }

    const left = seen.get('left');
    const right = seen.get('right');
    if (left && right) {
      const widths = handsDistanceWidths(left.points, right.points, aspect);
      this.slider(out, 'vision.hands.distance', t, handsDistanceValue(widths), round(widths), Math.min(left.score, right.score));
    }

    this.updateHead(out, t, frame.face, aspect);
    return out;
  }

  /** Call when tracking stops: ends every gesture that is still held so nothing stays stuck on. */
  reset(t = this.lastT): SignalOut[] {
    const out: SignalOut[] = [];
    for (const side of ['left', 'right'] as const) {
      for (const h of HOLDS) if (this.sides[side].holds[h].active) out.push(moment(`vision.hand.${side}.${h}`, 'end', 1, t));
    }
    this.sides.left = this.newSide();
    this.sides.right = this.newSide();
    this.nose = [];
    this.lastSlider.clear();
    this.lastFace = -Infinity;
    return out;
  }

  private slider(out: SignalOut[], id: string, t: number, value: number, raw: number | undefined, confidence: number): void {
    const prev = this.lastSlider.get(id);
    if (prev !== undefined && t - prev < this.o.sliderMs) return;
    this.lastSlider.set(id, t);
    out.push({ id, kind: 'slider', value: round(clamp01(value)), ...(raw === undefined ? {} : { raw }), confidence: round(confidence, 2), t_ms: t });
  }

  private updateHand(out: SignalOut[], side: Side, hand: HandObs, frame: FrameObs, aspect: number): void {
    const t = frame.t_ms;
    const s = this.sides[side];
    const pts = hand.points;
    const conf = round(hand.score, 2);

    this.slider(out, `vision.hand.${side}.height`, t, handHeight(pts), undefined, conf);
    this.slider(out, `vision.hand.${side}.x`, t, handX(pts), undefined, conf);

    const palmY = palmCenter(pts).y;
    const line = raisedLine(frame.face);
    const wants: Record<Hold, boolean | null> = {
      fist: bandBelow(curlMax(pts, aspect), THRESHOLDS.fistOn, THRESHOLDS.fistOff),
      open_palm: bandAbove(curlMin(pts, aspect), THRESHOLDS.openOn, THRESHOLDS.openOff),
      raised: bandBelow(palmY, line, line + THRESHOLDS.raisedOffMargin),
      pinch: bandBelow(pinchRatio(pts, aspect), THRESHOLDS.pinchOn, THRESHOLDS.pinchOff),
      thumbs_up: curlMax(pts, aspect) < THRESHOLDS.fistOff &&
        (s.holds.thumbs_up.active
          ? (pts[HAND.THUMB_IP].y - pts[HAND.THUMB_TIP].y) / Math.max(1e-6, handSize(pts, aspect)) >= THRESHOLDS.thumbUpOff
          : isThumbsUp(pts, aspect)),
    };
    // A fist often tucks the thumb against the index finger: while the fist is on (or about to be), it is not a pinch.
    if (s.holds.fist.active || wants.fist === true) wants.pinch = false;
    for (const h of HOLDS) {
      const edge = s.holds[h].update(t, wants[h]);
      if (edge) out.push(moment(`vision.hand.${side}.${h}`, edge, conf, t));
    }

    // Drum hit: the wrist moves down fast, once per stroke.
    const wrist = pts[HAND.WRIST];
    s.wrist.push({ t, y: wrist.y });
    while (s.wrist.length > 1 && t - s.wrist[0].t > 250) s.wrist.shift();
    if (s.wrist.length >= 2) {
      const speed = downwardSpeed(s.wrist[s.wrist.length - 2], s.wrist[s.wrist.length - 1], handSize(pts, aspect));
      if (speed < THRESHOLDS.drumRearm) s.drumArmed = true;
      else if (speed > THRESHOLDS.drumSpeed && s.drumArmed && t - s.lastDrum >= this.o.drumCooldownMs) {
        s.drumArmed = false;
        s.lastDrum = t;
        out.push(moment(`vision.hand.${side}.drum_hit`, 'start', conf, t));
      }
    }
  }

  private handMissing(out: SignalOut[], side: Side, t: number): void {
    const s = this.sides[side];
    s.wrist = [];
    s.drumArmed = true;
    for (const h of HOLDS) {
      const edge = s.holds[h].update(t, false, this.o.lostMs);
      if (edge) out.push(moment(`vision.hand.${side}.${h}`, edge, 1, t));
    }
  }

  private updateHead(out: SignalOut[], t: number, face: Pt[] | null | undefined, aspect: number): void {
    if (!face) {
      if (t - this.lastFace > this.o.lostMs) this.nose = [];
      return;
    }
    this.lastFace = t;
    const deg = headTiltDegrees(face, aspect);
    this.slider(out, 'vision.head.tilt', t, tiltToSlider(deg), round(deg, 1), this.o.headConfidence);

    const eyes = eyeDistance(face, aspect);
    if (eyes <= 0) return;
    this.nose.push({ t, y: face[FACE.NOSE_TIP].y / eyes });
    while (this.nose.length > 1 && t - this.nose[0].t > THRESHOLDS.nodWindowMs) this.nose.shift();
    if (t - this.lastNod >= this.o.nodCooldownMs && detectNod(this.nose)) {
      this.lastNod = t;
      this.nose = [];
      out.push(moment('vision.head.nod', 'start', this.o.headConfidence, t));
    }
  }
}

function moment(id: string, state: 'start' | 'end', confidence: number, t: number): SignalOut {
  return { id, kind: 'moment', state, confidence, t_ms: t };
}
