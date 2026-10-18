import { describe, expect, it } from 'vitest';
import { noteName, PLAY_READOUT_LABELS, placeNotes, signedSemitones, staffGeometry, staffStep } from './mode-visual';

describe('Play readout labels', () => {
  it('says pitch is changed by voice, not by a hand (no hand rule changes pitch in Play)', () => {
    expect(PLAY_READOUT_LABELS.pitch).toBe('Pitch · say higher / lower');
    expect(PLAY_READOUT_LABELS.pitch).not.toMatch(/hand/);
  });
});

describe('mode base pictures', () => {
  it('puts notes on the treble staff (E4 on the bottom line, F5 on the top)', () => {
    expect(staffStep(64)).toBe(0);
    expect(staffStep(65)).toBe(1);
    expect(staffStep(77)).toBe(8);
    expect(staffStep(20)).toBe(-3);
  });

  it('slides notes toward the playhead and lights the sounding one', () => {
    const g = staffGeometry(1000, 800);
    const notes = [
      { pitch: 64, onset_sec: 0, duration_sec: 0.5 },
      { pitch: 67, onset_sec: 1, duration_sec: 0.5 },
    ];
    const [a, b] = placeNotes(notes, 0.2, g, 1000);
    expect(a.on).toBe(true);
    expect(b.on).toBe(false);
    expect(b.x).toBeCloseTo(g.playheadX + 0.8 * g.pxPerSec);
    expect(b.y).toBeLessThan(a.y);
  });

  it('names notes and semitones plainly', () => {
    expect(noteName(64)).toBe('E4');
    expect(noteName(61)).toBe('C#4');
    expect(signedSemitones(2)).toBe('+2.0 st');
    expect(signedSemitones(-1.5)).toBe('-1.5 st');
  });
});
