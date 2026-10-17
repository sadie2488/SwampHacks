// Compares what the player played with what the song expects. Pure maths: no bus, no browser.
//
// CLOCKS. Expected notes are in SONG seconds at 1.0x speed. When the song plays at a tempo factor `rate`, the note due at
// song time t is heard `(t - startSec) / rate` seconds after the run started: we scale the EXPECTED times, never the
// player's (music-notes section 9). The player's times are plain seconds since the run started (the moment the song was at
// startSec), still including the hardware lag; `latencyMs` from the clap check is subtracted here.
//
// A player who is a bit slow drifts further from the written times with every note, so the matching first finds the
// player's own pace (a straight line through the first notes, then through everything that matched) and matches notes
// against that line, not against the written times.
import { PRACTICE } from './config';
import { foldedCents, median, robustLine, type Line } from './math';

export interface ExpectedNote {
  id?: string;
  /** Concert-pitch MIDI. */
  pitch: number;
  /** Song seconds at 1.0x. */
  onsetSec: number;
  durationSec: number;
}

export interface PlayedNote {
  /** Seconds since the run started, hardware lag still included. */
  timeSec: number;
  /** Detected concert-pitch MIDI as a fraction (median over the note). Missing for a timing-only onset. */
  pitch?: number;
  durationSec?: number;
  confidence?: number;
}

export interface CompareOptions {
  /** Playback tempo factor (1 = original speed). */
  rate: number;
  /** The shared latency offset from the clap check; subtracted from every played time. Default 0. */
  latencyMs?: number;
  /** Song position (song seconds) where the run began. Default 0. */
  startSec?: number;
  /** Song position where the run ended: later expected notes are not counted. Default: after the last matched note. */
  endSec?: number;
  /** Semitones the song was shifted by; added to the expected pitches. */
  pitchShift?: number;
  /** Override the matching window (ms). */
  windowMs?: number;
}

export interface NoteResult {
  /** Position of this note in the expected list. */
  index: number;
  note: ExpectedNote;
  /** When it was due, seconds since the run started. */
  expectedSec: number;
  played?: PlayedNote;
  /** Played minus due, after taking off the latency offset. Negative = early. */
  timingErrorMs?: number;
  /** Played minus the player's own pace line: how uneven they were, apart from speed. */
  residualMs?: number;
  /** Detected pitch minus expected, in cents, folded to the nearest octave. Positive = sharp. */
  pitchErrorCents?: number;
}

export interface CompareResult {
  rate: number;
  latencyMs: number;
  /** Song position where the run began (song seconds). */
  startSec: number;
  /** Semitones the song was shifted by. */
  pitchShift: number;
  windowMs: number;
  /** Every expected note that was due, in order. */
  notes: NoteResult[];
  matched: NoteResult[];
  missed: NoteResult[];
  /** Played sounds that matched no expected note (times are the raw run times). */
  extras: PlayedNote[];
  /**
   * The player's pace: corrected played time = interceptSec + slope * due time. Slope 1 = exactly in tempo,
   * above 1 = slower than the song. Null with fewer than 3 matched notes.
   */
  line: { slope: number; interceptSec: number } | null;
}

export type TimingClass = 'on time' | 'a bit early' | 'a bit late' | 'early' | 'late';

/** Music-notes section 7: within 50 ms is on time, 50-100 ms is a bit early or late, beyond that is off. */
export function timingClass(errorMs: number): TimingClass {
  const r = PRACTICE.rules;
  const a = Math.abs(errorMs);
  if (a <= r.onTimeMs) return 'on time';
  if (a <= r.aBitMs) return errorMs < 0 ? 'a bit early' : 'a bit late';
  return errorMs < 0 ? 'early' : 'late';
}

const SLOPE_MIN = 0.5;
const SLOPE_MAX = 2;
const SLOPE_STEP = 0.01;
/** Shifts tried by the first guess: -window to +window in this many steps each side. */
const OFFSET_STEPS = 8;
/** The local pace is read from this many matched notes around a note. */
const LOCAL_POINTS = 6;
/** Sounds up to this many windows from the whole-run line can be paired (the window itself limits the step from the previous pair). */
const REACH = 2;
/** How many expected notes back a pair may skip. */
const LOOKBACK = 40;
/** How much the distance from the whole-run line counts, compared with the distance from the previous pair. */
const LINE_WEIGHT = 0.15;
const MISS_COST = 1;
const EXTRA_COST = 1;
const WRONG_PITCH_PENALTY = 0.5;

interface State {
  /** Index of the played sound this expected note is paired with. */
  j: number;
  /** Cheapest total cost of any pairing that ends with this pair. */
  cost: number;
  prevI: number;
  prevC: number;
}

/** Index of the first value in a sorted list that is at least `t`. */
function lowerBound(sorted: number[], t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Order-keeping alignment: each expected note is paired with at most one played sound, in the same order, and the cheapest
 * set of pairs wins. A pair costs more the further the sound is from where the player's pace says it should be: from the
 * previous pair (so a player who slowly drifts or speeds up is followed) or from the whole-run line, whichever is closer.
 * Skipping an expected note (missed) or a sound (extra) costs 1, the same as being a whole window away.
 * Returns, for each expected note, the index of its played sound or -1.
 */
function align(expSec: number[], expPitch: number[], playSec: number[], playPitch: Array<number | undefined>, line: Line, windowSec: number): number[] {
  const n = expSec.length;
  const m = playSec.length;
  const reach = windowSec * REACH;
  const states: State[][] = [];
  for (let i = 0; i < n; i++) {
    const guess = line.intercept + line.slope * expSec[i];
    const list: State[] = [];
    for (let j = lowerBound(playSec, guess - reach); j < m && playSec[j] <= guess + reach; j++) {
      const t = playSec[j];
      const fromLine = Math.abs(t - guess);
      const p = playPitch[j];
      const pitchCost = p !== undefined && Math.abs(foldedCents(p, expPitch[i])) >= 150 ? WRONG_PITCH_PENALTY : 0;
      let best = Infinity;
      let prevI = -1;
      let prevC = -1;
      // the first pair of the run: everything before it is missed or extra
      if (fromLine <= windowSec) best = MISS_COST * i + EXTRA_COST * j + fromLine / windowSec + pitchCost;
      for (let ip = i - 1; ip >= Math.max(0, i - LOOKBACK); ip--) {
        const steps = i - ip;
        states[ip].forEach((prev, c) => {
          if (prev.j >= j) return;
          const stepDev = Math.abs(t - (playSec[prev.j] + (expSec[i] - expSec[ip]) * line.slope));
          // close to where the previous pair says, or close to the whole-run line: either is a believable place for this sound
          const dev = Math.min(stepDev / Math.sqrt(steps), fromLine);
          if (dev > windowSec) return;
          const cost = prev.cost + MISS_COST * (steps - 1) + EXTRA_COST * (j - prev.j - 1) + dev / windowSec + (LINE_WEIGHT * fromLine) / reach + pitchCost;
          if (cost < best - 1e-12) {
            best = cost;
            prevI = ip;
            prevC = c;
          }
        });
      }
      if (best < Infinity) list.push({ j, cost: best, prevI, prevC });
    }
    states.push(list);
  }
  const out = new Array<number>(n).fill(-1);
  let bestEnd = MISS_COST * n + EXTRA_COST * m; // nothing paired at all
  let endI = -1;
  let endC = -1;
  states.forEach((list, i) =>
    list.forEach((st, c) => {
      const total = st.cost + MISS_COST * (n - 1 - i) + EXTRA_COST * (m - 1 - st.j);
      if (total < bestEnd - 1e-12) {
        bestEnd = total;
        endI = i;
        endC = c;
      }
    }),
  );
  while (endI >= 0) {
    const st = states[endI][endC];
    out[endI] = st.j;
    endI = st.prevI;
    endC = st.prevC;
  }
  return out;
}

/** Fit the pace line to (due, played) pairs; with fewer than 3 pairs keep the slope we already had and only shift it. */
function paceLine(pairs: Array<[number, number]>, fallback: Line): Line {
  const line = robustLine(
    pairs.map((p) => p[0]),
    pairs.map((p) => p[1]),
  );
  if (line && line.slope >= SLOPE_MIN && line.slope <= SLOPE_MAX) return line;
  return { slope: fallback.slope, intercept: pairs.length ? median(pairs.map(([e, p]) => p - fallback.slope * e)) : fallback.intercept };
}

/** Index of the value in a sorted list that is closest to t (the list must not be empty). */
function nearestIndex(sorted: number[], t: number): number {
  const hi = lowerBound(sorted, t);
  if (hi === 0) return 0;
  if (hi === sorted.length) return sorted.length - 1;
  return t - sorted[hi - 1] <= sorted[hi] - t ? hi - 1 : hi;
}

/**
 * A first guess at the player's pace, before any note is paired: try many speeds (and small shifts) and keep the line that
 * passes close to the most expected notes. A player who is 10 percent slow is half a second off after eight notes, so
 * matching against the written times alone would pair notes with their neighbours.
 */
function searchLine(allExpSec: number[], playSec: number[], windowSec: number): Line {
  if (allExpSec.length === 0 || playSec.length < PRACTICE.rules.minMatchedNotes) return { slope: 1, intercept: 0 };
  // a long song needs no more than a few hundred notes to find the pace
  const expSec = allExpSec.length > 240 ? Array.from({ length: 240 }, (_, k) => allExpSec[Math.floor((k * (allExpSec.length - 1)) / 239)]) : allExpSec;
  const tight = windowSec / 2;
  const claimed = new Uint8Array(playSec.length);
  let best: Line = { slope: 1, intercept: 0 };
  let bestKey: [number, number, number] = [-1, 0, 0];
  for (let s = SLOPE_MIN; s <= SLOPE_MAX + 1e-9; s += SLOPE_STEP) {
    for (let k = -OFFSET_STEPS; k <= OFFSET_STEPS; k++) {
      const a = (k * windowSec) / OFFSET_STEPS;
      // score: how many different sounds lie close to the line (a line that runs twice as fast would otherwise "hit" each sound twice)
      claimed.fill(0);
      let count = 0;
      for (const e of expSec) {
        const j = nearestIndex(playSec, a + s * e);
        if (!claimed[j] && Math.abs(playSec[j] - (a + s * e)) <= tight) {
          claimed[j] = 1;
          count++;
        }
      }
      const key: [number, number, number] = [count, -Math.abs(s - 1), -Math.abs(a)];
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] + 1e-9 || (Math.abs(key[1] - bestKey[1]) <= 1e-9 && key[2] > bestKey[2])))) {
        best = { slope: s, intercept: a };
        bestKey = key;
      }
    }
  }
  return best;
}

/**
 * Where the player's pace says expected note `i` should land, judged from the matched notes around it (not counting note
 * `i` itself): a straight line through the nearest six. Falls back to the whole-run line when there are too few.
 */
function localPredictor(assign: number[], expSec: number[], playSec: number[], whole: Line): (i: number) => number {
  const matched: number[] = [];
  assign.forEach((j, i) => {
    if (j >= 0) matched.push(i);
  });
  return (i) => {
    let at = 0;
    while (at < matched.length && matched[at] < i) at++;
    let left = at - 1;
    let right = matched[at] === i ? at + 1 : at;
    const near: number[] = [];
    while (near.length < LOCAL_POINTS && (left >= 0 || right < matched.length)) {
      const takeLeft = right >= matched.length || (left >= 0 && i - matched[left] <= matched[right] - i);
      near.push(takeLeft ? matched[left--] : matched[right++]);
    }
    const line = near.length >= 3 ? robustLine(near.map((k) => expSec[k]), near.map((k) => playSec[assign[k]])) : null;
    const use = line && line.slope >= SLOPE_MIN && line.slope <= SLOPE_MAX ? line : whole;
    return use.intercept + use.slope * expSec[i];
  };
}

export function compareNotes(expected: ExpectedNote[], played: PlayedNote[], opts: CompareOptions): CompareResult {
  const cfg = PRACTICE.compare;
  const rate = opts.rate > 0 ? opts.rate : 1;
  const latencyMs = opts.latencyMs ?? 0;
  const startSec = opts.startSec ?? 0;
  const shift = opts.pitchShift ?? 0;

  const due = expected
    .filter((n) => n.onsetSec >= startSec - 1e-6 && (opts.endSec === undefined || n.onsetSec < opts.endSec - 1e-6))
    .sort((a, b) => a.onsetSec - b.onsetSec);
  const expSec = due.map((n) => (n.onsetSec - startSec) / rate);
  const expPitch = due.map((n) => n.pitch + shift);

  // the typical gap between notes limits the window, so fast songs do not match the wrong neighbour
  const gaps = expSec.slice(1).map((t, k) => t - expSec[k]).filter((g) => g > 0.02);
  const windowMs = opts.windowMs ?? Math.min(cfg.windowMs / rate, gaps.length ? cfg.maxWindowOfGap * median(gaps) * 1000 : Infinity);
  const windowSec = windowMs / 1000;

  // the player's sounds in time order, with the hardware lag taken off
  const sounds = played
    .map((p) => ({ p, t: p.timeSec - latencyMs / 1000 }))
    .filter((s) => Number.isFinite(s.t) && s.t > -2 * windowSec)
    .sort((a, b) => a.t - b.t);
  const playSec = sounds.map((s) => s.t);
  const playPitch = sounds.map((s) => s.p.pitch);

  // a first guess at the player's pace, then pair notes against it and refine the pace from the pairs until nothing changes
  let line = searchLine(expSec, playSec, windowSec);
  let assign = align(expSec, expPitch, playSec, playPitch, line, windowSec);
  for (let pass = 1; pass < cfg.maxPasses; pass++) {
    line = paceLine(pairsOf(assign, expSec, playSec), line);
    const next = align(expSec, expPitch, playSec, playPitch, line, windowSec);
    const same = next.every((v, k) => v === assign[k]);
    assign = next;
    if (same) break;
  }

  // without a stated end, notes after the last matched one were simply not reached yet
  let count = due.length;
  if (opts.endSec === undefined) {
    const last = assign.reduce((acc, j, i) => (j >= 0 ? i : acc), -1);
    if (last >= 0) count = last + 1;
  }

  const matchedPairs = pairsOf(assign, expSec, playSec);
  const final = matchedPairs.length >= PRACTICE.rules.minMatchedNotes ? paceLine(matchedPairs, line) : null;

  const localGuess = final ? localPredictor(assign, expSec, playSec, final) : () => 0;
  const notes: NoteResult[] = [];
  const usedSound = new Set<number>();
  for (let i = 0; i < count; i++) {
    const r: NoteResult = { index: i, note: due[i], expectedSec: expSec[i] };
    const j = assign[i];
    if (j >= 0) {
      const s = sounds[j];
      usedSound.add(j);
      r.played = s.p;
      r.timingErrorMs = (s.t - expSec[i]) * 1000;
      r.residualMs = final ? (s.t - localGuess(i)) * 1000 : undefined;
      if (s.p.pitch !== undefined) r.pitchErrorCents = foldedCents(s.p.pitch, expPitch[i]);
    }
    notes.push(r);
  }
  const extras = sounds.filter((_, j) => !usedSound.has(j)).map((s) => s.p);

  return {
    rate,
    latencyMs,
    startSec,
    pitchShift: shift,
    windowMs,
    notes,
    matched: notes.filter((n) => n.played),
    missed: notes.filter((n) => !n.played),
    extras,
    line: final ? { slope: final.slope, interceptSec: final.intercept } : null,
  };
}

function pairsOf(assign: number[], expSec: number[], playSec: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  assign.forEach((j, i) => {
    if (j >= 0) out.push([expSec[i], playSec[j]]);
  });
  return out;
}
