// The hand drag: while a grabbing fist drags, the hand cursor sends `hand-drag` events on window (start, move with the
// hand's sideways travel in screen px, end). The record menu turns one record per HAND_STEP_PX of travel. Pure helpers.

export const HAND_DRAG_EVENT = 'hand-drag';
/** Hand travel (screen px) that turns the menu by one record. */
export const HAND_STEP_PX = 110;
/** The records lean toward the drag by at most this much (px) before the next step. */
export const HAND_NUDGE_PX = 40;
/** On the menu the first record of each grab turns sooner: a clear sideways swipe (past the 45 px drag start) is enough. */
export const HAND_FIRST_STEP_PX = 55;

export interface HandDragDetail {
  phase: 'start' | 'move' | 'end';
  /** Sideways hand travel since the last event (screen px); 0 for start and end. */
  dx: number;
}

export function emitHandDrag(detail: HandDragDetail): void {
  window.dispatchEvent(new CustomEvent<HandDragDetail>(HAND_DRAG_EVENT, { detail }));
}

/**
 * Turns hand-drag events into record steps, like dragging with a mouse: pulling right goes to the previous record (-1),
 * pulling left to the next (+1). A long drag steps several times; there is no time lockout. Vertical movement is never
 * seen (only dx arrives). Each grab starts from zero. `firstPx` (default stepPx) is the travel for the first step of a grab.
 */
export function createDragStepper(stepPx = HAND_STEP_PX, nudgePx = HAND_NUDGE_PX, firstPx = stepPx) {
  let acc = 0;
  let on = false;
  let stepped = false;
  const need = () => (stepped ? stepPx : firstPx);
  return {
    /** The leftover travel as a lean (px), toward the drag, clamped to nudgePx. */
    get nudge(): number {
      return on ? Math.max(-nudgePx, Math.min(nudgePx, (acc / need()) * nudgePx)) : 0;
    },
    /** Feed one event; returns the record steps to take now (negative = previous). */
    feed(d: HandDragDetail): number {
      if (d.phase !== 'move') {
        acc = 0;
        stepped = false;
        on = d.phase === 'start';
        return 0;
      }
      if (!on) {
        on = true;
        acc = 0;
        stepped = false;
      }
      acc += d.dx;
      let n = 0;
      while (Math.abs(acc) >= need()) {
        const s = Math.sign(acc);
        acc -= s * need();
        stepped = true;
        n += s;
      }
      return n ? -n : 0;
    },
  };
}
