// Small repairs for a hummed pitch track, used by segmentNotes. Pure functions on plain numbers, no bus and no audio.

export interface VoicedFrame {
  t: number;
  midi: number;
  conf: number;
}

export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---- 1. octave jumps ----

/** A jump this big (in semitones) between two neighbouring frames ends a smooth stretch of pitch. */
const STRETCH_BREAK = 4;
/** How far from a whole number of octaves (in semitones) a stretch may sit and still count as an octave error. */
const OCTAVE_TOLERANCE = 1.5;
/** How many frames next to a stretch are used to judge the pitch around it. */
const CONTEXT_FRAMES = 4;

export interface OctaveOptions {
  /** Longest stretch (ms) that may be an error. */
  maxMs: number;
  /** Frames further apart than this (ms) are not neighbours. */
  gapMs: number;
  frameMs: number;
}

/**
 * Pitch trackers sometimes jump by exactly one octave (or two) for a frame or a few frames, mostly on breathy or low hums.
 * A short stretch of smooth pitch that sits an octave away from the pitch right before it AND the pitch right after it
 * (both touching it, no pause) is folded back. The frames are changed in place; the number of stretches folded is returned.
 * A real octave leap is left alone: its two neighbours are not an octave away on the same side.
 */
export function foldOctaves(frames: VoicedFrame[], o: OctaveOptions): number {
  const stretches: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i <= frames.length; i++) {
    if (i === frames.length || frames[i].t - frames[i - 1].t > o.gapMs || Math.abs(frames[i].midi - frames[i - 1].midi) >= STRETCH_BREAK) {
      stretches.push([start, i]);
      start = i;
    }
  }
  let folded = 0;
  for (let k = 1; k < stretches.length - 1; k++) {
    const [s, e] = stretches[k];
    const [ps, pe] = stretches[k - 1];
    const [ns, ne] = stretches[k + 1];
    if (frames[e - 1].t - frames[s].t + o.frameMs > o.maxMs) continue;
    if (frames[s].t - frames[pe - 1].t > o.gapMs || frames[ns].t - frames[e - 1].t > o.gapMs) continue;
    const here = median(frames.slice(s, e).map((f) => f.midi));
    const before = median(frames.slice(Math.max(ps, pe - CONTEXT_FRAMES), pe).map((f) => f.midi));
    const after = median(frames.slice(ns, Math.min(ne, ns + CONTEXT_FRAMES)).map((f) => f.midi));
    const octaves = Math.round((here - before) / 12);
    if (octaves === 0 || Math.abs(octaves) > 2) continue;
    if (Math.abs(here - before - 12 * octaves) > OCTAVE_TOLERANCE || Math.abs(here - after - 12 * octaves) > OCTAVE_TOLERANCE) continue;
    for (let i = s; i < e; i++) frames[i].midi -= 12 * octaves;
    folded++;
  }
  return folded;
}

// ---- 2. slides ----

/** Least-squares slope of pitch over time, in semitones per second. */
export function slopePerSecond(ts: readonly number[], mids: readonly number[]): number {
  const n = ts.length;
  if (n < 2) return 0;
  const mt = ts.reduce((a, b) => a + b, 0) / n;
  const mm = mids.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (ts[i] - mt) * (mids[i] - mm);
    den += (ts[i] - mt) ** 2;
  }
  return den > 0 ? (num / den) * 1000 : 0;
}

/**
 * Is this stretch of frames a slide between two notes (pitch sweeping steadily one way) and not a note?
 * It must move faster than `minSlope` semitones per second, cover at least `minTravel` semitones, and keep moving
 * the same way in both halves: a note that only starts with a short slide into it settles in its second half and stays a note.
 */
export function isSlide(ts: readonly number[], mids: readonly number[], minSlope: number, minTravel: number): boolean {
  const n = ts.length;
  if (n < 4) return false;
  const whole = slopePerSecond(ts, mids);
  if (Math.abs(whole) < minSlope || Math.abs(whole) * ((ts[n - 1] - ts[0]) / 1000) < minTravel) return false;
  const h = n >> 1;
  const first = slopePerSecond(ts.slice(0, h), mids.slice(0, h));
  const second = slopePerSecond(ts.slice(n - h), mids.slice(n - h));
  return first * whole > 0 && second * whole > 0 && Math.abs(first) >= minSlope / 2 && Math.abs(second) >= minSlope / 2;
}

// ---- 3. the singer's tuning ----

/** Distance from x to the nearest whole number, with sign: a value in [-0.5, 0.5]. */
const wrap = (x: number) => x - Math.round(x);

/**
 * The typical fractional part of some pitches, as a value in [-0.5, 0.5] (the fractions live on a circle: 0.45 and -0.45 are close).
 * It is the point on the circle with the smallest total distance to the values, nudged to the median of what is around it,
 * so one odd note does not drag it.
 */
export function circularMedian(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let best = xs[0];
  let bestSum = Infinity;
  for (const c of xs) {
    const sum = xs.reduce((a, x) => a + Math.abs(wrap(x - c)), 0);
    if (sum < bestSum - 1e-12) {
      bestSum = sum;
      best = c;
    }
  }
  return wrap(best + median(xs.map((x) => wrap(x - best))));
}

export interface TuningOptions {
  /** How many of the latest notes to look at. */
  recent: number;
  /** The first notes have no history: the first few notes judge each other. */
  warmup: number;
  /** With fewer notes than this nothing is corrected (the notes are too few to tell a habit from an accident). */
  minNotes: number;
}

/**
 * Whole-number pitches for a row of note centres (float MIDI, in time order) after taking out a running tuning offset.
 * The offset is the median of how far the latest `recent` stable notes were from the notes chosen for them (a slowly
 * moving median, clamped to plus or minus 50 cents), so a singer who is steadily flat or sharp, or who slides sharp as
 * the song goes on, still lands on the right notes. `stable` marks notes long enough to say something about the tuning.
 */
export function tunedPitches(centers: readonly number[], stable: readonly boolean[], o: TuningOptions): { pitches: number[]; offsets: number[] } {
  const n = centers.length;
  const pitches: number[] = [];
  const offsets: number[] = [];
  const errors: number[] = [];
  const warmStart = n >= o.minNotes ? circularMedian(centers.slice(0, Math.min(n, o.warmup)).map(wrap)) : 0;
  for (let i = 0; i < n; i++) {
    let offset = 0;
    if (n >= o.minNotes) offset = errors.length >= o.warmup ? median(errors.slice(-o.recent)) : warmStart;
    offset = Math.max(-0.5, Math.min(0.5, offset));
    const pitch = Math.round(centers[i] - offset);
    pitches.push(pitch);
    offsets.push(offset);
    if (stable[i]) errors.push(centers[i] - pitch);
  }
  return { pitches, offsets };
}
