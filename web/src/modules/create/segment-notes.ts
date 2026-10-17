// Hum to notes: turns frame-by-frame pitch (about 50 frames per second) into note events.
// Pure function, no audio and no bus, so it is easy to test with made-up pitch tracks.
import type { PitchFrame } from '@/bus';
import type { Note } from '@/contracts';
import { foldOctaves, isSlide, median, tunedPitches, type VoicedFrame } from './hum-cleanup';
import { DEFAULT_BPM } from './music';

export interface SegmentOptions {
  /** Tempo used for the beat fields and the grid. Default 100. */
  bpm?: number;
  /** Snap onsets and durations to a grid. Default true. */
  quantize?: boolean;
  /** Grid size in beats. Default 0.25 (a sixteenth note). */
  gridBeats?: number;
  /** Frames below this confidence are ignored. Default 0.5. */
  minConfidence?: number;
  /** Frames quieter than this are ignored. Default 0 (off). */
  minRms?: number;
  /** Width of the median filter in milliseconds. Default 60. */
  medianMs?: number;
  /** How far (in semitones) the pitch must move away from the note's running pitch before a new note starts. Default 0.75. */
  splitSemitones?: number;
  /** Notes shorter than this are dropped: a note needs this much stable pitch. Default 80 (100 is a stricter choice). */
  minNoteMs?: number;
  /** Gaps up to this long between two runs of the same pitch are bridged. Default 60. */
  maxGapMs?: number;
  /** Clip the result to [0, lengthSec] (the loop length). Default: no clip. */
  lengthSec?: number;
  /** Fold a frame or short run that sits an octave away from both of its neighbours back into place. Default true. */
  fixOctaves?: boolean;
  /** The longest run, in milliseconds, that is treated as an octave error. Default 120. */
  octaveMaxMs?: number;
  /** Take out the singer's steady tuning error (flat or sharp, drifting) before rounding to semitones. Default true. */
  correctTuning?: boolean;
  /** How many of the latest notes the tuning estimate looks at. Default 6. */
  tuningNotes?: number;
  /** Do not turn slides between two notes into notes. Default true. */
  dropGlides?: boolean;
  /** A run that moves faster than this many semitones per second is a slide, not a note. Default 6. */
  glideSlope?: number;
}

const DEFAULTS = {
  bpm: DEFAULT_BPM,
  quantize: true,
  gridBeats: 0.25,
  minConfidence: 0.5,
  minRms: 0,
  medianMs: 60,
  splitSemitones: 0.75,
  minNoteMs: 80,
  maxGapMs: 60,
  fixOctaves: true,
  octaveMaxMs: 120,
  correctTuning: true,
  tuningNotes: 6,
  dropGlides: true,
  glideSlope: 6,
};

/** A note this long (ms) is steady enough to tell something about the singer's tuning. */
const STABLE_MS = 100;
/** The tuning estimate starts once this many notes agree; with fewer notes in the whole take nothing is corrected. */
const TUNING_WARMUP = 3;
/** After a short hole in the pitch (two frames or more), a smaller move of this many semitones already starts a new note. */
const GAP_SPLIT = 0.45;
/** A slide must also move at least this far (semitones) in total. */
const GLIDE_MIN_TRAVEL = 0.6;

type Voiced = VoicedFrame;
interface Run {
  startMs: number;
  endMs: number;
  /** Frame times and smoothed pitches of the frames in this run. */
  ts: number[];
  mids: number[];
  confs: number[];
  pitch: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Typical time between frames: the median of the positive gaps, or 20 ms when there is nothing to measure. */
function estimateFrameMs(sortedTimes: number[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < sortedTimes.length; i++) {
    const d = sortedTimes[i] - sortedTimes[i - 1];
    if (d > 0 && d < 200) diffs.push(d);
  }
  return diffs.length ? median(diffs) : 20;
}

/**
 * Turn pitch frames into notes.
 *  1. keep frames with a pitch and enough confidence
 *  2. fold short octave jumps back (a frame or a few frames an octave away from both neighbours)
 *  3. median-filter the pitch (removes single-frame jumps)
 *  4. group frames into runs; a run goes on until the pitch moves clearly away from its running pitch (so vibrato does not split a note)
 *  5. drop slides (runs that sweep quickly between two notes) and runs shorter than the minimum
 *  6. settle each run's pitch (the median of its frames), take out the singer's running tuning offset, and round to a semitone
 *  7. merge same-pitch runs across tiny gaps
 *  8. optionally snap to a grid and clip to the loop length
 * Frame times (t_ms) are taken as milliseconds from the start of the take; the first note's onset is not moved to zero.
 */
export function segmentNotes(frames: readonly PitchFrame[], options: SegmentOptions = {}): Note[] {
  const o = { ...DEFAULTS, ...options };
  const sorted = [...frames].sort((a, b) => a.t_ms - b.t_ms);
  const frameMs = estimateFrameMs(sorted.map((f) => f.t_ms));

  // 1. frames that really hold a pitch
  const voiced: Voiced[] = [];
  for (const f of sorted) {
    if (f.midi === null || !Number.isFinite(f.midi) || f.midi < 0 || f.midi > 127) continue;
    if (!(f.confidence >= o.minConfidence)) continue;
    if (f.rms < o.minRms) continue;
    voiced.push({ t: f.t_ms, midi: f.midi, conf: f.confidence });
  }
  if (voiced.length === 0) return [];

  // 2. octave jumps
  if (o.fixOctaves) foldOctaves(voiced, { maxMs: o.octaveMaxMs, gapMs: Math.max(o.maxGapMs, 2.5 * frameMs), frameMs });

  // 3. median filter over a time window (only voiced frames take part)
  const half = o.medianMs / 2;
  const smooth: number[] = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < voiced.length; i++) {
    while (voiced[lo].t < voiced[i].t - half) lo++;
    while (hi < voiced.length && voiced[hi].t <= voiced[i].t + half) hi++;
    smooth.push(median(voiced.slice(lo, hi).map((v) => v.midi)));
  }

  // 4. runs: keep adding frames while the pitch stays near the run's running pitch (which follows slowly) and there is no long hole.
  //    Because the comparison is to a running pitch and not to a fixed semitone, vibrato (even centered between two semitones) never splits a note.
  let runs: Run[] = [];
  let run: Run | undefined;
  let ref = 0;
  for (let i = 0; i < voiced.length; i++) {
    const v = voiced[i];
    const m = smooth[i];
    const hole = run ? v.t - run.endMs : 0;
    if (!run || hole > o.maxGapMs || Math.abs(m - ref) > o.splitSemitones || (hole > 1.5 * frameMs && Math.abs(m - ref) > GAP_SPLIT)) {
      run = { startMs: v.t, endMs: v.t, ts: [], mids: [], confs: [], pitch: Math.round(m) };
      runs.push(run);
      ref = m;
    } else {
      ref += (m - ref) * (1 - Math.exp(-(v.t - run.endMs + frameMs) / 150));
    }
    run.endMs = v.t + frameMs;
    run.ts.push(v.t);
    run.mids.push(m);
    run.confs.push(v.conf);
  }

  // 5. drop slides and blips
  const longEnough = (r: Run) => r.endMs - r.startMs >= o.minNoteMs - 1e-6;
  const slide = (r: Run) => o.dropGlides && isSlide(r.ts, r.mids, o.glideSlope, GLIDE_MIN_TRAVEL);
  runs = runs.filter((r) => longEnough(r) && !slide(r));

  // 6. settle each run's pitch (the median of its frames), then remove the singer's tuning habit and round
  const centers = runs.map((r) => median(r.mids));
  if (o.correctTuning) {
    const { pitches } = tunedPitches(
      centers,
      runs.map((r) => r.endMs - r.startMs >= STABLE_MS - 1e-6),
      { recent: o.tuningNotes, warmup: TUNING_WARMUP, minNotes: TUNING_WARMUP },
    );
    runs.forEach((r, i) => (r.pitch = Math.max(0, Math.min(127, pitches[i]))));
  } else {
    runs.forEach((r, i) => (r.pitch = Math.max(0, Math.min(127, Math.round(centers[i])))));
  }

  // 7. merge neighbours with the same pitch across tiny gaps (what was left by a dropped blip, or a short dropout)
  const merged: Run[] = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.pitch === r.pitch && r.startMs - prev.endMs <= o.maxGapMs) {
      prev.endMs = r.endMs;
      prev.ts.push(...r.ts);
      prev.mids.push(...r.mids);
      prev.confs.push(...r.confs);
    } else {
      merged.push({ ...r, ts: [...r.ts], mids: [...r.mids], confs: [...r.confs] });
    }
  }

  // 8. times in beats, optionally snapped to the grid
  const spb = 60 / o.bpm;
  const grid = o.gridBeats > 0 ? o.gridBeats : 0.25;
  let timed = merged.map((r) => {
    let on = r.startMs / 1000 / spb;
    let off = r.endMs / 1000 / spb;
    if (o.quantize) {
      on = Math.round(on / grid) * grid;
      off = Math.round(off / grid) * grid;
      if (off <= on) off = on + grid;
    }
    return { pitch: r.pitch, on, off, conf: mean(r.confs) };
  });

  if (o.quantize) {
    // Two notes snapped to the same start: keep the longer one. A note that now overlaps the next is cut at the next start.
    const kept: typeof timed = [];
    for (const n of timed) {
      const prev = kept[kept.length - 1];
      if (prev && n.on <= prev.on) {
        if (n.off - n.on > prev.off - prev.on) kept[kept.length - 1] = n;
        continue;
      }
      if (prev && prev.off > n.on) prev.off = n.on;
      kept.push(n);
    }
    timed = kept;
  }

  const lengthBeats = o.lengthSec === undefined ? Infinity : o.lengthSec / spb;
  const notes: Note[] = [];
  for (const t of timed) {
    const on = Math.max(0, t.on);
    const off = Math.min(lengthBeats, t.off);
    if (off - on <= 1e-9) continue;
    notes.push({
      pitch: t.pitch,
      onset_sec: round6(on * spb),
      duration_sec: round6((off - on) * spb),
      onset_beat: round6(on),
      duration_beat: round6(off - on),
      confidence: Math.max(0, Math.min(1, round6(t.conf))),
    });
  }
  return notes;
}
