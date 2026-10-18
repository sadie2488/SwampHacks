// The short word the command toast shows when a voice or hand rule fires ("Pause", "Faster", "Recording" ...).
// Pure functions so the table and the follow throttle can be unit tested without React.
import type { CommandEvent } from '@/contracts';

/** What the screen knows right after the command ran: is the song playing, and the control's new value. */
export interface WordContext {
  playing?: boolean;
  /** The control's value after the command (from bus "controls"). */
  after?: unknown;
}

const MODE_WORDS: Record<string, string> = { learn: 'Learn', play: 'History', create: 'Create', lab: 'Lab' };
const TRIGGER_WORDS: Record<string, string> = {
  'playback.play': 'Play',
  'playback.pause': 'Pause',
  'create.layer.add': 'New layer',
  'create.layer.next': 'Next layer',
  'create.layer.confirm_pitch': 'Got it',
  'create.loop.stop': 'Stopped',
  'create.loop.play': 'Play loop',
  'app.enter': 'Enter',
};
/** Toggles: [word when it turns on, word when it turns off]. */
const TOGGLE_WORDS: Record<string, [string, string]> = {
  'create.beat': ['Beat on', 'Beat off'],
  'create.loop.record': ['Recording', 'Take done'],
  'playback.loop': ['Loop on', 'Loop off'],
  'create.instrument.voice': ['Voice on', 'Voice off'],
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The word for one command, or null when nothing should show. Follow rules go through the gate below instead. */
export function wordFor(cmd: CommandEvent, ctx: WordContext = {}): string | null {
  const id = cmd.command;
  const v = cmd.value;
  if (id === 'playback.toggle') return ctx.playing ? 'Play' : 'Pause';
  if (TRIGGER_WORDS[id]) return TRIGGER_WORDS[id];
  if (TOGGLE_WORDS[id]) return TOGGLE_WORDS[id][ctx.after ? 0 : 1];
  if (id === 'app.mode' && typeof v === 'string') return MODE_WORDS[v] ?? cap(v);
  if ((id === 'create.instrument' || id === 'create.effects') && typeof v === 'string') return v === 'none' ? 'No effect' : cap(v);
  if (typeof v === 'number') {
    const up = cmd.how === 'nudge' ? v > 0 : id === 'playback.tempo' ? v >= 1 : v >= 0;
    if (id === 'playback.tempo') return up ? 'Faster' : 'Slower';
    if (id === 'playback.pitch' || id === 'create.layer.pitch') return up ? 'Higher' : 'Lower';
    if (id === 'playback.volume' || id === 'create.layer.volume') return cmd.how === 'nudge' ? (up ? 'Louder' : 'Softer') : 'Volume';
  }
  return cmd.mapping ? cap(cmd.mapping) : null;
}

export const FOLLOW_EVERY_MS = 2000;
/** How far the tempo must move from the last shown value before "Tempo" shows again. */
export const TEMPO_STEP = 0.05;

/**
 * Follow rules (hand height drives tempo, pitch, volume) fire many times a second: show nothing for them, except at
 * most one "Tempo" every 2 s when the tempo moved noticeably. Returns the word to show or null.
 */
export function createFollowGate() {
  let lastAt = -Infinity;
  let lastTempo: number | undefined;
  return (cmd: CommandEvent, now: number): string | null => {
    if (cmd.command !== 'playback.tempo' || typeof cmd.value !== 'number') return null;
    if (now - lastAt < FOLLOW_EVERY_MS) return null;
    if (lastTempo !== undefined && Math.abs(cmd.value - lastTempo) < TEMPO_STEP) return null;
    lastAt = now;
    lastTempo = cmd.value;
    return 'Tempo';
  };
}
