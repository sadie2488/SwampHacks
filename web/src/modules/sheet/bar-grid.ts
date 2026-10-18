// The bar grid of the sheet music: how song seconds map to quarter notes and bar numbers.
// The sheet draws with it, and practice feedback numbers its bars with it, so "bar 5" means the same bar in both.
// Pure maths, no imports beyond the contract types. Other modules may import this file directly.
import type { Part, SongAnalysis } from '@/contracts';

type TimeSignature = SongAnalysis['time_signature'] | undefined;

/** 6/8, 9/8 and 12/8: felt in 2, 3 or 4 dotted-quarter beats. */
export function isCompound(ts: TimeSignature): boolean {
  return !!ts && ts.denominator === 8 && ts.numerator >= 6 && ts.numerator % 3 === 0;
}

/**
 * How many quarter notes one counted beat lasts. `tempo_bpm` and `beats` count this beat (the server's
 * beat tracker hears a dotted quarter in 6/8), while note `onset_beat` / `duration_beat` are quarter notes.
 */
export function quartersPerBeat(ts: TimeSignature): number {
  if (isCompound(ts)) return 1.5;
  return 4 / (ts?.denominator ?? 4);
}

/** Counted beats in one bar: 6/8 has 2, 3/4 has 3, 4/4 has 4. */
export function beatsPerBar(ts: TimeSignature): number {
  const n = ts?.numerator ?? 4;
  return Math.max(1, isCompound(ts) ? n / 3 : n);
}

/** Quarter notes in one bar: 4 in 4/4, 3 in 3/4 and 6/8, 1.5 in 3/8. */
export function quartersPerBar(ts: TimeSignature): number {
  return Math.max(0.25, ((ts?.numerator ?? 4) * 4) / (ts?.denominator ?? 4));
}

/** Seconds per quarter note at 1.0x (120 BPM when the tempo is missing). */
export function secPerQuarter(a: Pick<SongAnalysis, 'tempo_bpm' | 'time_signature'>): number {
  const bpm = a.tempo_bpm > 0 ? a.tempo_bpm : 120;
  return 60 / (bpm * quartersPerBeat(a.time_signature));
}

/** Which bar (from 1) a note that starts at this quarter note sits in on the sheet. Notes are placed on a sixteenth grid. */
export function barOfQuarter(ts: TimeSignature, quarter: number): number {
  const sixteenth = Math.max(0, Math.round(quarter * 4));
  return Math.floor(sixteenth / Math.round(quartersPerBar(ts) * 4)) + 1;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Song time (seconds) of quarter note 0 on the sheet for this part.
 * The server counts note beats from the first beat, moved back by whole beats when notes come before it
 * (a pickup), so the start is read off the notes and snapped to the beat grid. Notes without beats are
 * placed from 0 s, so then the start is 0 s.
 */
export function sheetStartSec(a: Pick<SongAnalysis, 'tempo_bpm' | 'time_signature' | 'beats'>, part?: Pick<Part, 'notes'>): number {
  const q = secPerQuarter(a);
  const guesses = (part?.notes ?? [])
    .filter((n) => Number.isFinite(n.onset_beat) && Number.isFinite(n.onset_sec))
    .map((n) => n.onset_sec - (n.onset_beat as number) * q);
  const first = a.beats?.[0];
  const hasBeat = typeof first === 'number' && Number.isFinite(first);
  if (guesses.length === 0) return 0;
  const guess = median(guesses);
  if (!hasBeat) return guess;
  const beatSec = q * quartersPerBeat(a.time_signature);
  return first - Math.round((first - guess) / beatSec) * beatSec;
}

/** Everything needed to turn song seconds into sheet positions. */
export interface SheetGrid {
  startSec: number;
  secPerQuarter: number;
  timeSignature: TimeSignature;
}

export function sheetGrid(a: Pick<SongAnalysis, 'tempo_bpm' | 'time_signature' | 'beats'>, part?: Pick<Part, 'notes'>): SheetGrid {
  return { startSec: sheetStartSec(a, part), secPerQuarter: secPerQuarter(a), timeSignature: a.time_signature };
}

/** Quarter notes since the start of the sheet at song time `t` (negative before it). */
export function quarterAt(g: SheetGrid, t: number): number {
  return (t - g.startSec) / g.secPerQuarter;
}

/**
 * The sheet bar (from 1) that song time `t` falls in: bar n runs from `barStartAt(n)` up to the next bar.
 * Anything before the first bar counts as bar 1, as on the sheet. For a note of the song, `barOfQuarter`
 * on its `onset_beat` is exact (the sheet rounds note starts to a sixteenth).
 */
export function barAt(g: SheetGrid, t: number): number {
  return Math.max(0, Math.floor(quarterAt(g, t) / quartersPerBar(g.timeSignature) + 1e-6)) + 1;
}

/** Song time where a sheet bar starts (never before 0 s). */
export function barStartAt(g: SheetGrid, bar: number): number {
  return Math.max(0, g.startSec + (bar - 1) * quartersPerBar(g.timeSignature) * g.secPerQuarter);
}
