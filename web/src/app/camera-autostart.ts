// The camera is the page's background (the site is meant to be used through sound and camera cues), so it starts
// on its own when it can do so without asking: on a page that opens straight into the menu or a mode, it turns on
// only if this browser ALREADY allowed the camera for this site. It never pops a permission prompt without a click
// (the entrance's "Enter with camera + sound" button is that click).
// Automated test browsers (navigator.webdriver) never start it: the browser and unit tests expect the camera off at
// start and turn it on themselves with the camera button.
// The camera button (btn-enable-vision) stays the person's on/off switch; turning it off simply leaves the
// non-camera background, and nothing here turns it back on.
import { useEffect } from 'react';
import { bus, isModuleOn } from '@/bus';

export interface AutostartHints {
  webdriver: boolean;
  /** The screen the page opened on. The entrance asks with its own button instead. */
  screen: 'entrance' | 'menu' | 'mode';
}

/** Should the page even look at the permission? Pure, so it can be tested. */
export function mayAutostart({ webdriver, screen }: AutostartHints): boolean {
  return !webdriver && screen !== 'entrance';
}

/** True only when the browser says the camera is already allowed. Any doubt (old browser, error) means no. */
export async function cameraAlreadyAllowed(): Promise<boolean> {
  try {
    const perms = typeof navigator === 'undefined' ? undefined : navigator.permissions;
    if (!perms?.query) return false;
    const result = await perms.query({ name: 'camera' as PermissionName });
    return result.state === 'granted';
  } catch {
    return false;
  }
}

/** Run once when the app opens: turn the camera on if that needs no question. */
export function useCameraAutostart(openedOn: AutostartHints['screen']): void {
  useEffect(() => {
    if (!mayAutostart({ webdriver: navigator.webdriver === true, screen: openedOn })) return;
    let cancelled = false;
    void cameraAlreadyAllowed().then((ok) => {
      if (ok && !cancelled && !isModuleOn('vision')) bus.emit('enable', { module: 'vision', on: true });
    });
    return () => {
      cancelled = true;
    };
    // only the screen the page OPENED on matters
  }, []);
}
