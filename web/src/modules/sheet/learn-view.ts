// What the Learn screen and the sheet agree to show: one shared switch for the note letters, carried on the bus so the
// sheet's "Beginner mode" checkbox and the Learn screen's "Show letters" pill always say the same thing.
import { bus } from '@/bus';

export interface LearnView {
  /** Note letters on the sheet and next to the gliding notes on the Learn screen. */
  letters: boolean;
}

declare module '@/bus' {
  interface Topics {
    /** The Learn screen's view settings (published by whichever side the person clicked). */
    learnView: LearnView;
  }
}

export const DEFAULT_LEARN_VIEW: LearnView = { letters: false };

/** The current view settings (the default until someone changes them). */
export function learnView(): LearnView {
  return bus.last('learnView') ?? DEFAULT_LEARN_VIEW;
}

/** Turn the note letters on or off everywhere at once. Publishes only when something changes. */
export function setLetters(on: boolean): void {
  if (learnView().letters === on) return;
  bus.emit('learnView', { ...learnView(), letters: on });
}
