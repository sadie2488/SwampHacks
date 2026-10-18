// Which screen the app opens on: the entrance, the record menu, or straight into a mode.
//
// - A person opening the page sees the entrance once per browser tab; after a reload they land on the record menu.
// - ?intro=off opens straight into Learn; ?intro=on always shows the entrance.
// - Automated browsers (the team's browser tests, navigator.webdriver) open straight into Learn, because every
//   test expects Learn's controls on screen right after the page loads.
import type { Screen } from './modes';

const SEEN_KEY = 'overture.entered';

export interface ScreenHints {
  search: string;
  webdriver: boolean;
  seenEntrance: boolean;
}

export function initialScreen({ search, webdriver, seenEntrance }: ScreenHints): Screen {
  const intro = new URLSearchParams(search).get('intro')?.trim().toLowerCase();
  if (intro === 'on' || intro === '1') return 'entrance';
  if (intro === 'off' || intro === '0' || webdriver) return 'mode';
  return seenEntrance ? 'menu' : 'entrance';
}

/** Read the hints from this browser. Storage can be blocked (private windows): that only means "not seen yet". */
export function readScreenHints(): ScreenHints {
  let seenEntrance = false;
  try {
    seenEntrance = window.sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // storage blocked
  }
  return { search: window.location.search, webdriver: navigator.webdriver === true, seenEntrance };
}

export function rememberEntered(): void {
  try {
    window.sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // storage blocked: the entrance simply shows again next time
  }
}

/** True when the person asked the computer for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
