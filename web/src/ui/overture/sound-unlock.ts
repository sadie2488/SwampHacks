// Browsers keep sound asleep until a click or key press, and a grab, a sign or a spoken word does not count. After a
// reload straight onto the menu or a mode (the mic starts by itself), nothing would be heard and nobody would know
// why. This watches the shared AudioContext (Tone.js in Create and the song player use the same one) and says when
// it is asleep; the first click or key press anywhere wakes it.
import { bus, getAudioContext, resumeAudio, type Stop } from '@/bus';

export type SoundState = AudioContextState | 'none';

/** The shared AudioContext's state, or 'none' when this browser has no Web Audio. */
export function readSoundState(): SoundState {
  try {
    return getAudioContext().state;
  } catch {
    return 'none';
  }
}

/** Show the "click anywhere" pill only while sound is asleep. */
export const soundAsleep = (state: SoundState): boolean => state === 'suspended';

export interface WatchOptions {
  read?: () => SoundState;
  resume?: () => Promise<unknown>;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'>;
  everyMs?: number;
}

/** Calls `onChange(asleep)` now and whenever it changes (checked every second, on mode changes, after a gesture). */
export function watchSoundUnlock(onChange: (asleep: boolean) => void, opts: WatchOptions = {}): Stop {
  const read = opts.read ?? readSoundState;
  const resume = opts.resume ?? resumeAudio;
  const target = opts.target ?? window;
  let last: boolean | null = null;
  let stopped = false;
  const check = () => {
    if (stopped) return;
    const asleep = soundAsleep(read());
    if (asleep !== last) onChange((last = asleep));
  };
  const wake = () => {
    if (!soundAsleep(read())) return;
    resume().then(check, check);
  };
  const opt = { capture: true } as const;
  target.addEventListener('pointerdown', wake, opt);
  target.addEventListener('keydown', wake, opt);
  const timer = target.setInterval(check, opts.everyMs ?? 1000);
  const offMode = bus.on('mode', check);
  check();
  return () => {
    stopped = true;
    target.removeEventListener('pointerdown', wake, opt);
    target.removeEventListener('keydown', wake, opt);
    target.clearInterval(timer);
    offMode();
  };
}
