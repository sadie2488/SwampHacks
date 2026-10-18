import { describe, expect, it } from 'vitest';
import twinkleJson from '@fixtures/song-analysis/twinkle.json';
import type { SongAnalysis } from '@/contracts';
import { addWrongNote, clearFrom, isScrubSpot, PX_PER_BAR, scrubLabel, scrubPosition, secondsPerBar } from './learn-scrub';

const twinkle = twinkleJson as unknown as SongAnalysis;

describe('drag to scrub', () => {
  it('one bar per 180 px, forward to the right and back to the left', () => {
    expect(scrubPosition(10, PX_PER_BAR, 2, 60)).toBe(12);
    expect(scrubPosition(10, -PX_PER_BAR / 2, 2, 60)).toBe(9);
  });

  it('never leaves the song', () => {
    expect(scrubPosition(1, -5000, 2, 60)).toBe(0);
    expect(scrubPosition(59, 5000, 2, 60)).toBe(60);
    expect(scrubPosition(5, 5000, 2, 0)).toBe(5 + (5000 / PX_PER_BAR) * 2); // no known length: only the start is a wall
  });

  it('uses the sheet bar grid for the length of a bar', () => {
    const q = 60 / twinkle.tempo_bpm;
    expect(secondsPerBar(twinkle)).toBeCloseTo(q * twinkle.time_signature.numerator * (4 / twinkle.time_signature.denominator), 6);
    expect(secondsPerBar(undefined)).toBe(2);
  });

  it('labels the time like 0:07.3', () => {
    expect(scrubLabel(7.34)).toBe('0:07.3');
    expect(scrubLabel(65)).toBe('1:05.0');
    expect(scrubLabel(-1)).toBe('0:00.0');
  });

  it('a grab scrubs on the lower half of the screen or anywhere over the sheet', () => {
    expect(isScrubSpot(700, 900, false)).toBe(true);
    expect(isScrubSpot(100, 900, false)).toBe(false);
    expect(isScrubSpot(100, 900, true)).toBe(true);
  });
});

describe('wrong notes in red', () => {
  const notes = [{ sec: 1, pitch: 60 }, { sec: 4, pitch: 62 }, { sec: 7, pitch: 64 }];

  it('adds in time order', () => {
    expect(addWrongNote([notes[2]], notes[0]).map((n) => n.sec)).toEqual([1, 7]);
  });

  it('moving backward clears every note at or after the new position; moving forward keeps them', () => {
    expect(clearFrom(notes, 4, 8).map((n) => n.sec)).toEqual([1]);
    expect(clearFrom(notes, 0, 8)).toEqual([]);
    expect(clearFrom(notes, 9, 8)).toEqual(notes);
    expect(clearFrom(notes, 8, 8)).toEqual(notes);
  });
});
