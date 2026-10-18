// The entrance's flower: Lalitha's hand-drawn orchid (the same drawing as on the Learn record), fully open from the
// start and filling most of the right side of the screen. Units: 1 = the spray unit (--u in entrance.css, about 13%
// of the window height); (0, 0) = the spray point, y up. The "Fig. 01" plate names it; its centre becomes the first
// record's hole when you enter.
import type { SectionId } from '@/ui/flowers/sections';

export interface SprayFlower {
  /** Which section's drawing (sections.ts: learn = orchid, menu = chrysanthemum, play = hibiscus, ...). */
  section: SectionId;
  x: number;
  y: number;
  /** Half the picture's side, in spray units. */
  r: number;
}

/** One orchid, about 87% of the window height, between the wordmark (left) and the window edge, under the plate. */
export const SPRAY: readonly SprayFlower[] = [{ section: 'learn', x: 0.65, y: -0.08, r: 3.3 }];

/** The flower whose centre travels to the first record's hole (the shared hand-over into the menu). */
export const HEART = SPRAY.length - 1;

/**
 * How open each flower should be: 0 closed, 1 outer petals open, 2 fully open. (The entrance flower is drawn open
 * from the start, see entrance.css; this still times the soft bloom tone as the pointer nears the Enter button.)
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
