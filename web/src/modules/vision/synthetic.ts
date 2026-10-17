// Made-up hands and faces in the same shape MediaPipe gives (21 hand points, 478 face points, mirrored view).
// Used by fake mode (so the overlay has something to draw without a camera) and by the tests.
import { DEFAULT_ASPECT, FACE, type Pt } from './gestures';

type Curl = number | [number, number, number, number];
export interface HandSpec {
  /** 0 = finger straight, 1 = fully curled. One number for all four fingers, or [index, middle, ring, pinky]. */
  curl?: Curl;
  /** 'out' = thumb held away from the palm, 'tucked' = folded across a fist, 'pinch' = thumb tip on the index tip. */
  thumb?: 'out' | 'tucked' | 'pinch';
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
  const tip: [number, number] = thumb === 'out' ? [-0.9, 0.78] : thumb === 'tucked' ? [-0.15, 0.62] : [indexTip[0] + 0.03, indexTip[1]];
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
