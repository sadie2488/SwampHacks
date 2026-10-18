import { describe, expect, it } from 'vitest';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import type { SongAnalysis } from '@/contracts';
import { cursorTiming, stepAt, wholeNotesAt } from './sheet-cursor';

const song = twinkle as unknown as SongAnalysis;

describe('cursorTiming', () => {
  it('reads tempo, beat unit and first beat from the analysis', () => {
    const t = cursorTiming({ ...song, tempo_bpm: 120, beats: [0.9, 1.4, 1.9] });
    expect(t).toEqual({ bpm: 120, denominator: song.time_signature?.denominator ?? 4, firstBeatSec: 0.9 });
  });
  it('starts at 0 s when there are no beats, and falls back to 120 BPM for a bad tempo', () => {
    const t = cursorTiming({ ...song, tempo_bpm: 0, beats: undefined });
    expect(t.firstBeatSec).toBe(0);
    expect(t.bpm).toBe(120);
  });
});

describe('wholeNotesAt', () => {
  const late = cursorTiming({ ...song, tempo_bpm: 120, time_signature: { numerator: 4, denominator: 4 }, beats: [0.9, 1.4] });

  it('counts from the first beat, like the server counts note beats', () => {
    // At 120 BPM a beat lasts 0.5 s, so the first beat (0.9 s) is the start of the music
    expect(wholeNotesAt(0.9, late)).toBeCloseTo(0);
    // Four beats later is one whole note in 4/4, not 1.45 whole notes
    expect(wholeNotesAt(2.9, late)).toBeCloseTo(1);
  });
  it('stays at the start before the first beat', () => {
    expect(wholeNotesAt(0, late)).toBe(0);
    expect(wholeNotesAt(0.5, late)).toBe(0);
  });
  it('is unchanged for a song whose first beat is at 0 s (the demo)', () => {
    const demo = cursorTiming({ ...song, tempo_bpm: 120, time_signature: { numerator: 4, denominator: 4 }, beats: [0, 0.5] });
    expect(wholeNotesAt(2, demo)).toBeCloseTo(1);
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
    const late = cursorTiming({ ...song, tempo_bpm: 120, time_signature: { numerator: 4, denominator: 4 }, beats: [0.9] });
    // Just after the first beat the cursor is still on step 0 (it used to be almost 2 beats ahead)
    expect(stepAt(steps, wholeNotesAt(1.0, late))).toBe(0);
  });
});
