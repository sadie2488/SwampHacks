// Made-up hands and faces in the same shape MediaPipe gives (21 hand points, 478 face points, mirrored view).
// Used by fake mode (so the overlay has something to draw without a camera) and by the tests.
import { DEFAULT_ASPECT, FACE, type Pt, type Side } from './gestures';

type Curl = number | [number, number, number, number];
export interface HandSpec {
  /** 0 = finger straight, 1 = fully curled. One number for all four fingers, or [index, middle, ring, pinky]. */
  curl?: Curl;
  /**
   * 'out' = thumb held away from the palm, 'tucked' = folded across a fist, 'pinch' = thumb tip on the index tip,
   * 'up' = thumb pointing straight up beside the fingers (with curl 1 this is a thumbs-up).
   */
  thumb?: 'out' | 'tucked' | 'pinch' | 'up';
  /** Where the wrist is (0-1 in the mirrored picture). */
  wrist?: Pt;
  /** Wrist-to-middle-knuckle length, in picture heights. */
  size?: number;
  aspect?: number;
}

// Finger layout with hand size = 1: knuckle position and the three bone lengths.
const FINGERS = [
  { mcp: [-0.27, 0.95], bones: [0.45, 0.28, 0.25] },
  { mcp: [0, 1.0], bones: [0.5, 0.32, 0.27] },
  { mcp: [0.25, 0.93], bones: [0.45, 0.3, 0.26] },
  { mcp: [0.48, 0.8], bones: [0.35, 0.22, 0.2] },
] as const;
const BEND_DEG = [85, 100, 60];
const rad = (d: number) => (d * Math.PI) / 180;

/** 21 hand points. Curling is drawn the way a camera sees it: a bending finger gets shorter on screen. */
export function makeHand(spec: HandSpec = {}): Pt[] {
  const { thumb = 'out', wrist = { x: 0.5, y: 0.8 }, size = 0.12, aspect = DEFAULT_ASPECT } = spec;
  const curls = Array.isArray(spec.curl) ? spec.curl : [spec.curl ?? 0, spec.curl ?? 0, spec.curl ?? 0, spec.curl ?? 0];
  const local: Array<[number, number]> = new Array(21);
  local[0] = [0, 0];

  FINGERS.forEach((f, i) => {
    const c = curls[i];
    let [x, y] = f.mcp;
    const base = 5 + i * 4;
    local[base] = [x, y];
    let bend = 0;
    f.bones.forEach((len, j) => {
      bend += rad(BEND_DEG[j] * c);
      y += len * Math.cos(bend);
      local[base + 1 + j] = [x, y];
    });
  });

  const indexTip = local[8];
  const THUMB_TIPS: Record<NonNullable<HandSpec['thumb']>, [number, number]> = { out: [-0.9, 0.78], tucked: [-0.15, 0.62], up: [-0.5, 1.05], pinch: [indexTip[0] + 0.03, indexTip[1]] };
  const tip = THUMB_TIPS[thumb];
  const cmc: [number, number] = [-0.2, 0.2];
  local[1] = cmc;
  local[2] = [cmc[0] + (tip[0] - cmc[0]) * 0.45, cmc[1] + (tip[1] - cmc[1]) * 0.45];
  local[3] = [cmc[0] + (tip[0] - cmc[0]) * 0.75, cmc[1] + (tip[1] - cmc[1]) * 0.75];
  local[4] = tip;

  return local.map(([lx, ly]) => ({ x: wrist.x + (lx * size) / aspect, y: wrist.y - ly * size, z: 0 }));
}

export interface FaceSpec {
  /** Middle of the line between the eyes. */
  center?: Pt;
  /** Distance between the outer eye corners, in picture heights. */
  eyeDist?: number;
  /** Head tilt in degrees; positive = tipped toward the user's right shoulder (clockwise on the mirrored picture). */
  tiltDeg?: number;
  aspect?: number;
}

/** 478 face points: only the ones the gesture code reads are placed exactly; the rest form a rough face-shaped cloud. */
export function makeFace(spec: FaceSpec = {}): Pt[] {
  const { center = { x: 0.5, y: 0.4 }, eyeDist = 0.12, tiltDeg = 0, aspect = DEFAULT_ASPECT } = spec;
  const th = rad(tiltDeg);
  const sin = Math.sin(th);
  const cos = Math.cos(th);
  // Work in picture-height units, then divide x by the aspect ratio.
  const at = (along: number, down: number): Pt => ({ x: center.x + (along * cos - down * sin) * eyeDist / aspect, y: center.y + (along * sin + down * cos) * eyeDist, z: 0 });

  const points: Pt[] = [];
  for (let i = 0; i < 478; i++) {
    const r = Math.sqrt((i + 0.5) / 478);
    const a = i * 2.399963; // golden angle spreads the points evenly
    points.push(at(r * 1.1 * Math.cos(a), 0.5 + r * 1.6 * Math.sin(a)));
  }
  points[FACE.EYE_OUTER_B] = at(-0.5, 0); // the user's left eye is on the left of the mirrored picture
  points[FACE.EYE_OUTER_A] = at(0.5, 0);
  points[FACE.NOSE_TIP] = at(0, 0.9);
  points[FACE.FOREHEAD] = at(0, -1.2);
  points[FACE.CHIN] = at(0, 2.1);
  return points;
}

// ---- 3D hand poses: every fingerspelling letter and finger counts 0-5 ----
type V3 = readonly [number, number, number];
type Flex = readonly [number, number, number];
/** Hand frame, hand size = 1: x across the palm toward the little finger, y toward the fingers, z out of the palm's front. */
export interface PoseSpec {
  /** Bend in degrees at [knuckle, middle joint, end joint] for index, middle, ring, little finger. */
  flex: readonly [Flex, Flex, Flex, Flex];
  /** Sideways angle of each finger in degrees, + = toward the little finger. */
  spread?: readonly [number, number, number, number];
  /** Thumb tip: a point in the hand frame, or "touch this fingertip" (0 = index .. 3 = little finger). */
  thumb: V3 | { touch: number };
  /** Which way the fingers point on screen: 'side' = toward the signer's left (G, H), 'down' = down and forward (P, Q). */
  point?: 'up' | 'side' | 'down';
  side?: Side;
  wrist?: Pt;
  size?: number;
  aspect?: number;
}

const STRAIGHT: Flex = [0, 0, 0];
const FIST: Flex = [85, 100, 60];
const HOOK: Flex = [10, 95, 65];
const CUP: Flex = [30, 40, 25];
const ROUND: Flex = [45, 60, 45];
const KNUCKLES: ReadonlyArray<V3> = [[-0.27, 0.95, 0], [0, 1, 0], [0.25, 0.93, 0], [0.48, 0.8, 0]];
const BONES = [[0.45, 0.28, 0.25], [0.5, 0.32, 0.27], [0.45, 0.3, 0.26], [0.35, 0.22, 0.2]] as const;
/** Camera directions (x right, y down, z away from the camera) of the hand frame's x, y and z axes, for a right hand. */
const AXES: Record<NonNullable<PoseSpec['point']>, [V3, V3, V3]> = {
  up: [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
  side: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
  down: [[1, 0, 0], [0, 0.87, -0.5], [0, 0.5, 0.87]],
};

/** 21 points in 3D (z like MediaPipe: in picture-width units, smaller = nearer the camera), mirrored view. */
export function makePose(spec: PoseSpec): Pt[] {
  const { side = 'right', point = 'up', wrist = { x: 0.5, y: 0.7 }, size = 0.15, aspect = DEFAULT_ASPECT } = spec;
  const local: V3[] = new Array(21);
  local[0] = [0, 0, 0];
  for (let f = 0; f < 4; f++) {
    const s = rad(spec.spread?.[f] ?? 0);
    let [x, y, z] = KNUCKLES[f];
    local[5 + 4 * f] = [x, y, z];
    let bend = 0;
    for (let j = 0; j < 3; j++) {
      bend += rad(spec.flex[f][j]);
      const len = BONES[f][j];
      x += len * Math.sin(s) * Math.cos(bend);
      y += len * Math.cos(s) * Math.cos(bend);
      z += len * Math.sin(bend);
      local[6 + 4 * f + j] = [x, y, z];
    }
  }
  const t = spec.thumb;
  const tip: V3 = 'touch' in t ? [local[8 + 4 * t.touch][0] - 0.03, local[8 + 4 * t.touch][1], local[8 + 4 * t.touch][2] + 0.03] : t;
  const cmc: V3 = [-0.22, 0.22, 0.05];
  const along = (k: number): V3 => [cmc[0] + (tip[0] - cmc[0]) * k, cmc[1] + (tip[1] - cmc[1]) * k, cmc[2] + (tip[2] - cmc[2]) * k + 0.04 * Math.sin(Math.PI * k)];
  local[1] = cmc;
  local[2] = along(0.45);
  local[3] = along(0.75);
  local[4] = tip;
  const [ax, ay, az] = AXES[point];
  const flip = side === 'left' ? -1 : 1;
  return local.map(([lx, ly, lz]) => {
    const cx = lx * ax[0] + ly * ay[0] + lz * az[0];
    const cy = lx * ax[1] + ly * ay[1] + lz * az[1];
    const cz = lx * ax[2] + ly * ay[2] + lz * az[2];
    return { x: wrist.x + (flip * cx * size) / aspect, y: wrist.y + cy * size, z: (cz * size) / aspect };
  });
}

const THUMB_OUT: V3 = [-0.95, 0.8, 0.05];
/** Thumb across the front of curled fingers (holding them down). */
const THUMB_FRONT: V3 = [0, 0.75, 0.6];
const THUMB_ON_RING: V3 = [0.25, 0.75, 0.55];
const f4 = (i: Flex, m: Flex, r: Flex, p: Flex) => [i, m, r, p] as const;
const K: Omit<PoseSpec, 'thumb'> = { flex: f4(STRAIGHT, STRAIGHT, FIST, FIST), spread: [-12, 8, 0, 0] };
const G: Omit<PoseSpec, 'thumb'> = { flex: f4(STRAIGHT, FIST, FIST, FIST) };

/** One pose per letter (J and Z are their starting hand shapes: I and a pointing index finger). */
export const LETTER_POSES: Record<string, PoseSpec> = {
  a: { flex: f4(FIST, FIST, FIST, FIST), thumb: [-0.42, 0.78, 0.15] },
  b: { flex: f4(STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT), thumb: [0.1, 0.5, 0.15] },
  c: { flex: f4(CUP, CUP, CUP, CUP), thumb: [-0.45, 0.9, 0.7] },
  d: { flex: f4(STRAIGHT, [55, 80, 45], [55, 80, 45], [55, 80, 45]), thumb: { touch: 1 } },
  e: { flex: f4([25, 105, 75], [25, 105, 75], [25, 105, 75], [25, 105, 75]), thumb: [0.15, 0.6, 0.2] },
  f: { flex: f4(ROUND, STRAIGHT, STRAIGHT, STRAIGHT), spread: [0, 0, 6, 12], thumb: { touch: 0 } },
  g: { ...G, thumb: [-0.45, 1.15, 0.15], point: 'side' },
  h: { flex: f4(STRAIGHT, STRAIGHT, FIST, FIST), thumb: THUMB_ON_RING, point: 'side' },
  i: { flex: f4(FIST, FIST, FIST, STRAIGHT), thumb: THUMB_FRONT },
  j: { flex: f4(FIST, FIST, FIST, STRAIGHT), thumb: THUMB_FRONT },
  k: { ...K, thumb: [-0.12, 1.3, 0.2] },
  l: { ...G, thumb: THUMB_OUT },
  m: { flex: f4(FIST, FIST, FIST, FIST), thumb: [0.37, 0.8, 0.25] },
  n: { flex: f4(FIST, FIST, FIST, FIST), thumb: [0.12, 0.8, 0.25] },
  o: { flex: f4(ROUND, ROUND, ROUND, ROUND), thumb: { touch: 0 } },
  p: { ...K, thumb: [-0.12, 1.3, 0.2], point: 'down' },
  q: { ...G, thumb: [-0.45, 1.15, 0.15], point: 'down' },
  r: { flex: f4(STRAIGHT, STRAIGHT, FIST, FIST), spread: [14, -10, 0, 0], thumb: THUMB_ON_RING },
  s: { flex: f4(FIST, FIST, FIST, FIST), thumb: THUMB_FRONT },
  t: { flex: f4(FIST, FIST, FIST, FIST), thumb: [-0.14, 0.95, 0.38] },
  u: { flex: f4(STRAIGHT, STRAIGHT, FIST, FIST), thumb: THUMB_ON_RING },
  v: { ...K, thumb: THUMB_ON_RING },
  w: { flex: f4(STRAIGHT, STRAIGHT, STRAIGHT, FIST), spread: [-12, 0, 12, 0], thumb: [0.4, 0.7, 0.45] },
  x: { flex: f4(HOOK, FIST, FIST, FIST), thumb: THUMB_FRONT },
  y: { flex: f4(FIST, FIST, FIST, STRAIGHT), spread: [0, 0, 0, 10], thumb: THUMB_OUT },
  z: { ...G, thumb: THUMB_FRONT },
};

/** A hand holding up `n` fingers (0-5) the usual way: index first, the thumb last. */
export function countPose(n: number): PoseSpec {
  const flex = [0, 1, 2, 3].map((f) => (f < Math.min(n, 4) ? STRAIGHT : FIST)) as unknown as PoseSpec['flex'];
  return { flex, spread: [-10, 0, 8, 16], thumb: n === 5 ? THUMB_OUT : n === 4 ? [0.1, 0.5, 0.15] : THUMB_FRONT };
}

/** A relaxed, resting hand: fingers a little curled, thumb loose. Should read as no letter. */
export const RELAXED_POSE: PoseSpec = { flex: f4([20, 25, 10], [22, 28, 12], [25, 30, 12], [28, 30, 12]), spread: [-6, 0, 5, 10], thumb: [-0.6, 0.6, 0.2] };
