// Turns one raw worker result into (a) the "landmarks" the overlay draws and (b) the observation the gesture tracker reads.
// Both use the MIRRORED view: x is flipped, so a hand on the right of the screen has a big x, and "Left"/"Right" mean the
// user's own left and right hand. The camera video itself is published unflipped; show it with CSS transform: scaleX(-1).
import type { Landmarks } from '@/bus';
import { assignSides, mirrorPoints, type FrameObs, type RawHand, type Pt } from './gestures';

export interface RawResult {
  t_ms: number;
  width: number;
  height: number;
  hands: RawHand[];
  face: Pt[] | null;
}

export function toObservation(r: RawResult, swapHands?: boolean): FrameObs {
  return { t_ms: r.t_ms, hands: assignSides(r.hands, swapHands), face: r.face ? mirrorPoints(r.face) : null, aspect: r.height > 0 ? r.width / r.height : undefined };
}

export function toLandmarks(obs: FrameObs, width: number, height: number): Landmarks {
  return {
    t_ms: obs.t_ms,
    width,
    height,
    hands: obs.hands.map((h) => ({ handedness: h.side === 'left' ? 'Left' : 'Right', points: h.points.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })) })),
    ...(obs.face ? { face: { points: obs.face.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })) } } : {}),
  };
}
