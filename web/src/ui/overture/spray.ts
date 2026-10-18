// The entrance's flowers: three of Lalitha's hand-drawn section flowers (the same drawings as on the records),
// placed around the spray point on the right of the screen. Units: 1 = the spray unit (--u in entrance.css, about
// 13% of the window height); (0, 0) = the spray point, y up. The last one is the chrysanthemum, the specimen the
// "Fig. 01" plate names; its centre becomes the first record's hole when you enter.
import type { SectionId } from '@/ui/flowers/sections';

export interface SprayFlower {
  /** Which section's drawing (sections.ts: menu = chrysanthemum, learn = orchid, play = hibiscus, ...). */
  section: SectionId;
  x: number;
  y: number;
  /** Half the picture's side, in spray units. */
  r: number;
}

export const SPRAY: readonly SprayFlower[] = [
  { section: 'learn', x: -1.95, y: 1.55, r: 1.0 },
  { section: 'play', x: 2.0, y: -1.45, r: 1.05 },
  { section: 'menu', x: 0.3, y: 0, r: 1.75 },
];

/** The flower whose centre travels to the first record's hole (the shared hand-over into the menu). */
export const HEART = SPRAY.length - 1;

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
