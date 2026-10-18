// Smooth screen changes with the browser's View Transitions (Chrome): the old screen is kept as a picture while the
// new one animates in, using only transform, opacity and a clip circle (see transitions.css).
// - 'enter':  entrance -> record menu (a flower's centre travels to become the first record's hole)
// - 'portal': record menu -> a mode (the record rushes at you; the mode shows through its hole, then fills the screen)
// - 'mode':   one mode -> another (a short cross-fade)
// - 'back':   a mode -> the record menu (the menu settles back into place)
// Without View Transitions, or for people who prefer less motion, the screen simply changes at once.
// A new transition interrupts a running one; the browser then skips the old one (that is not an error).
import { flushSync } from 'react-dom';
import { prefersReducedMotion } from './screen';

export type TransitionKind = 'enter' | 'portal' | 'mode' | 'back';

/** How long the record takes to rush at the screen (the swell sound peaks at the same moment). */
export const PORTAL_MS = 750;

interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
}
type StartViewTransition = (update: () => void) => ViewTransitionLike;

const ignore = () => {};

/** Where the portal opens (the chosen record's centre) and how big its hole is, in pixels. */
export interface PortalOrigin {
  x: number;
  y: number;
  hole: number;
}

export function changeScreen(kind: TransitionKind, update: () => void, origin?: PortalOrigin): void {
  const start = (document as unknown as { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== 'function' || prefersReducedMotion()) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = kind;
  if (origin) {
    root.style.setProperty('--vt-x', `${Math.round(origin.x)}px`);
    root.style.setProperty('--vt-y', `${Math.round(origin.y)}px`);
    root.style.setProperty('--vt-hole', `${Math.max(4, Math.round(origin.hole))}px`);
    // big enough to cover the far corner of the window from the hole
    const far = Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y));
    root.style.setProperty('--vt-far', `${Math.ceil(far) + 2}px`);
    // the record grows until its hole covers the window; the mode's circle grows with the hole
    root.style.setProperty('--vt-scale', ((far + 2) / Math.max(4, origin.hole)).toFixed(2));
  }
  try {
    const vt = start.call(document, () => flushSync(update));
    vt.ready.catch(ignore);
    vt.updateCallbackDone.catch(ignore);
    vt.finished.catch(ignore).finally(() => {
      if (root.dataset.vt === kind) delete root.dataset.vt;
    });
  } catch {
    update();
  }
}
