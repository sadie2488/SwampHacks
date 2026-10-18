// Tiny interface sounds, made on the fly with Web Audio (no sound files): a soft tick when the records turn one
// step, a needle drop when one is chosen, a swell that peaks as the record's hole fills the screen, and one soft
// tone when the entrance flowers bloom. They go through their own volume control, so the sound toggle mutes only
// these, never the song. Nothing plays until the person has clicked or pressed a key (browsers' autoplay rule).
import { getAudioContext, resumeAudio } from '@/bus';

const KEY = 'overture.uiSound';
let muted = (() => {
  try {
    return window.localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
})();
let unlocked = false;
let out: GainNode | null = null;
const listeners = new Set<(muted: boolean) => void>();

/** Call from a click or key press: from then on the sounds may play. */
export function unlockSounds(): void {
  unlocked = true;
  resumeAudio().catch(() => {});
}

/** Unlock on the first click or key press anywhere (any screen, e.g. after a reload straight onto the menu). */
export function unlockOnFirstGesture(): () => void {
  const opts = { capture: true, once: true } as const;
  window.addEventListener('pointerdown', unlockSounds, opts);
  window.addEventListener('keydown', unlockSounds, opts);
  return () => {
    window.removeEventListener('pointerdown', unlockSounds, opts);
    window.removeEventListener('keydown', unlockSounds, opts);
  };
}

export const soundsMuted = () => muted;
export function setSoundsMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(KEY, next ? 'off' : 'on');
  } catch {
    // storage blocked: the choice lasts until the page reloads
  }
  listeners.forEach((fn) => fn(next));
}
export function onSoundsMuted(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function ready(): AudioContext | null {
  if (muted || !unlocked) return null;
  try {
    const ctx = getAudioContext();
    // right after the first click the context may still be resuming: notes queued now play the moment it runs
    if (ctx.state === 'closed') return null;
    if (!out) {
      out = ctx.createGain();
      out.gain.value = 0.5;
      out.connect(ctx.destination);
    }
    return ctx;
  } catch {
    return null;
  }
}


/** One shaped oscillator note. */
function note(type: OscillatorType, from: number, to: number, start: number, attack: number, length: number, peak: number): void {
  const ctx = ready();
  if (!ctx || !out) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + length);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

/** A soft wooden tick: the carousel turned one step. */
export const tick = () => note('triangle', 1400, 900, 0, 0.003, 0.06, 0.12);

/** A needle drop: a low thump and a faint crackle, when a record is chosen. */
export function needleDrop(): void {
  note('sine', 120, 55, 0, 0.004, 0.22, 0.35);
  note('square', 3200, 2400, 0.01, 0.002, 0.03, 0.03);
}

/** A rising swell that peaks after `ms` (when the record's hole fills the screen). */
export function swell(ms: number): void {
  const s = Math.max(0.2, ms / 1000);
  note('sine', 220, 440, 0.02, s * 0.95, s + 0.25, 0.14);
  note('sine', 330, 660, 0.02, s * 0.95, s + 0.25, 0.07);
}

/** One soft bell-like tone when the entrance flowers open (at most once until they close again). */
export const bloomTone = () => note('sine', 784, 784, 0, 0.02, 1.4, 0.08);
