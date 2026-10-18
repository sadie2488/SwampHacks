// The entrance's flower spray: which flower file goes where, and how big (positions from the Overture mockup).
// Units: 1 = the spray unit (about 13% of the window height); (0, 0) = the middle of the spray, y up.
// To swap a flower, change its name here or replace its files (see web/src/ui/flowers/README.md).
import type { FlowerName } from '@/ui/flowers';

export interface SprayFlower {
  flower: FlowerName;
  x: number;
  y: number;
  /** Radius in spray units. */
  r: number;
  /** Turn of the flower itself, in degrees. */
  tilt: number;
  /** Buds never open. */
  bud: boolean;
}

const NAMES: FlowerName[] = ['chrysanthemum-a', 'chrysanthemum-b', 'chrysanthemum-c'];
// [x, y, size, tilt in radians]; a negative size makes a bud (from the mockup's CONFIG.entrance.flowers)
const RAW: Array<[number, number, number, number]> = [
  [-2.05, 3.5, 0.6, 0.5], [-0.45, 2.35, 0.92, 0.1], [0.85, 1.85, 0.8, -0.1], [-1.35, 1.2, 0.95, 0.05],
  [0.95, 0.6, 1, -0.05], [-0.55, 0.4, 0.5, 0.6], [-0.4, -0.8, 0.78, 0.1], [1.45, -0.9, 0.98, -0.1],
  [-0.7, -2, 0.82, 0.15], [1.45, -2.3, 0.85, -0.05], [0.6, -3.5, 0.5, 0.2], [-0.95, -3.55, -0.28, 0.9],
];
/** Each bloom's size against its spacing (the mockup's flowerSize / flowerGap, and the flower's 1.05 edge). */
const BLOOM_SCALE = (1.35 / 1.25) * 1.05;

export const SPRAY: readonly SprayFlower[] = RAW.map(([x, y, size, tilt], i) => ({
  flower: size < 0 ? 'bud' : NAMES[i % NAMES.length],
  x,
  y,
  r: size < 0 ? -size * 1.05 / 1.25 : size * BLOOM_SCALE,
  tilt: (-tilt * 180) / Math.PI,
  bud: size < 0,
}));

/** Stems: straight pieces [x1, y1, x2, y2] that zigzag between the blooms. */
export const STEMS: ReadonlyArray<[number, number, number, number]> = [
  [-2.95, 1.2, -1.45, 2.1], [-1.45, 2.1, -1.85, 3], [0.05, 1.5, 0.6, -0.2], [0.6, -0.2, 0.4, -1.6],
  [0.4, -1.6, 0.05, -2.4], [0.05, -2.4, -0.55, -3.3], [-0.55, -3.3, -0.9, -3.5], [0.4, -1.6, 1.2, -2.1], [0.05, -2.4, 0.55, -3.2],
];

/** Where the spray sits and how it is turned (share of the window; the mockup's arrangement). */
export const SPRAY_PLACE = { x: 0.646, y: 0.532, turnDeg: -35, unitOfHeight: 0.27 * 0.49, unitOfHeightNarrow: 0.2 * 0.49 };

/**
 * How open each flower should be: 0 closed, 1 outer petals open, 2 fully open.
 * `near` is 1 with the pointer on the Enter button and 0 far away; flowers open one after another.
 */
export function bloomStage(near: number, index: number, count: number): 0 | 1 | 2 {
  const b = Math.min(1, Math.max(0, near * 1.6 - (index / Math.max(count, 1)) * 0.6));
  return b > 0.75 ? 2 : b > 0.3 ? 1 : 0;
}

/** 1 when the pointer is on the button, falling to 0 at `range` pixels away (0 range = always open). */
export function nearness(dist: number, range = 700): number {
  if (range <= 0) return 1;
  return 1 - Math.min(1, Math.max(0, (dist - 40) / range));
}
