// Made-up performances: a player who is in time, slow, fast, skips notes, adds notes... Used by fake mode and by tests.
// Nothing here listens to a microphone.
import type { PerformanceEvent } from '@/contracts';
import type { ExpectedNote, PlayedNote } from './compare';

export const FAKE_SESSION_ID = 'fake-practice';

export interface ScriptOptions {
  /** Playback tempo factor of the song (default 1). */
  rate?: number;
  /** Song position where the run began (default 0). */
  startSec?: number;
  /** Notes at or after this song position are not played (default: all). */
  endSec?: number;
  /** How fast the player plays compared with the song: 1 = in time, 0.9 = 10% slow, 1.1 = 10% fast. */
  pace?: number;
  /** Hardware lag added to every time, ms (default 0). */
  latencyMs?: number;
  /** The player starts this much late (positive) or early (negative), ms. */
  shiftMs?: number;
  /** Size of a small repeatable wobble in the timing, ms (default 0). */
  jitterMs?: number;
  /** Positions in the list of due notes that the player skips. */
  skip?: number[];
  /** Extra sounds: song seconds (at 1.0x) where the player adds an unwanted note. */
  extras?: Array<{ songSec: number; pitch?: number }>;
  /** Cents the player is sharp (positive) or flat on a due note, by position in the list of due notes. */
  detune?: Record<number, number>;
  /** Semitones the song is shifted by (the player follows it). */
  pitchShift?: number;
}

/** What a player would produce for these expected notes, as the comparison code sees it. */
export function scriptPlayed(expected: ExpectedNote[], opts: ScriptOptions = {}): PlayedNote[] {
  const rate = opts.rate ?? 1;
  const startSec = opts.startSec ?? 0;
  const pace = opts.pace ?? 1;
  const due = expected
    .filter((n) => n.onsetSec >= startSec - 1e-6 && (opts.endSec === undefined || n.onsetSec < opts.endSec - 1e-6))
    .sort((a, b) => a.onsetSec - b.onsetSec);
  const skip = new Set(opts.skip ?? []);
  const timeOf = (songSec: number, k: number) => ((songSec - startSec) / rate / pace) * 1000 + (opts.shiftMs ?? 0) + (opts.latencyMs ?? 0) + (((k * 37) % 21) - 10) * 0.1 * (opts.jitterMs ?? 0);
  const out: PlayedNote[] = [];
  due.forEach((n, k) => {
    if (skip.has(k)) return;
    out.push({
      timeSec: timeOf(n.onsetSec, k) / 1000,
      pitch: n.pitch + (opts.pitchShift ?? 0) + (opts.detune?.[k] ?? 0) / 100,
      durationSec: n.durationSec / rate / pace,
      confidence: 0.9,
    });
  });
  (opts.extras ?? []).forEach((x, k) => out.push({ timeSec: timeOf(x.songSec, 100 + k) / 1000, pitch: x.pitch, durationSec: 0.2, confidence: 0.8 }));
  return out.sort((a, b) => a.timeSec - b.timeSec);
}

/**
 * Turn played notes into the events the microphone module publishes: an onset when each sound starts, then a note
 * (whole pitch + cents_off) when it ends. `runStartMs` is the page-clock time the run started at and `originMs` the
 * page-clock time of the microphone's time 0.
 */
export function playedToEvents(played: PlayedNote[], opts: { runStartMs: number; originMs: number; sessionId?: string }): PerformanceEvent[] {
  const sec = (p: PlayedNote) => (opts.runStartMs + p.timeSec * 1000 - opts.originMs) / 1000;
  const base = opts.sessionId ? { session_id: opts.sessionId } : {};
  const out: PerformanceEvent[] = [];
  for (const p of played) {
    out.push({ version: 1, type: 'onset', ...base, time_sec: sec(p), loudness: 0.7, confidence: 0.8 });
    if (p.pitch !== undefined) {
      const whole = Math.round(p.pitch);
      out.push({ version: 1, type: 'note', ...base, time_sec: sec(p), pitch: whole, cents_off: (p.pitch - whole) * 100, duration_sec: p.durationSec ?? 0.3, loudness: 0.6, confidence: p.confidence ?? 0.9 });
    }
  }
  return out;
}

/**
 * Publish a made-up performance of these expected notes, the way the microphone would (an onset and a note for each sound).
 * `emit` is usually `(e) => bus.emit('performance', e)`. Returns what was played, in the form the comparison code uses.
 */
export function feedScriptedPerformance(
  emit: (e: PerformanceEvent) => void,
  expected: ExpectedNote[],
  opts: ScriptOptions & { runStartMs: number; originMs: number; sessionId?: string },
): PlayedNote[] {
  const played = scriptPlayed(expected, opts);
  for (const e of playedToEvents(played, opts)) emit(e);
  return played;
}
