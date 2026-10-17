import { describe, expect, it } from 'vitest';
import type { PitchFrame } from '@/bus';
import { segmentNotes } from './segment-notes';

type Piece =
  | { midi: number; ms: number; vibrato?: number; confidence?: number }
  | { glide: [number, number]; ms: number }
  | { gap: number }
  | { junk: number };

/** Build a pitch track at 50 frames per second from pieces: steady notes, gaps (no pitch), glides and junk. */
function track(pieces: Piece[], stepMs = 20, startMs = 0): PitchFrame[] {
  const out: PitchFrame[] = [];
  let t = startMs;
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const p of pieces) {
    const frames = Math.round(('ms' in p ? p.ms : 'gap' in p ? p.gap : p.junk * stepMs) / stepMs);
    for (let i = 0; i < frames; i++, t += stepMs) {
      if ('gap' in p) out.push({ t_ms: t, midi: null, confidence: 0.1, rms: 0 });
      else if ('junk' in p) out.push({ t_ms: t, midi: 40 + rand() * 40, confidence: 0.2, rms: 0.01 });
      else if ('glide' in p) out.push({ t_ms: t, midi: p.glide[0] + ((p.glide[1] - p.glide[0]) * i) / Math.max(1, frames - 1), confidence: 0.9, rms: 0.1 });
      else {
        const vib = p.vibrato ? Math.sin((2 * Math.PI * 6 * (i * stepMs)) / 1000) * p.vibrato : 0;
        out.push({ t_ms: t, midi: p.midi + vib, confidence: p.confidence ?? 0.9, rms: 0.1 });
      }
    }
  }
  return out;
}

const raw = { quantize: false } as const;

describe('segmentNotes: steady notes', () => {
  it('turns two steady notes into two notes with the right pitch and times', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 400 }, { midi: 67, ms: 400 }]), raw);
    expect(notes.map((n) => n.pitch)).toEqual([60, 67]);
    expect(notes[0].onset_sec).toBeCloseTo(0, 2);
    expect(notes[0].duration_sec).toBeCloseTo(0.4, 2);
    expect(notes[1].onset_sec).toBeCloseTo(0.4, 2);
  });

  it('rounds a slightly flat or sharp hum to the nearest semitone', () => {
    const notes = segmentNotes(track([{ midi: 60.3, ms: 300 }, { midi: 64.6, ms: 300 }]), raw);
    expect(notes.map((n) => n.pitch)).toEqual([60, 65]);
  });

  it('fills in beats from the tempo (100 bpm: one beat is 0.6 s)', () => {
    const [n] = segmentNotes(track([{ midi: 62, ms: 600 }]), { ...raw, bpm: 100 });
    expect(n.duration_beat).toBeCloseTo(1, 2);
    expect(n.onset_beat).toBeCloseTo(0, 2);
  });

  it('returns nothing for no frames', () => {
    expect(segmentNotes([])).toEqual([]);
  });

  it('does not care about the order of the frames', () => {
    const frames = track([{ midi: 60, ms: 300 }, { midi: 64, ms: 300 }]).reverse();
    expect(segmentNotes(frames, raw).map((n) => n.pitch)).toEqual([60, 64]);
  });

  it('keeps every note valid: whole-number pitch, start >= 0, length > 0', () => {
    const notes = segmentNotes(track([{ midi: 59.7, ms: 300, vibrato: 0.3 }, { gap: 200 }, { midi: 71.2, ms: 300 }]));
    expect(notes.length).toBe(2);
    for (const n of notes) {
      expect(Number.isInteger(n.pitch)).toBe(true);
      expect(n.onset_sec).toBeGreaterThanOrEqual(0);
      expect(n.duration_sec).toBeGreaterThan(0);
      expect(n.confidence).toBeGreaterThan(0);
    }
  });
});

describe('segmentNotes: vibrato and wobble', () => {
  it('does not split one note because of vibrato (plus or minus 0.4 semitone)', () => {
    const notes = segmentNotes(track([{ midi: 62, ms: 1000, vibrato: 0.4 }]), raw);
    expect(notes.length).toBe(1);
    expect(notes[0].pitch).toBe(62);
    expect(notes[0].duration_sec).toBeCloseTo(1, 1);
  });

  it('does not split when the vibrato sits right between two semitones', () => {
    const notes = segmentNotes(track([{ midi: 62.5, ms: 1000, vibrato: 0.3 }]), raw);
    expect(notes.length).toBe(1);
  });

  it('ignores a one-frame octave jump inside a note', () => {
    const frames = track([{ midi: 60, ms: 500 }]);
    frames[12] = { ...frames[12], midi: 72 };
    const notes = segmentNotes(frames, raw);
    expect(notes.map((n) => n.pitch)).toEqual([60]);
  });

  it('still splits two different notes that touch each other', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 300 }, { midi: 61, ms: 300 }]), raw);
    expect(notes.map((n) => n.pitch)).toEqual([60, 61]);
  });
});

describe('segmentNotes: gaps and silence', () => {
  it('splits the same pitch into two notes across a real pause', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 300 }, { gap: 300 }, { midi: 60, ms: 300 }]), raw);
    expect(notes.length).toBe(2);
    expect(notes[1].onset_sec).toBeCloseTo(0.6, 2);
  });

  it('bridges a tiny dropout (40 ms) inside one note', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 300 }, { gap: 40 }, { midi: 60, ms: 300 }]), raw);
    expect(notes.length).toBe(1);
    expect(notes[0].duration_sec).toBeCloseTo(0.64, 1);
  });

  it('ignores low-confidence frames', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 300 }, { midi: 70, ms: 300, confidence: 0.2 }, { midi: 64, ms: 300 }]), raw);
    expect(notes.map((n) => n.pitch)).toEqual([60, 64]);
  });

  it('can ignore very quiet frames', () => {
    const frames = track([{ midi: 60, ms: 300 }]).map((f) => ({ ...f, rms: 0.001 }));
    expect(segmentNotes(frames, { minRms: 0.01 })).toEqual([]);
    expect(segmentNotes(frames).length).toBe(1);
  });

  it('turns pure noise into no notes', () => {
    expect(segmentNotes(track([{ junk: 100 }]))).toEqual([]);
    expect(segmentNotes(track([{ gap: 1000 }]))).toEqual([]);
  });

  it('does not invent notes out of noise around a real note', () => {
    const notes = segmentNotes(track([{ junk: 30 }, { midi: 65, ms: 400 }, { junk: 30 }]), raw);
    expect(notes.map((n) => n.pitch)).toEqual([65]);
  });
});

describe('segmentNotes: minimum length', () => {
  it('drops a blip shorter than 80 ms and keeps one of 80 ms', () => {
    expect(segmentNotes(track([{ midi: 60, ms: 60 }, { gap: 300 }]), raw)).toEqual([]);
    expect(segmentNotes(track([{ midi: 60, ms: 80 }, { gap: 300 }]), raw).length).toBe(1);
  });

  it('reconnects a note around a short wrong blip', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 300 }, { midi: 66, ms: 60 }, { midi: 60, ms: 300 }]), raw);
    expect(notes.map((n) => n.pitch)).toEqual([60]);
    expect(notes[0].duration_sec).toBeGreaterThan(0.6);
  });
});

describe('segmentNotes: glide', () => {
  it('turns a quick slide between two notes into just the two end notes', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 300 }, { glide: [60, 67], ms: 120 }, { midi: 67, ms: 300 }]), raw);
    expect(notes[0].pitch).toBe(60);
    expect(notes[notes.length - 1].pitch).toBe(67);
    for (const n of notes) expect(n.duration_sec).toBeGreaterThanOrEqual(0.08 - 1e-6);
    for (let i = 1; i < notes.length; i++) expect(notes[i].onset_sec).toBeGreaterThanOrEqual(notes[i - 1].onset_sec + notes[i - 1].duration_sec - 1e-6);
  });
});

describe('segmentNotes: quantize', () => {
  // 100 bpm: one beat is 0.6 s, a sixteenth note is 0.15 s
  it('snaps onsets and durations to sixteenth notes by default', () => {
    const notes = segmentNotes(track([{ gap: 460 }, { midi: 60, ms: 580 }, { gap: 100 }, { midi: 64, ms: 300 }]), { bpm: 100 });
    expect(notes.length).toBe(2);
    for (const n of notes) {
      expect(Math.abs(n.onset_beat! / 0.25 - Math.round(n.onset_beat! / 0.25))).toBeLessThan(1e-6);
      expect(Math.abs(n.duration_beat! / 0.25 - Math.round(n.duration_beat! / 0.25))).toBeLessThan(1e-6);
    }
    expect(notes[0].onset_sec).toBeCloseTo(0.45, 5);
    expect(notes[0].onset_beat).toBeCloseTo(0.75, 5);
    expect(notes[0].duration_beat).toBeCloseTo(1, 5);
    expect(notes[0].duration_sec).toBeCloseTo(0.6, 5);
  });

  it('keeps seconds and beats consistent with the tempo', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 500 }, { gap: 100 }, { midi: 62, ms: 500 }]), { bpm: 120 });
    for (const n of notes) {
      expect(n.onset_sec).toBeCloseTo(n.onset_beat! * 0.5, 5);
      expect(n.duration_sec).toBeCloseTo(n.duration_beat! * 0.5, 5);
    }
  });

  it('supports a coarser grid (eighth notes)', () => {
    const notes = segmentNotes(track([{ gap: 200 }, { midi: 60, ms: 500 }]), { bpm: 100, gridBeats: 0.5 });
    expect(notes[0].onset_beat! % 0.5).toBeCloseTo(0, 6);
  });

  it('never lets two notes overlap after snapping', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 220 }, { midi: 62, ms: 220 }, { midi: 64, ms: 220 }, { midi: 65, ms: 220 }]), { bpm: 100 });
    for (let i = 1; i < notes.length; i++) expect(notes[i].onset_beat!).toBeGreaterThanOrEqual(notes[i - 1].onset_beat! + notes[i - 1].duration_beat! - 1e-6);
  });

  it('can be switched off', () => {
    const [n] = segmentNotes(track([{ gap: 140 }, { midi: 60, ms: 400 }]), { bpm: 100, quantize: false });
    expect(n.onset_sec).toBeCloseTo(0.14, 2);
  });
});

describe('segmentNotes: loop length', () => {
  it('clips notes to the loop and drops notes that start after it', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 1000 }, { midi: 64, ms: 1000 }, { midi: 67, ms: 1000 }]), { ...raw, lengthSec: 1.5 });
    expect(notes.map((n) => n.pitch)).toEqual([60, 64]);
    expect(notes[1].onset_sec + notes[1].duration_sec).toBeCloseTo(1.5, 5);
  });

  it('moves a note that starts a hair early to time zero', () => {
    const notes = segmentNotes(track([{ midi: 60, ms: 400 }], 20, -40), raw);
    expect(notes[0].onset_sec).toBe(0);
  });
});
