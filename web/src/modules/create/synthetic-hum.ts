// Made-up hums for tests: a melody sung by a pretend untrained singer, as pitch frames (50 per second) plus the notes that were meant.
// Everything is seeded, so a test always sees the same hum. Only tests use this file.
import type { PitchFrame } from '@/bus';

export const SIM_FRAME_MS = 20;

export interface MeantNote {
  pitch: number;
  /** Milliseconds from the start of the track. */
  onMs: number;
  offMs: number;
}
export interface MelodyNote {
  pitch: number;
  ms: number;
  /** Silence after the note (no pitch). 0 means the next note follows at once. */
  gapMs?: number;
}

export interface Singer {
  /** Constant flat (negative) or sharp (positive) habit, in cents. */
  offsetCents?: number;
  /** Extra cents added gradually from the first note (0) to the last note (this much): a singer who drifts. */
  driftCents?: number;
  /** Each note is off by a random amount with this standard deviation, in cents. */
  noteSigmaCents?: number;
  /** Random error of every frame, in cents (the tracker is not perfect). */
  jitterCents?: number;
  /** Vibrato depth (plus or minus), in cents, rate 5 to 8 Hz. */
  vibratoCents?: number;
  /** Notes start with a slide from the previous note that lasts this long. A negative value is a random slide of up to its size. */
  scoopMs?: number;
  /** Expected number of octave errors (1 to 5 frames) per note. */
  octaveErrorsPerNote?: number;
  /** Chance that a frame has no pitch at all. */
  dropoutChance?: number;
  /** Confidence of the octave-error frames (a bit lower than the real ones). */
  octaveErrorConfidence?: number;
}

export type Piece =
  | { midi: number; ms: number; vibratoSemitones?: number; vibratoHz?: number; confidence?: number }
  | { glide: [number, number]; ms: number }
  | { gap: number }
  | { junk: number };

/** Build a pitch track from hand-made pieces: steady notes (with optional vibrato), glides, silent gaps and junk (low-confidence noise). */
export function track(pieces: readonly Piece[], startMs = 0, stepMs = SIM_FRAME_MS): PitchFrame[] {
  const out: PitchFrame[] = [];
  const r = rng(7);
  let t = startMs;
  for (const p of pieces) {
    const frames = Math.round(('ms' in p ? p.ms : 'gap' in p ? p.gap : p.junk * stepMs) / stepMs);
    for (let i = 0; i < frames; i++, t += stepMs) {
      if ('gap' in p) out.push({ t_ms: t, midi: null, confidence: 0.1, rms: 0 });
      else if ('junk' in p) out.push({ t_ms: t, midi: 40 + r.uniform() * 40, confidence: 0.2, rms: 0.01 });
      else if ('glide' in p) out.push({ t_ms: t, midi: p.glide[0] + ((p.glide[1] - p.glide[0]) * i) / Math.max(1, frames - 1), confidence: 0.9, rms: 0.1 });
      else {
        const vibrato = p.vibratoSemitones ? Math.sin((2 * Math.PI * (p.vibratoHz ?? 6) * (i * stepMs)) / 1000) * p.vibratoSemitones : 0;
        out.push({ t_ms: t, midi: p.midi + vibrato, confidence: p.confidence ?? 0.9, rms: 0.1 });
      }
    }
  }
  return out;
}

/** Small seeded random numbers (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
  const int = (lo: number, hi: number) => lo + Math.floor(uniform() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(uniform() * xs.length)];
  return { uniform, normal, int, pick };
}

/** Sing a melody. Returns the frames and what was meant. */
export function sing(melody: readonly MelodyNote[], singer: Singer = {}, seed = 1, startMs = 0): { frames: PitchFrame[]; meant: MeantNote[] } {
  const r = rng(seed);
  const frames: PitchFrame[] = [];
  const meant: MeantNote[] = [];
  const n = melody.length;
  const vibratoHz = 5 + r.uniform() * 3;
  const vibratoPhase = r.uniform() * 2 * Math.PI;
  let t = startMs;
  let previous: number | null = null; // where the last note was actually sung
  let sinceNote = Infinity;

  const silence = (ms: number) => {
    for (let k = 0; k < Math.round(ms / SIM_FRAME_MS); k++, t += SIM_FRAME_MS) frames.push({ t_ms: t, midi: null, confidence: 0.1, rms: 0.002 });
    sinceNote += ms;
  };

  melody.forEach((note, i) => {
    const habit = (singer.offsetCents ?? 0) + (singer.driftCents ?? 0) * (n > 1 ? i / (n - 1) : 0) + r.normal() * (singer.noteSigmaCents ?? 0);
    const centre = note.pitch + habit / 100;
    const count = Math.max(1, Math.round(note.ms / SIM_FRAME_MS));
    const scoopMs = (singer.scoopMs ?? 0) < 0 ? r.uniform() * -(singer.scoopMs ?? 0) : (singer.scoopMs ?? 0);
    // a slide never takes more than the first half of the note
    const scoopFrames = previous !== null && sinceNote <= 60 ? Math.min(Math.floor(count / 2), Math.round(scoopMs / SIM_FRAME_MS)) : 0;
    const from = previous ?? centre;
    const onMs = t;

    // octave errors: a few runs of 1 to 5 frames somewhere inside the steady part
    const errorFrames = new Set<number>();
    const errors = (singer.octaveErrorsPerNote ?? 0) > r.uniform() ? 1 : 0;
    for (let e = 0; e < errors; e++) {
      const len = r.int(1, 5);
      const first = r.int(Math.max(2, scoopFrames + 1), Math.max(2, count - len - 2));
      for (let k = 0; k < len; k++) errorFrames.add(first + k);
    }
    const errorShift = r.uniform() < 0.5 ? 12 : -12;

    for (let k = 0; k < count; k++, t += SIM_FRAME_MS) {
      let midi = k < scoopFrames ? from + ((centre - from) * (k + 1)) / (scoopFrames + 1) : centre;
      const vibrato = singer.vibratoCents ? (singer.vibratoCents / 100) * Math.sin(vibratoPhase + (2 * Math.PI * vibratoHz * (k * SIM_FRAME_MS)) / 1000) * Math.min(1, (k * SIM_FRAME_MS) / 150) : 0;
      midi += vibrato + (r.normal() * (singer.jitterCents ?? 0)) / 100;
      let confidence = 0.9;
      if (errorFrames.has(k)) {
        midi += errorShift;
        confidence = singer.octaveErrorConfidence ?? 0.7;
      }
      if (r.uniform() < (singer.dropoutChance ?? 0)) frames.push({ t_ms: t, midi: null, confidence: 0.15, rms: 0.01 });
      else frames.push({ t_ms: t, midi, confidence, rms: 0.1 });
    }
    meant.push({ pitch: note.pitch, onMs, offMs: t });
    previous = centre;
    sinceNote = 0;
    if (note.gapMs) silence(note.gapMs);
  });
  return { frames, meant };
}

export interface Score {
  matched: number;
  detected: number;
  meant: number;
  precision: number;
  recall: number;
}

/** Note-level precision and recall: a found note is right when its pitch is exactly the meant pitch and it starts within the tolerance. One meant note matches at most one found note. */
export function score(found: ReadonlyArray<{ pitch: number; onset_sec: number }>, meant: readonly MeantNote[], toleranceMs = 120): Score {
  const used = new Set<number>();
  let matched = 0;
  for (const f of found) {
    let best = -1;
    let bestDistance = Infinity;
    meant.forEach((m, i) => {
      const d = Math.abs(m.onMs - f.onset_sec * 1000);
      if (!used.has(i) && m.pitch === f.pitch && d <= toleranceMs && d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched++;
    }
  }
  return { matched, detected: found.length, meant: meant.length, precision: found.length ? matched / found.length : 1, recall: meant.length ? matched / meant.length : 1 };
}

/** Like score, but the whole found melody may be moved by a few semitones first (a hum has no fixed reference pitch, only its intervals matter). The best shift wins. */
export function scoreAllowingShift(found: ReadonlyArray<{ pitch: number; onset_sec: number }>, meant: readonly MeantNote[], toleranceMs = 120, maxShift = 2): Score {
  let best = score(found, meant, toleranceMs);
  for (let k = -maxShift; k <= maxShift; k++) {
    if (k === 0) continue;
    const s = score(
      found.map((f) => ({ ...f, pitch: f.pitch + k })),
      meant,
      toleranceMs,
    );
    if (s.matched > best.matched) best = s;
  }
  return best;
}

/** A made-up tune that stays in a key: a walk up and down the scale with a few leaps and a few repeated notes. */
export function randomMelody(seed: number, opts: { notes?: number; tonic?: number; minor?: boolean } = {}): MelodyNote[] {
  const r = rng(seed * 7919 + 13);
  const scale = opts.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const tonic = opts.tonic ?? 60;
  const pitchOf = (degree: number) => tonic + scale[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7);
  let degree = r.int(0, 4);
  const out: MelodyNote[] = [];
  const total = opts.notes ?? 10;
  let lastPitch = -1;
  for (let i = 0; i < total; i++) {
    const step = r.pick([-2, -1, -1, 0, 1, 1, 2, 3, -3]);
    degree = Math.max(-3, Math.min(8, degree + step));
    const pitch = pitchOf(degree);
    const ms = r.pick([180, 240, 300, 360, 480]);
    // a repeated note needs a real gap before it, otherwise nobody can tell it from one long note
    if (pitch === lastPitch) out[out.length - 1].gapMs = r.pick([80, 100, 120]);
    out.push({ pitch, ms, gapMs: i === total - 1 ? 0 : r.pick([0, 0, 40, 80, 120]) });
    lastPitch = pitch;
  }
  return out;
}
