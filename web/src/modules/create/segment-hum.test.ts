// Humming that is a bit rough: vibrato, slides, octave errors, a flat or drifting singer, pauses, repeated notes and noise.
// The tracks are made up (50 frames per second), so every case is the same on every run.
import { describe, expect, it } from 'vitest';
import type { PitchFrame } from '@/bus';
import { segmentNotes } from './segment-notes';
import { randomMelody, score, scoreAllowingShift, sing, track, type MelodyNote } from './synthetic-hum';

const raw = { quantize: false } as const;
const pitches = (frames: PitchFrame[], opts = {}) => segmentNotes(frames, { ...raw, ...opts }).map((n) => n.pitch);

/** A melody of steady notes at the given pitches (may have a fraction), each `ms` long with a small silent gap between. */
function steadyNotes(sung: number[], ms = 360, gap = 100): PitchFrame[] {
  return track(sung.flatMap((midi) => [{ midi, ms }, { gap }]));
}

describe('vibrato', () => {
  it('keeps one note per steady note with vibrato of plus or minus 50 cents at 5, 6.5 and 8 Hz', () => {
    for (const hz of [5, 6.5, 8]) {
      const frames = track([{ midi: 60, ms: 500, vibratoSemitones: 0.5, vibratoHz: hz }, { gap: 100 }, { midi: 65, ms: 500, vibratoSemitones: 0.5, vibratoHz: hz }, { gap: 100 }, { midi: 62, ms: 500, vibratoSemitones: 0.5, vibratoHz: hz }]);
      expect(pitches(frames)).toEqual([60, 65, 62]);
    }
  });

  it('holds when the vibrato sits between two semitones', () => {
    const frames = track([{ midi: 61.5, ms: 700, vibratoSemitones: 0.5, vibratoHz: 6 }, { gap: 100 }, { midi: 64.5, ms: 700, vibratoSemitones: 0.5, vibratoHz: 7 }]);
    expect(segmentNotes(frames, raw).length).toBe(2);
  });

  it('comes out right for many random hums with vibrato', () => {
    let right = 0;
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { frames, meant } = sing(randomMelody(seed, { notes: 8 }), { vibratoCents: 50, jitterCents: 10, noteSigmaCents: 10 }, seed);
      const s = score(segmentNotes(frames, raw), meant);
      right += s.matched;
      total += s.meant;
    }
    expect(right / total).toBeGreaterThan(0.97);
  });
});

describe('slides between notes', () => {
  const slide = (ms: number) => track([{ midi: 60, ms: 400 }, { glide: [60, 67], ms }, { midi: 67, ms: 400 }]);

  it.each([100, 200, 300, 500, 800])('a %i ms slide from C4 to G4 gives just two notes', (ms) => {
    expect(pitches(slide(ms))).toEqual([60, 67]);
  });

  it('a slide down gives just two notes as well', () => {
    expect(pitches(track([{ midi: 72, ms: 400 }, { glide: [72, 64], ms: 400 }, { midi: 64, ms: 400 }]))).toEqual([72, 64]);
  });

  it('would make middle notes without the slide check (so the check is doing the work)', () => {
    expect(pitches(slide(800), { dropGlides: false }).length).toBeGreaterThan(2);
  });

  it('a note that starts with a short scoop from below is one note on its own pitch', () => {
    const frames = track([{ glide: [57, 60], ms: 100 }, { midi: 60, ms: 400 }, { gap: 100 }, { glide: [58, 62], ms: 100 }, { midi: 62, ms: 400 }]);
    expect(pitches(frames)).toEqual([60, 62]);
  });

  it('a note that tails off downward into silence stays one note', () => {
    expect(pitches(track([{ midi: 64, ms: 400 }, { glide: [64, 62], ms: 100 }, { gap: 300 }]))).toEqual([64]);
  });

  it('a slow, wide slide does not make notes out of the sweep for many seeds', () => {
    let extra = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { frames, meant } = sing(randomMelody(seed, { notes: 8 }), { scoopMs: 400, jitterCents: 10 }, seed);
      extra += segmentNotes(frames, raw).length - meant.length;
    }
    expect(extra).toBeLessThanOrEqual(3);
  });
});

describe('octave errors', () => {
  const note = (ms: number) => ({ midi: 62, ms });
  const withError = (errorFrames: number, shift: number, at = 8) => {
    const frames = track([note(600)]);
    for (let i = 0; i < errorFrames; i++) frames[at + i] = { ...frames[at + i], midi: frames[at + i].midi! + shift, confidence: 0.7 };
    return frames;
  };

  it.each([1, 2, 3, 5])('a %i frame jump up an octave inside a note is folded back', (n) => {
    expect(pitches(withError(n, 12))).toEqual([62]);
    expect(segmentNotes(withError(n, 12), raw)[0].duration_sec).toBeCloseTo(0.6, 2);
  });

  it.each([1, 3, 5])('a %i frame jump down an octave is folded back', (n) => {
    expect(pitches(withError(n, -12))).toEqual([62]);
  });

  it('two octave errors in one note are both folded back', () => {
    const frames = withError(3, 12, 5);
    for (let i = 0; i < 4; i++) frames[18 + i] = { ...frames[18 + i], midi: frames[18 + i].midi! - 12, confidence: 0.7 };
    expect(pitches(frames)).toEqual([62]);
  });

  it('a 5 frame error makes extra notes when the fix is off (so the fix is doing the work)', () => {
    expect(pitches(withError(5, 12), { fixOctaves: false }).length).toBeGreaterThan(1);
  });

  it('an error next to a dropout is still folded', () => {
    const frames = withError(4, 12, 10);
    frames[14] = { ...frames[14], midi: null, confidence: 0.1 };
    expect(pitches(frames)).toEqual([62]);
  });

  it('keeps a real octave leap: C4 then C5 then C4 with real lengths', () => {
    const frames = track([{ midi: 60, ms: 400 }, { midi: 72, ms: 400 }, { midi: 60, ms: 400 }]);
    expect(pitches(frames)).toEqual([60, 72, 60]);
  });

  it('keeps an octave leap up followed by a different note', () => {
    expect(pitches(track([{ midi: 60, ms: 300 }, { midi: 72, ms: 300 }, { midi: 74, ms: 300 }]))).toEqual([60, 72, 74]);
  });

  it('gets random hums with octave errors right', () => {
    let right = 0;
    let found = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { frames, meant } = sing(randomMelody(seed, { notes: 8 }), { octaveErrorsPerNote: 0.6, jitterCents: 10, noteSigmaCents: 10 }, seed);
      const notes = segmentNotes(frames, raw);
      const s = score(notes, meant);
      right += s.matched;
      found += s.detected;
      total += s.meant;
    }
    expect(right / found).toBeGreaterThan(0.97);
    expect(right / total).toBeGreaterThan(0.97);
  });
});

describe('a singer who is out of tune the same way all the time', () => {
  // Each note is off by its own small amount on top of the habit, so plain rounding gets some of them wrong.
  const wobble = [0, -0.1, 0.05, -0.13, 0.08, -0.11, 0.03, -0.14];
  const intended = [60, 62, 64, 65, 67, 69, 71, 72];

  it('a hum 30 cents flat throughout (and a little wobbly) gives the intended notes', () => {
    const sung = intended.map((p, i) => p - 0.3 + wobble[i] - (i % 2 ? 0.08 : 0));
    const frames = steadyNotes(sung);
    expect(pitches(frames, { correctTuning: false })).not.toEqual(intended);
    expect(pitches(frames)).toEqual(intended);
  });

  it('a hum 30 cents sharp throughout gives the intended notes', () => {
    const sung = intended.map((p, i) => p + 0.3 - wobble[i] + (i % 2 ? 0.08 : 0));
    const frames = steadyNotes(sung);
    expect(pitches(frames, { correctTuning: false })).not.toEqual(intended);
    expect(pitches(frames)).toEqual(intended);
  });

  it('a hum that drifts 40 cents sharp over 8 notes gives the intended notes', () => {
    // starts 12 cents sharp and ends 52 cents sharp, so the last notes would round to the wrong semitone
    const sung = intended.map((p, i) => p + 0.12 + (0.4 * i) / 7);
    const frames = steadyNotes(sung);
    expect(pitches(frames, { correctTuning: false })).not.toEqual(intended);
    expect(pitches(frames)).toEqual(intended);
  });

  it('a hum that drifts flat gives the intended notes', () => {
    const sung = intended.map((p, i) => p - 0.1 - (0.42 * i) / 7);
    expect(pitches(steadyNotes(sung))).toEqual(intended);
  });

  it('a hum that is already in tune is not changed', () => {
    expect(pitches(steadyNotes(intended.map((p, i) => p + wobble[i] * 0.5)))).toEqual(intended);
  });

  it('works with vibrato on top', () => {
    const sung = intended.map((p, i) => p + 0.12 + (0.4 * i) / 7);
    const frames = track(sung.flatMap((midi) => [{ midi, ms: 450, vibratoSemitones: 0.35, vibratoHz: 6 }, { gap: 100 }]));
    expect(pitches(frames)).toEqual(intended);
  });

  it('tuning can be switched off', () => {
    const frames = steadyNotes([59.62, 62.65, 64.6, 59.7]);
    expect(pitches(frames, { correctTuning: false })).toEqual([60, 63, 65, 60]);
  });

  it('flat and sharp singers come out much better over many random hums', () => {
    for (const offsetCents of [-35, 35]) {
      let fixed = 0;
      let fixedShifted = 0;
      let plain = 0;
      let plainShifted = 0;
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const { frames, meant } = sing(randomMelody(seed, { notes: 10 }), { offsetCents, noteSigmaCents: 12, jitterCents: 10, vibratoCents: 30 }, seed);
        const withFix = segmentNotes(frames, raw);
        const without = segmentNotes(frames, { ...raw, correctTuning: false });
        fixed += score(withFix, meant).matched;
        fixedShifted += scoreAllowingShift(withFix, meant).matched;
        plain += score(without, meant).matched;
        plainShifted += scoreAllowingShift(without, meant).matched;
        total += meant.length;
      }
      // A singer 35 cents off who also wobbles is sometimes read a whole semitone away for the entire tune (the tune is right, only moved).
      // "Shifted" does not count that against the result.
      expect(fixed / total).toBeGreaterThan(0.9);
      expect(fixedShifted / total).toBeGreaterThan(0.97);
      expect(fixed).toBeGreaterThan(plain + 0.03 * total);
      expect(fixedShifted).toBeGreaterThan(plainShifted + 0.08 * total);
    }
  });
});

describe('pauses, repeated notes and noise', () => {
  it('splits notes at silences and puts the first onset where the hum starts', () => {
    const notes = segmentNotes(track([{ gap: 500 }, { midi: 60, ms: 300 }, { gap: 300 }, { midi: 64, ms: 300 }, { gap: 800 }, { midi: 67, ms: 300 }, { gap: 400 }]), raw);
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
    expect(notes.map((n) => n.onset_sec)).toEqual([0.5, 1.1, 2.2].map((x) => expect.closeTo(x, 2)));
  });

  it('keeps repeated notes apart when there is a short break between them (Twinkle, Twinkle)', () => {
    const tune = [60, 60, 67, 67, 69, 69, 67];
    const melody: MelodyNote[] = tune.map((pitch, i) => ({ pitch, ms: i === 6 ? 600 : 300, gapMs: i % 2 === 0 && i < 6 ? 80 : 0 }));
    const { frames } = sing(melody, { jitterCents: 8 }, 3);
    expect(pitches(frames)).toEqual(tune);
  });

  it('still counts repeated notes when the singer is flat', () => {
    const tune = [60, 60, 67, 67, 69, 69, 67];
    const melody: MelodyNote[] = tune.map((pitch, i) => ({ pitch, ms: 300, gapMs: i % 2 === 0 && i < 6 ? 80 : 0 }));
    const { frames } = sing(melody, { offsetCents: -35, jitterCents: 8, noteSigmaCents: 8 }, 4);
    expect(pitches(frames)).toEqual(tune);
  });

  it('joins one note across a 40 ms dropout, but not across a 100 ms pause', () => {
    expect(pitches(track([{ midi: 60, ms: 300 }, { gap: 40 }, { midi: 60, ms: 300 }]))).toEqual([60]);
    expect(pitches(track([{ midi: 60, ms: 300 }, { gap: 100 }, { midi: 60, ms: 300 }]))).toEqual([60, 60]);
  });

  it('splits two close notes when there is a small hole between them', () => {
    // 59.2 then 59.9 across a 60 ms hole: a move of 0.7 semitone is a new note only because of the hole
    expect(pitches(track([{ midi: 59.2, ms: 300 }, { gap: 40 }, { midi: 59.9, ms: 300 }]), { correctTuning: false })).toEqual([59, 60]);
  });

  it('ignores scattered frames with no pitch inside a note', () => {
    const frames = track([{ midi: 62, ms: 800 }]);
    for (const i of [3, 9, 10, 17, 25, 31]) frames[i] = { ...frames[i], midi: null, confidence: 0.1 };
    const notes = segmentNotes(frames, raw);
    expect(notes.map((n) => n.pitch)).toEqual([62]);
    expect(notes[0].duration_sec).toBeCloseTo(0.8, 1);
  });

  it('ignores very low-confidence frames, even when their pitch is wild', () => {
    const frames = track([{ midi: 60, ms: 400 }]);
    for (const i of [2, 3, 4, 10, 11]) frames[i] = { ...frames[i], midi: 80, confidence: 0.1 };
    expect(pitches(frames)).toEqual([60]);
    expect(pitches(track([{ midi: 70, ms: 400, confidence: 0.3 }]))).toEqual([]);
  });

  it('turns a take of noise with no steady pitch into no notes', () => {
    expect(pitches(track([{ junk: 60 }, { gap: 200 }, { junk: 60 }]))).toEqual([]);
  });

  it('survives random dropouts and noise bursts around real notes', () => {
    let right = 0;
    let found = 0;
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { frames, meant } = sing(randomMelody(seed, { notes: 8 }), { dropoutChance: 0.08, jitterCents: 10, noteSigmaCents: 10 }, seed);
      const s = score(segmentNotes(frames, raw), meant);
      right += s.matched;
      found += s.detected;
      total += s.meant;
    }
    expect(right / found).toBeGreaterThan(0.97);
    expect(right / total).toBeGreaterThan(0.97);
  });
});

describe('how long a note must be', () => {
  const burst = (ms: number) => track([{ midi: 60, ms: 300 }, { gap: 200 }, { midi: 66, ms }, { gap: 200 }, { midi: 62, ms: 300 }]);

  it('keeps notes of 80 ms by default, so fast notes still count', () => {
    expect(pitches(burst(80))).toEqual([60, 66, 62]);
  });

  it('can ask for 100 ms of stable pitch instead', () => {
    expect(pitches(burst(80), { minNoteMs: 100 })).toEqual([60, 62]);
    expect(pitches(burst(100), { minNoteMs: 100 })).toEqual([60, 66, 62]);
  });

  it('drops a 60 ms blip with either setting', () => {
    expect(pitches(burst(60))).toEqual([60, 62]);
    expect(pitches(burst(60), { minNoteMs: 100 })).toEqual([60, 62]);
  });
});

describe('the new defaults keep the old results on clean hums', () => {
  it('gives the same notes with and without the cleanups for a clean, in-tune hum', () => {
    const frames = steadyNotes([60, 62, 64, 65, 67, 69]);
    const off = { fixOctaves: false, correctTuning: false, dropGlides: false };
    expect(segmentNotes(frames)).toEqual(segmentNotes(frames, off));
  });
});
