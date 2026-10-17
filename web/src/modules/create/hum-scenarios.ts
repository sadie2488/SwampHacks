// The made-up hums used to measure how well segmentNotes finds the right notes. Only tests use this file.
// Each scenario is a kind of singer or a kind of problem; a seed gives one hum, and the same seed always gives the same hum.
import { randomMelody, rng, score, scoreAllowingShift, sing, type MelodyNote, type MeantNote, type Singer } from './synthetic-hum';
import type { PitchFrame } from '@/bus';
import type { Note } from '@/contracts';

export interface Scenario {
  name: string;
  /** How far apart (ms) a found onset and a meant onset may be and still match. */
  toleranceMs?: number;
  hum(seed: number): { frames: PitchFrame[]; meant: MeantNote[] };
}

/** "Twinkle, Twinkle" in a random key: lots of repeated notes with a short break between them. */
function twinkle(seed: number): MelodyNote[] {
  const tonic = 55 + rng(seed * 31 + 5).int(0, 11);
  const steps = [0, 0, 7, 7, 9, 9, 7, 5, 5, 4, 4, 2, 2, 0];
  return steps.map((step, i) => ({ pitch: tonic + step, ms: i === 6 || i === 13 ? 600 : 300, gapMs: steps[i + 1] === step ? 80 : 0 }));
}

const tune = (singer: Singer | ((seed: number) => Singer), notes = 10, toleranceMs?: number, melody?: (seed: number) => MelodyNote[]): Scenario['hum'] => (seed) =>
  sing((melody ?? ((s) => randomMelody(s, { notes })))(seed), typeof singer === 'function' ? singer(seed) : singer, seed);

export const SCENARIOS: Scenario[] = [
  { name: 'clean hum', hum: tune({ jitterCents: 8 }) },
  { name: 'vibrato +-50 cents', hum: tune({ jitterCents: 10, vibratoCents: 50, noteSigmaCents: 10 }) },
  { name: 'slides into notes (up to 150 ms)', hum: tune({ jitterCents: 10, scoopMs: -150, noteSigmaCents: 10 }) },
  { name: 'long slides (up to half a note)', toleranceMs: 260, hum: tune({ jitterCents: 10, scoopMs: 400, noteSigmaCents: 10 }) },
  { name: 'octave errors', hum: tune({ jitterCents: 10, octaveErrorsPerNote: 0.6, noteSigmaCents: 10 }) },
  { name: 'flat singer (-30 cents)', hum: tune({ jitterCents: 10, offsetCents: -30, noteSigmaCents: 15 }) },
  { name: 'flat singer (-40 cents)', hum: tune({ jitterCents: 10, offsetCents: -40, noteSigmaCents: 10 }) },
  { name: 'sharp singer (+35 cents)', hum: tune({ jitterCents: 10, offsetCents: 35, noteSigmaCents: 12 }) },
  { name: 'drifts sharp (+10 to +50 cents)', hum: tune({ jitterCents: 10, offsetCents: 10, driftCents: 40, noteSigmaCents: 12 }) },
  { name: 'dropouts (6% of frames)', hum: tune({ jitterCents: 10, dropoutChance: 0.06, noteSigmaCents: 10 }) },
  { name: 'repeated notes (Twinkle)', hum: tune({ jitterCents: 10, noteSigmaCents: 10, vibratoCents: 25 }, 14, undefined, twinkle) },
  {
    name: 'untrained mix of all of it',
    hum: tune((seed) => {
      const r = rng(seed + 1000);
      return { jitterCents: 12, offsetCents: 11 + r.normal() * 18, driftCents: r.normal() * 15, noteSigmaCents: 22, vibratoCents: 35, scoopMs: -120, octaveErrorsPerNote: 0.15, dropoutChance: 0.03 };
    }),
  },
];

export interface Measured {
  precision: number;
  recall: number;
  /** Same, when the whole tune may be a semitone or two off (only the tune counts). */
  precisionShifted: number;
  recallShifted: number;
}

/** Note-level precision and recall of a finder over many hums of one scenario. */
export function measure(scenario: Scenario, find: (frames: PitchFrame[]) => Array<Pick<Note, 'pitch' | 'onset_sec'>>, seeds = 60): Measured {
  let matched = 0;
  let matchedShifted = 0;
  let found = 0;
  let meantCount = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const { frames, meant } = scenario.hum(seed);
    const notes = find(frames);
    const exact = score(notes, meant, scenario.toleranceMs);
    matched += exact.matched;
    matchedShifted += scoreAllowingShift(notes, meant, scenario.toleranceMs).matched;
    found += notes.length;
    meantCount += meant.length;
  }
  return { precision: matched / found, recall: matched / meantCount, precisionShifted: matchedShifted / found, recallShifted: matchedShifted / meantCount };
}
