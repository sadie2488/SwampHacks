import { describe, expect, it } from 'vitest';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import type { Note, SongAnalysis } from '@/contracts';
import { cursorTiming, stepAt, wholeNotesAt } from './sheet-cursor';

const song = twinkle as unknown as SongAnalysis;
const fourFour = { numerator: 4, denominator: 4 } as const;
/** A part whose note beats are counted from `startSec` at 120 BPM (a quarter = 0.5 s). */
const partFrom = (startSec: number, beats: number[], quarterSec = 0.5) => ({
  notes: beats.map((b): Note => ({ pitch: 60, onset_sec: startSec + b * quarterSec, duration_sec: 0.4, onset_beat: b, duration_beat: 1 })),
});

describe('cursorTiming', () => {
  it('starts where the notes say beat 0 is, on the beat grid', () => {
    const a = { ...song, tempo_bpm: 120, time_signature: fourFour, beats: [0.9, 1.4, 1.9] };
    const t = cursorTiming(a, partFrom(0.9, [0, 1, 2]));
    expect(t.startSec).toBeCloseTo(0.9);
    expect(t.secPerQuarter).toBeCloseTo(0.5);
  });
  it('starts at 0 s for notes without beats, and falls back to 120 BPM for a bad tempo', () => {
    const t = cursorTiming({ ...song, tempo_bpm: 0, beats: undefined }, { notes: [{ pitch: 60, onset_sec: 1, duration_sec: 1 }] });
    expect(t.startSec).toBe(0);
    expect(t.secPerQuarter).toBeCloseTo(0.5);
  });
});

describe('wholeNotesAt', () => {
  const late = cursorTiming({ ...song, tempo_bpm: 120, time_signature: fourFour, beats: [0.9, 1.4] }, partFrom(0.9, [0, 1, 2, 3]));

  it('counts from the first beat, like the server counts note beats', () => {
    expect(wholeNotesAt(0.9, late)).toBeCloseTo(0);
    // Four beats later is one whole note in 4/4, not 1.45 whole notes
    expect(wholeNotesAt(2.9, late)).toBeCloseTo(1);
  });
  it('stays at the start before the first beat', () => {
    expect(wholeNotesAt(0, late)).toBe(0);
    expect(wholeNotesAt(0.5, late)).toBe(0);
  });
  it('starts one beat early when a pickup note comes before the first beat', () => {
    // The server moved beat 0 back one beat (to 0.4 s) for a note at 0.4 s; the first beat (0.9 s) is beat 1
    const pickup = cursorTiming({ ...song, tempo_bpm: 120, time_signature: fourFour, beats: [0.9, 1.4] }, partFrom(0.4, [0, 1, 2]));
    expect(pickup.startSec).toBeCloseTo(0.4);
    expect(wholeNotesAt(0.9, pickup)).toBeCloseTo(0.25);
  });
  it('is unchanged for the demo song (first beat at 0 s)', () => {
    const demo = cursorTiming(song, song.parts[0]);
    expect(demo.startSec).toBeCloseTo(0);
    expect(wholeNotesAt(2.4, demo)).toBeCloseTo(1); // 100 BPM: one 4/4 bar is 2.4 s
  });
  it('counts a 6/8 beat (a dotted quarter) as 3 eighths', () => {
    // 60 BPM in 6/8: a dotted quarter lasts 1 s, so a quarter lasts 2/3 s and a bar (3 quarters) 2 s
    const jig = cursorTiming({ ...song, tempo_bpm: 60, time_signature: { numerator: 6, denominator: 8 }, beats: [0, 1, 2] }, partFrom(0, [0, 1.5], 2 / 3));
    expect(wholeNotesAt(1, jig)).toBeCloseTo(0.375); // one dotted quarter
    expect(wholeNotesAt(2, jig)).toBeCloseTo(0.75); // one 6/8 bar
  });
  it('counts a 3/4 beat as a quarter', () => {
    const waltz = cursorTiming({ ...song, tempo_bpm: 120, time_signature: { numerator: 3, denominator: 4 }, beats: [0, 0.5] }, partFrom(0, [0, 1]));
    expect(wholeNotesAt(1.5, waltz)).toBeCloseTo(0.75);
  });
});

describe('stepAt', () => {
  const steps = [0, 0.25, 0.5, 1];
  it('finds the last step reached', () => {
    expect(stepAt(steps, 0)).toBe(0);
    expect(stepAt(steps, 0.3)).toBe(1);
    expect(stepAt(steps, 0.5)).toBe(2);
    expect(stepAt(steps, 5)).toBe(3);
  });
  it('puts the cursor on the first note of an upload whose first beat is late', () => {
    const late = cursorTiming({ ...song, tempo_bpm: 120, time_signature: fourFour, beats: [0.9] }, partFrom(0.9, [0, 1]));
    // Just after the first beat the cursor is still on step 0 (it used to be almost 2 beats ahead)
    expect(stepAt(steps, wholeNotesAt(1.0, late))).toBe(0);
  });
});
