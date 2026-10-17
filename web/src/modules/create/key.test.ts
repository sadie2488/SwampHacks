import { describe, expect, it } from 'vitest';
import type { Note } from '@/contracts';
import { countMoved, estimateKey, fitTakeToKey, isKey, keyName, scaleClasses, snapPitch, snapToKey } from './key';

/** Notes one after the other, each `beats` long (a beat is half a second). */
function melody(pitches: Array<number | [number, number]>): Note[] {
  let at = 0;
  return pitches.map((p) => {
    const [pitch, beats] = Array.isArray(p) ? p : [p, 1];
    const note: Note = { pitch, onset_sec: at * 0.5, duration_sec: beats * 0.5, onset_beat: at, duration_beat: beats, confidence: 0.9 };
    at += beats;
    return note;
  });
}
const pitchesOf = (notes: Note[]) => notes.map((n) => n.pitch);

describe('scaleClasses', () => {
  const names = (flags: boolean[]) => flags.flatMap((on, pc) => (on ? [pc] : []));
  it('C major is the white keys', () => expect(names(scaleClasses({ tonic: 'C', mode: 'major' }))).toEqual([0, 2, 4, 5, 7, 9, 11]));
  it('A minor has the same notes as C major', () => expect(names(scaleClasses({ tonic: 'A', mode: 'minor' }))).toEqual([0, 2, 4, 5, 7, 9, 11]));
  it('F major has B flat and no B', () => {
    const f = scaleClasses({ tonic: 'F', mode: 'major' });
    expect(f[10]).toBe(true);
    expect(f[11]).toBe(false);
    expect(names(f)).toEqual([0, 2, 4, 5, 7, 9, 10]);
  });
  it('knows flats and sharps spelled either way', () => {
    expect(scaleClasses({ tonic: 'Db', mode: 'major' })).toEqual(scaleClasses({ tonic: 'C#', mode: 'major' }));
    expect(scaleClasses({ tonic: 'Bb', mode: 'minor' })).toEqual(scaleClasses({ tonic: 'A#', mode: 'minor' }));
    expect(names(scaleClasses({ tonic: 'D', mode: 'minor' }))).toEqual([0, 2, 4, 5, 7, 9, 10]);
  });
});

describe('snapToKey', () => {
  it('C major: moves out-of-key notes down to the lower neighbour (a tie goes to the lower note)', () => {
    const notes = melody([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]);
    expect(pitchesOf(snapToKey(notes, { tonic: 'C', mode: 'major' }))).toEqual([60, 60, 62, 62, 64, 65, 65, 67, 67, 69, 69, 71, 72]);
  });

  it('A minor: C sharp goes to C, G sharp to G, F sharp to F, and the notes of the key stay', () => {
    const notes = melody([69, 71, 72, 74, 76, 77, 79, 61 + 12, 68, 66, 70]);
    expect(pitchesOf(snapToKey(notes, { tonic: 'A', mode: 'minor' }))).toEqual([69, 71, 72, 74, 76, 77, 79, 72, 67, 65, 69]);
  });

  it('F major: B natural goes to B flat, E flat to D, and E, B flat and C stay', () => {
    const f = { tonic: 'F', mode: 'major' } as const;
    expect(pitchesOf(snapToKey(melody([71, 63, 64, 70, 72, 66, 68]), f))).toEqual([70, 62, 64, 70, 72, 65, 67]);
  });

  it('works in every octave', () => {
    const c = { tonic: 'C', mode: 'major' } as const;
    expect(pitchesOf(snapToKey(melody([37, 49, 61, 73, 85]), c))).toEqual([36, 48, 60, 72, 84]);
  });

  it('works for keys spelled with flats and sharps', () => {
    expect(pitchesOf(snapToKey(melody([60, 62, 65, 67]), { tonic: 'Eb', mode: 'major' }))).toEqual([60, 62, 65, 67]);
    expect(pitchesOf(snapToKey(melody([64, 66]), { tonic: 'Eb', mode: 'major' }))).toEqual([63, 65]); // E natural and F sharp are not in E flat major
    expect(pitchesOf(snapToKey(melody([61, 64]), { tonic: 'F#', mode: 'major' }))).toEqual([61, 63]); // C sharp stays; E sits between D sharp and E sharp, and the tie goes down
  });

  it('keeps timing, confidence and every other field, and does not change the input', () => {
    const notes = melody([61, 62]);
    notes[0].velocity = 0.7;
    notes[0].part = 'hum';
    const before = JSON.stringify(notes);
    const out = snapToKey(notes, { tonic: 'C', mode: 'major' });
    expect(JSON.stringify(notes)).toBe(before);
    expect(out[0]).toEqual({ ...notes[0], pitch: 60 });
    expect(out[1]).toEqual(notes[1]);
    expect(out[0]).not.toBe(notes[0]);
  });

  it('the chromatic option keeps every note where it is', () => {
    const notes = melody([61, 63, 66, 68, 70]);
    const out = snapToKey(notes, { tonic: 'C', mode: 'major' }, { chromatic: true });
    expect(out).toEqual(notes);
    expect(out[0]).not.toBe(notes[0]);
    expect(snapToKey(notes, undefined, { chromatic: true })).toEqual(notes);
  });

  it('an empty take stays empty', () => {
    expect(snapToKey([], { tonic: 'C', mode: 'major' })).toEqual([]);
    expect(snapToKey([])).toEqual([]);
  });

  it('snapPitch finds the nearest note of the scale', () => {
    const c = scaleClasses({ tonic: 'C', mode: 'major' });
    expect(snapPitch(60, c)).toBe(60);
    expect(snapPitch(61, c)).toBe(60);
    expect(snapPitch(66, c)).toBe(65);
    const pentatonicLike = scaleClasses({ tonic: 'C', mode: 'major' }).map((on, pc) => on && pc !== 5 && pc !== 11); // C D E G A
    expect(snapPitch(65, pentatonicLike)).toBe(64); // F: E is 1 below, G is 2 above
    expect(snapPitch(71, pentatonicLike)).toBe(72); // B: A is 2 below, the next C is 1 above
  });

  describe('with no key given', () => {
    const cMajorPhrase = melody([60, 62, 64, 65, 67, [69, 1], 67, 65, 64, 62, [60, 2]]);

    it('guesses the key from the take and moves a stray note into it', () => {
      const notes = melody([60, 62, 64, 65, 67, 65, 64, 62, 61, 60, [60, 2]]); // one C sharp
      const out = snapToKey(notes);
      expect(pitchesOf(out)).toEqual([60, 62, 64, 65, 67, 65, 64, 62, 60, 60, 60]);
    });

    it('leaves a take that already fits alone', () => {
      expect(pitchesOf(snapToKey(cMajorPhrase))).toEqual(pitchesOf(cMajorPhrase));
    });

    it('does nothing with fewer than three notes (too little to guess a key from)', () => {
      const two = melody([61, 66]);
      expect(snapToKey(two)).toEqual(two);
    });

    it('does not rewrite a take that fits no key well', () => {
      const chromatic = melody([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]);
      expect(pitchesOf(snapToKey(chromatic))).toEqual(pitchesOf(chromatic));
    });

    it('does not move a note that is sung a lot, only rare ones', () => {
      // F sharp is half of this take: the guessed key must not throw it away
      const notes = melody([[66, 4], [67, 2], [62, 2], [66, 2]]);
      expect(snapToKey(notes).filter((n) => n.pitch === 66).length).toBe(2);
    });
  });
});

describe('estimateKey (Krumhansl-Schmuckler)', () => {
  const twinkle = [60, 60, 67, 67, 69, 69, [67, 2], 65, 65, 64, 64, 62, 62, [60, 2]] as Array<number | [number, number]>;
  const transpose = (semitones: number) => twinkle.map((p) => (Array.isArray(p) ? ([p[0] + semitones, p[1]] as [number, number]) : p + semitones));

  it('finds C major for Twinkle, Twinkle', () => {
    const key = estimateKey(melody(twinkle));
    expect(key).toMatchObject({ tonic: 'C', mode: 'major' });
    expect(key!.correlation).toBeGreaterThan(0.85);
  });

  it('follows the tune when it is moved to another key', () => {
    expect(estimateKey(melody(transpose(7)))).toMatchObject({ tonic: 'G', mode: 'major' });
    expect(estimateKey(melody(transpose(5)))).toMatchObject({ tonic: 'F', mode: 'major' });
    expect(estimateKey(melody(transpose(-2)))).toMatchObject({ tonic: 'Bb', mode: 'major' });
    expect(estimateKey(melody(transpose(2)))).toMatchObject({ tonic: 'D', mode: 'major' });
  });

  it('finds a minor key: a tune around A with the minor third and sixth', () => {
    const tune = [[69, 2], 72, 71, 69, [64, 2], 69, 72, 71, 69, 67, [64, 2], 65, 64, 62, [69, 3]] as Array<number | [number, number]>;
    expect(estimateKey(melody(tune))).toMatchObject({ tonic: 'A', mode: 'minor' });
  });

  it('counts long notes more than short ones', () => {
    // the same four pitches; which one is held decides the key
    const heldC = estimateKey(melody([[60, 6], 62, 64, 67]));
    const heldG = estimateKey(melody([60, 62, 64, [67, 6]]));
    expect(heldC).toMatchObject({ tonic: 'C', mode: 'major' });
    expect(heldG!.tonic).not.toBe('C');
  });

  it('ignores the octave a note is in', () => {
    const low = estimateKey(melody(twinkle.map((p) => (Array.isArray(p) ? ([p[0] - 24, p[1]] as [number, number]) : p - 24))));
    expect(low).toMatchObject({ tonic: 'C', mode: 'major' });
  });

  it('says nothing for fewer than three notes, or when asked for more', () => {
    expect(estimateKey(melody([60, 64]))).toBeUndefined();
    expect(estimateKey([])).toBeUndefined();
    expect(estimateKey(melody([60, 64, 67]))).toBeDefined();
    expect(estimateKey(melody([60, 64, 67]), 4)).toBeUndefined();
  });

  it('copes with notes that have no length', () => {
    const notes = melody(twinkle).map((n) => ({ ...n, duration_sec: 0, duration_beat: undefined }));
    expect(estimateKey(notes)).toMatchObject({ tonic: 'C', mode: 'major' });
  });
});

describe('fitTakeToKey', () => {
  const c = { tonic: 'C', mode: 'major' } as const;
  const withStray = melody([60, 62, 61, 65, 67]);

  it('with snapping on and a song key, moves the stray note and counts it', () => {
    const fit = fitTakeToKey(withStray, { snap: true, songKey: c });
    expect(pitchesOf(fit.notes)).toEqual([60, 62, 60, 65, 67]);
    expect(fit.key).toEqual(c);
    expect(fit.moved).toBe(1);
  });

  it('with snapping off, leaves the notes and shows the key guessed from the take', () => {
    const fit = fitTakeToKey(withStray, { snap: false, songKey: { tonic: 'F#', mode: 'major' } });
    expect(pitchesOf(fit.notes)).toEqual([60, 62, 61, 65, 67]);
    expect(fit.moved).toBe(0);
    expect(fit.key).toBeDefined();
  });

  it('with snapping off and too few notes to guess, shows the song key', () => {
    const fit = fitTakeToKey(melody([60, 61]), { snap: false, songKey: c });
    expect(fit.key).toEqual(c);
  });

  it('with snapping on and no song key, guesses the key and says which', () => {
    const fit = fitTakeToKey(melody([60, 62, 64, 65, 67, 65, 64, 62, 61, [60, 2]]), { snap: true });
    expect(fit.key).toEqual({ tonic: 'C', mode: 'major' });
    expect(fit.moved).toBe(1);
  });

  it('gives back an empty take as it is', () => {
    expect(fitTakeToKey([], { snap: true, songKey: c })).toEqual({ notes: [], key: c, moved: 0 });
    expect(fitTakeToKey([], { snap: false }).key).toBeUndefined();
  });

  it('countMoved counts changed pitches', () => {
    expect(countMoved(melody([60, 61, 62]), melody([60, 60, 63]))).toBe(2);
  });
});

describe('isKey and keyName', () => {
  it('accepts a real key and rejects anything else', () => {
    expect(isKey({ tonic: 'C', mode: 'major' })).toBe(true);
    expect(isKey({ tonic: 'Bb', mode: 'minor', confidence: 0.5 })).toBe(true);
    expect(isKey({ tonic: 'H', mode: 'major' })).toBe(false);
    expect(isKey({ tonic: 'C', mode: 'dorian' })).toBe(false);
    expect(isKey(undefined)).toBe(false);
    expect(isKey(null)).toBe(false);
    expect(isKey('C major')).toBe(false);
  });

  it('writes the key in words', () => {
    expect(keyName({ tonic: 'C', mode: 'major' })).toBe('C major');
    expect(keyName({ tonic: 'F#', mode: 'minor' })).toBe('F# minor');
  });
});
