// The camera and the microphone are always on: the site is meant to be used through sound and camera cues, and the
// camera is the page's background. They start on their own when they can do so without asking: on a page that opens
// straight into the menu or a mode, each one turns on only if this browser ALREADY allowed it for this site. Nothing
// here ever pops a permission prompt without a click (the entrance's two buttons are that click).
// Automated test browsers (navigator.webdriver) never start them: the browser and unit tests expect both off at
// start and turn them on themselves with the device buttons.
// The device buttons (btn-enable-vision, btn-enable-audio) stay the person's on/off switches; turning one off simply
// leaves it off (the background falls back to its non-camera look), and nothing here turns it back on.
import { useEffect } from 'react';
import { bus, isModuleOn } from '@/bus';

export interface AutostartHints {
  webdriver: boolean;
  /** The screen the page opened on. The entrance asks with its own buttons instead. */
  screen: 'entrance' | 'menu' | 'mode';
}

/** The device modules that start on their own, and the browser permission each one needs. */
const DEVICES = [
  { module: 'vision', permission: 'camera' },
  { module: 'audio-live', permission: 'microphone' },
] as const;

/** Should the page even look at the permissions? Pure, so it can be tested. */
export function mayAutostart({ webdriver, screen }: AutostartHints): boolean {
  return !webdriver && screen !== 'entrance';
}

/** True only when the browser says this device is already allowed. Any doubt (old browser, error) means no. */
export async function alreadyAllowed(permission: 'camera' | 'microphone'): Promise<boolean> {
  try {
    const perms = typeof navigator === 'undefined' ? undefined : navigator.permissions;
    if (!perms?.query) return false;
    const result = await perms.query({ name: permission as PermissionName });
    return result.state === 'granted';
  } catch {
    return false;
  }
}

/** Run once when the app opens: turn the camera and the microphone on if that needs no question. */
export function useDeviceAutostart(openedOn: AutostartHints['screen']): void {
  useEffect(() => {
    if (!mayAutostart({ webdriver: navigator.webdriver === true, screen: openedOn })) return;
    let cancelled = false;
    for (const d of DEVICES) {
      void alreadyAllowed(d.permission).then((ok) => {
        if (ok && !cancelled && !isModuleOn(d.module)) bus.emit('enable', { module: d.module, on: true });
      });
    }
    return () => {
      cancelled = true;
    };
    // only the screen the page OPENED on matters
  }, []);
}
