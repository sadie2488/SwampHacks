import { describe, expect, it } from 'vitest';
import { NoteTracker, type TrackedNote } from './notes';

const HOP = 0.02;

function setup() {
  const notes: TrackedNote[] = [];
  const starts: number[] = [];
  const tracker = new NoteTracker({ onNote: (n) => notes.push(n), onNoteStart: (t) => starts.push(t) });
  /** Feed frames from `from` for `seconds`; midi can be a number, null, or a function of time. */
  const feed = (from: number, seconds: number, midi: number | null | ((t: number) => number | null), rms = 0.05) => {
    for (let k = 0; k < Math.round(seconds / HOP); k++) {
      const t = from + k * HOP;
      tracker.push(t, typeof midi === 'function' ? midi(t) : midi, midi === null ? 0 : 0.95, rms);
    }
    return from + seconds;
  };
  return { tracker, notes, starts, feed };
}

describe('note tracker', () => {
  it('turns a held pitch into one note with its pitch, start and length', () => {
    const { tracker, notes, feed } = setup();
    const t = feed(1, 0.3, 60);
    feed(t, 0.2, null);
    expect(notes.length).toBe(1);
    expect(notes[0].pitch).toBe(60);
    expect(notes[0].centsOff).toBeCloseTo(0, 5);
    expect(notes[0].startSec).toBeCloseTo(1, 5);
    expect(notes[0].durationSec).toBeCloseTo(0.3, 2);
    tracker.flush();
    expect(notes.length).toBe(1);
  });

  it('announces a note only once it has held about 80 ms', () => {
    const { starts, feed } = setup();
    feed(2, 0.06, 64);
    expect(starts).toEqual([]);
    feed(2.06, 0.1, 64);
    expect(starts).toEqual([2]);
  });

  it('ignores a pitch blip shorter than 80 ms', () => {
    const { notes, starts, feed } = setup();
    let t = feed(0, 0.06, 67);
    t = feed(t, 0.3, null);
    expect(notes).toEqual([]);
    expect(starts).toEqual([]);
  });

  it('splits two different notes played one after the other', () => {
    const { tracker, notes, feed } = setup();
    let t = feed(0, 0.3, 60);
    t = feed(t, 0.3, 62);
    tracker.flush();
    expect(notes.map((n) => n.pitch)).toEqual([60, 62]);
    expect(notes[1].startSec).toBeCloseTo(0.3, 2);
    expect(notes[0].durationSec).toBeCloseTo(0.3, 1);
  });

  it('keeps one note through vibrato and reports the middle of it', () => {
    const { tracker, notes, feed } = setup();
    feed(0, 1, (t) => 64 + 0.4 * Math.sin(2 * Math.PI * 5.5 * t));
    tracker.flush();
    expect(notes.length).toBe(1);
    expect(notes[0].pitch).toBe(64);
    expect(Math.abs(notes[0].centsOff)).toBeLessThan(10);
  });

  it('reports how sharp or flat a note was, in cents', () => {
    const { tracker, notes, feed } = setup();
    let t = feed(0, 0.3, 60.3);
    t = feed(t, 0.3, null);
    t = feed(t, 0.3, 59.7);
    tracker.flush();
    expect(notes.map((n) => n.pitch)).toEqual([60, 60]);
    expect(notes[0].centsOff).toBeCloseTo(30, 3);
    expect(notes[1].centsOff).toBeCloseTo(-30, 3);
    for (const n of notes) expect(Math.abs(n.centsOff)).toBeLessThanOrEqual(50);
  });

  it('bridges a short dropout but not a long one', () => {
    const short = setup();
    let t = short.feed(0, 0.2, 60);
    t = short.feed(t, 0.04, null);
    short.feed(t, 0.2, 60);
    short.tracker.flush();
    expect(short.notes.length).toBe(1);

    const long = setup();
    t = long.feed(0, 0.2, 60);
    t = long.feed(t, 0.12, null);
    long.feed(t, 0.2, 60);
    long.tracker.flush();
    expect(long.notes.length).toBe(2);
  });

  it('ignores a single wrong frame in the middle of a note (an octave jump)', () => {
    const { tracker, notes, feed } = setup();
    feed(0, 0.5, (t) => (Math.abs(t - 0.2) < 1e-6 ? 72 : 60));
    tracker.flush();
    expect(notes.length).toBe(1);
    expect(notes[0].pitch).toBe(60);
  });

  it('counts the same pitch twice when a fresh attack comes in between', () => {
    const { tracker, notes, feed } = setup();
    let t = feed(0, 0.3, 60);
    tracker.split(t + 0.005);
    t = feed(t, 0.3, 60);
    tracker.flush();
    expect(notes.map((n) => n.pitch)).toEqual([60, 60]);
  });

  it('finishes the sounding note when flushed', () => {
    const { tracker, notes, feed } = setup();
    feed(0, 0.4, 55);
    expect(notes).toEqual([]);
    tracker.flush();
    expect(notes.length).toBe(1);
  });
});
