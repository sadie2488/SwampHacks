// Keys for Create mode: which notes belong to a key, moving hummed notes into the key, and guessing the key of a take.
// Pure functions on notes, no bus and no audio. Pitches are concert-pitch MIDI.
import type { Note, Tonic } from '@/contracts';

export interface Key {
  tonic: Tonic;
  mode: 'major' | 'minor';
}
export interface EstimatedKey extends Key {
  /** How well the notes fit the key, from -1 to 1 (higher is better). */
  correlation: number;
}

const TONIC_CLASS: Record<Tonic, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

/** Steps above the tonic: major is W W H W W W H, natural minor is W H W W H W W. */
const SCALE_STEPS = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] } as const;

/** How the 12 tonics are written when a key is guessed: flats for the flat keys, sharps for the sharp keys. */
const MAJOR_NAMES: Tonic[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES: Tonic[] = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/** Krumhansl-Kessler key profiles: how well each pitch class (starting at the tonic) fits a major or minor key. */
const PROFILE = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** "C major", "A minor". */
export const keyName = (key: Key): string => `${key.tonic} ${key.mode}`;

/** True for a value shaped like a key from a song analysis (so a half-filled analysis does not break the screen). */
export function isKey(value: unknown): value is Key {
  const k = value as Key | null | undefined;
  return !!k && typeof k.tonic === 'string' && k.tonic in TONIC_CLASS && (k.mode === 'major' || k.mode === 'minor');
}

/** The 12 pitch classes (0 = C) as true for the notes of the key's scale. */
export function scaleClasses(key: Key): boolean[] {
  const inKey = new Array<boolean>(12).fill(false);
  for (const step of SCALE_STEPS[key.mode]) inKey[mod12(TONIC_CLASS[key.tonic] + step)] = true;
  return inKey;
}

export interface SnapOptions {
  /** Keep every semitone: nothing is moved. Default false. */
  chromatic?: boolean;
}

/** The nearest pitch that belongs to the scale. A note exactly between two scale notes goes to the lower one. */
export function snapPitch(pitch: number, inKey: readonly boolean[]): number {
  for (let d = 0; d <= 6; d++) {
    if (inKey[mod12(pitch - d)]) return pitch - d;
    if (inKey[mod12(pitch + d)]) return pitch + d;
  }
  return pitch;
}

/** A guessed key only counts if its scale holds at least this share of the take (by length of notes). */
const GUESS_MIN_COVERAGE = 0.8;
/** With a guessed key only notes of a pitch class this rare in the take are moved: a note that is sung a lot was probably meant. */
const GUESS_MAX_SHARE = 0.2;

/** How long each of the 12 pitch classes is played in total (index 0 = C). */
function pitchClassWeights(notes: readonly Note[]): number[] {
  const histogram = new Array<number>(12).fill(0);
  for (const n of notes) histogram[mod12(Math.round(n.pitch))] += weight(n);
  return histogram;
}

/**
 * Move every out-of-key note to the nearest note of the key's scale (ties go to the lower note). Only the pitch changes:
 * times, lengths and everything else stay as they were. The scale is the plain major or natural minor scale.
 * With `chromatic` nothing is moved.
 * With no key given, the key is guessed from the notes themselves (estimateKey) and the snap is careful, because a guess from a
 * few notes can be wrong: nothing is moved unless the guessed scale holds at least 80% of the take, and then only notes whose
 * pitch class makes up less than 20% of it are moved. With too few notes to guess, the notes are returned unchanged.
 */
export function snapToKey(notes: readonly Note[], key?: Key, options: SnapOptions = {}): Note[] {
  const copy = () => notes.map((n) => ({ ...n }));
  if (options.chromatic) return copy();
  if (key) {
    const inKey = scaleClasses(key);
    return notes.map((n) => ({ ...n, pitch: snapPitch(n.pitch, inKey) }));
  }
  const guess = estimateKey(notes);
  if (!guess) return copy();
  const inKey = scaleClasses(guess);
  const classes = pitchClassWeights(notes);
  const total = classes.reduce((a, b) => a + b, 0);
  if (!(total > 0) || classes.reduce((a, w, pc) => a + (inKey[pc] ? w : 0), 0) / total < GUESS_MIN_COVERAGE) return copy();
  return notes.map((n) => (classes[mod12(Math.round(n.pitch))] / total < GUESS_MAX_SHARE ? { ...n, pitch: snapPitch(n.pitch, inKey) } : { ...n }));
}

/** How many notes differ in pitch between two lists of the same notes. */
export function countMoved(before: readonly Note[], after: readonly Note[]): number {
  return before.reduce((count, n, i) => count + (after[i] && after[i].pitch !== n.pitch ? 1 : 0), 0);
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** How long a note counts for: its length in seconds, or in beats, or 1. */
const weight = (n: Note): number => (n.duration_sec > 0 ? n.duration_sec : (n.duration_beat ?? 0) > 0 ? n.duration_beat! : 1);

/**
 * Guess the key of some notes with the Krumhansl-Schmuckler method: add up how long each of the 12 pitch classes is played,
 * compare that with the major and minor profiles turned to every tonic, and take the best fit. A tie goes to the earlier tonic (major first).
 * Returns undefined for fewer than `minNotes` notes (default 3): too little to say anything.
 */
export function estimateKey(notes: readonly Note[], minNotes = 3): EstimatedKey | undefined {
  if (notes.length < minNotes) return undefined;
  const histogram = pitchClassWeights(notes);
  let best: EstimatedKey | undefined;
  for (const mode of ['major', 'minor'] as const) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const rotated = histogram.map((_, pc) => PROFILE[mode][mod12(pc - tonic)]);
      const correlation = pearson(histogram, rotated);
      if (!best || correlation > best.correlation + 1e-9) {
        best = { tonic: (mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[tonic], mode, correlation };
      }
    }
  }
  return best;
}

/** The result of fitting a take to a key. */
export interface FittedTake {
  notes: Note[];
  /** The key the take is in, if it is known or could be guessed. */
  key?: Key;
  /** How many notes were moved to fit the key. */
  moved: number;
}

/**
 * What happens to a finished take: with `snap` on, the notes are moved into the song's key (or the key guessed from the take
 * when no song key is known). With it off the notes stay as hummed; the key shown is then the guess from the take, or the song's.
 */
export function fitTakeToKey(notes: readonly Note[], opts: { snap: boolean; songKey?: Key }): FittedTake {
  if (!opts.snap) {
    const guess = estimateKey(notes);
    return { notes: notes.map((n) => ({ ...n })), key: guess ? { tonic: guess.tonic, mode: guess.mode } : opts.songKey, moved: 0 };
  }
  const guess = opts.songKey ? undefined : estimateKey(notes);
  const key: Key | undefined = opts.songKey ?? (guess ? { tonic: guess.tonic, mode: guess.mode } : undefined);
  // a key from the song is trusted; a key guessed from the take is not, so snapToKey is careful with it
  const snapped = snapToKey(notes, opts.songKey);
  return { notes: snapped, key, moved: countMoved(notes, snapped) };
}
