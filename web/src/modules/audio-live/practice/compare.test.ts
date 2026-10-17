// The comparison on its own: signs, windows, pitch, lining up with drifting players, and the helpers it uses.
import { describe, expect, it } from 'vitest';
import type { PerformanceEvent } from '@/contracts';
import { compareNotes, type ExpectedNote, type PlayedNote } from './compare';
import { foldedCents, median, medianAbsDeviation, noteLetter, robustLine } from './math';
import { RunRecorder } from './run';
import { scriptPlayed } from './script';
import { expectedTwinkle } from './test-kit';

/** Notes every half second on one pitch. */
const steadyNotes = (n: number, gap = 0.5, pitch = 60): ExpectedNote[] => Array.from({ length: n }, (_, k) => ({ pitch, onsetSec: k * gap, durationSec: gap * 0.9 }));
const at = (...times: number[]): PlayedNote[] => times.map((timeSec) => ({ timeSec, pitch: 60 }));

describe('timing errors', () => {
  it('are negative when the player is early and positive when late, after taking off the latency', () => {
    // each note is played with 120 ms of lag, so 0.12 s is what "exactly in time" looks like
    const r = compareNotes(steadyNotes(4), at(0.12 + 0.2, 0.5 + 0.12 + 0.03, 1.0 + 0.12 - 0.04, 1.5 + 0.12 - 0.05), { rate: 1, latencyMs: 120 });
    expect(r.matched).toHaveLength(4);
    expect(r.notes.map((n) => Math.round(n.timingErrorMs!))).toEqual([200, 30, -40, -50]);
  });
  it('a note played 60 ms early reads -60', () => {
    const r = compareNotes(steadyNotes(4), at(-0.06, 0.5, 1.0, 1.5), { rate: 1 });
    expect(r.notes[0].timingErrorMs).toBeCloseTo(-60, 6);
  });
});

describe('the matching window', () => {
  it('is 250 ms at full speed and wider when the song is slowed down', () => {
    expect(compareNotes(steadyNotes(8, 1), [], { rate: 1 }).windowMs).toBe(250);
    expect(compareNotes(steadyNotes(8, 1), [], { rate: 0.5 }).windowMs).toBe(500);
    expect(compareNotes(steadyNotes(8, 1), [], { rate: 0.8 }).windowMs).toBeCloseTo(312.5, 6);
  });
  it('is never wider than 0.6 of the gap between notes, so fast songs do not match the wrong note', () => {
    expect(compareNotes(steadyNotes(8, 0.3), [], { rate: 1 }).windowMs).toBeCloseTo(180, 6);
  });
  it('can be set by hand', () => {
    expect(compareNotes(steadyNotes(8, 1), [], { rate: 1, windowMs: 100 }).windowMs).toBe(100);
  });
  it('does not pair a sound that is further than the window from where the player was heading', () => {
    // in time, then one note 400 ms late (more than 250): it is not a match; it counts as a missed note and an extra one
    const r = compareNotes(steadyNotes(8, 1), at(0, 1, 2, 3, 4.4, 5, 6, 7), { rate: 1 });
    expect(r.notes.map((n) => !!n.played)).toEqual([true, true, true, true, false, true, true, true]);
    expect(r.extras).toHaveLength(1);
  });
});

describe('expected times are scaled, never the player', () => {
  it('at half speed the song notes are due twice as late', () => {
    const r = compareNotes(steadyNotes(4), at(0, 1, 2, 3), { rate: 0.5 });
    expect(r.notes.map((n) => n.expectedSec)).toEqual([0, 1, 2, 3]);
    expect(r.notes.map((n) => Math.round(n.timingErrorMs!))).toEqual([0, 0, 0, 0]);
    expect(r.line!.slope).toBeCloseTo(1, 6);
  });
  it('counts from where the run began', () => {
    const r = compareNotes(steadyNotes(10), at(0, 0.5, 1.0), { rate: 1, startSec: 2 });
    expect(r.notes[0].note.onsetSec).toBe(2);
    expect(r.notes[0].expectedSec).toBe(0);
    expect(r.matched).toHaveLength(3);
  });
  it('leaves out notes after the end of the run only when told where it ended', () => {
    expect(compareNotes(steadyNotes(10), at(0, 0.5, 1.0, 1.5), { rate: 1, endSec: 2.5 }).notes).toHaveLength(5);
    expect(compareNotes(steadyNotes(10), at(0, 0.5, 1.0, 1.5), { rate: 1 }).notes).toHaveLength(4);
  });
});

describe('pitch', () => {
  it('is the detected pitch minus the expected one, in cents, sharp positive', () => {
    const r = compareNotes(steadyNotes(4), [{ timeSec: 0, pitch: 60.3 }, { timeSec: 0.5, pitch: 59.8 }, { timeSec: 1, pitch: 60 }, { timeSec: 1.5 }], { rate: 1 });
    expect(r.notes.map((n) => n.pitchErrorCents === undefined ? null : Math.round(n.pitchErrorCents))).toEqual([30, -20, 0, null]);
  });
  it('folds octaves: the same note an octave down is in tune', () => {
    expect(foldedCents(48.1, 60)).toBeCloseTo(10, 6);
    expect(foldedCents(72, 60)).toBeCloseTo(0, 6);
    expect(foldedCents(66.5, 60)).toBeCloseTo(-550, 6);
  });
  it('moves with a shift of the song', () => {
    const r = compareNotes(steadyNotes(3), [{ timeSec: 0, pitch: 62 }, { timeSec: 0.5, pitch: 62 }, { timeSec: 1, pitch: 62 }], { rate: 1, pitchShift: 2 });
    expect(r.notes.every((n) => Math.abs(n.pitchErrorCents!) < 1e-6)).toBe(true);
  });
});

describe('players who are not machines', () => {
  const song = expectedTwinkle;
  it('a timing-only player (hand claps, no pitch) is matched and judged on timing', () => {
    const played = scriptPlayed(song, { latencyMs: 80 }).map((p) => ({ timeSec: p.timeSec }));
    const r = compareNotes(song, played, { rate: 1, latencyMs: 80 });
    expect(r.matched).toHaveLength(42);
    expect(r.matched.every((m) => m.pitchErrorCents === undefined)).toBe(true);
  });
  it('slow by 30 percent from the very start is still lined up note by note', () => {
    const r = compareNotes(song, scriptPlayed(song, { pace: 0.7 }), { rate: 1 });
    expect(r.matched).toHaveLength(42);
    expect(r.line!.slope).toBeCloseTo(1 / 0.7, 2);
  });
  it('fast by 40 percent, too', () => {
    const r = compareNotes(song, scriptPlayed(song, { pace: 1.4 }), { rate: 1 });
    expect(r.matched).toHaveLength(42);
    expect(r.line!.slope).toBeCloseTo(1 / 1.4, 2);
  });
  it('a player who starts 200 ms late is lined up', () => {
    const r = compareNotes(song, scriptPlayed(song, { shiftMs: 200 }), { rate: 1 });
    expect(r.matched).toHaveLength(42);
    expect(r.notes[0].timingErrorMs).toBeCloseTo(200, 3);
  });
  it('two notes swapped in time order do not cross over', () => {
    const played = scriptPlayed(song, {});
    const r = compareNotes(song, played, { rate: 1 });
    const times = r.matched.map((m) => m.played!.timeSec);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
  it('a stray sound far from every note is an extra and does not disturb the rest', () => {
    const r = compareNotes(song, scriptPlayed(song, { extras: [{ songSec: 0.3 }] }), { rate: 1 });
    expect(r.extras).toHaveLength(1);
    expect(r.matched).toHaveLength(42);
  });
  it('a long song is matched quickly', () => {
    const long = steadyNotes(600, 0.25);
    const played = long.map((n, k) => ({ timeSec: n.onsetSec * 1.03 + 0.02 * Math.sin(k), pitch: 60 }));
    const t0 = performance.now();
    const r = compareNotes(long, played, { rate: 1 });
    expect(r.matched.length).toBeGreaterThan(590);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
  it('says nothing is matched, and everything missed, when nothing was played', () => {
    const r = compareNotes(song, [], { rate: 1, endSec: 28.8 });
    expect(r.matched).toHaveLength(0);
    expect(r.missed).toHaveLength(42);
    expect(r.line).toBeNull();
  });
});

describe('number helpers', () => {
  it('median and spread', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(medianAbsDeviation([1, 2, 3, 4, 100])).toBe(1);
  });
  it('a robust line ignores wild points', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const ys = xs.map((x) => 0.5 + 2 * x);
    ys[4] = 40;
    ys[8] = -30;
    const line = robustLine(xs, ys)!;
    expect(line.slope).toBeCloseTo(2, 6);
    expect(line.intercept).toBeCloseTo(0.5, 6);
    expect(robustLine([0, 1], [0, 1])).toBeNull();
  });
  it('note letters', () => {
    expect([60, 61, 67, 69, 71, 72, 59.6].map(noteLetter)).toEqual(['C', 'C#', 'G', 'A', 'B', 'C', 'C']);
  });
});

describe('following a run', () => {
  const state = (over: Partial<Parameters<RunRecorder['transport']>[0]> = {}) => ({ loaded: true, playing: true, positionSec: 0, durationSec: 28.8, tempo: 1, pitch: 0, volume: 0.8, loop: false, loopSection: null, ...over });
  const note = (time_sec: number, pitch = 60, cents_off = 0): PerformanceEvent => ({ version: 1, type: 'note', time_sec, pitch, cents_off, duration_sec: 0.4, confidence: 0.9 });
  const onset = (time_sec: number): PerformanceEvent => ({ version: 1, type: 'onset', time_sec });

  it('finds the page time the start position played, from the middle of many updates', () => {
    const rec = new RunRecorder(state({ positionSec: 2 }), 10_000, 28.8);
    // the song clock moves in blocks of 90 ms: the position is read ahead of the real time by up to one block
    for (let k = 1; k <= 40; k++) rec.transport(state({ positionSec: 2 + Math.floor((k * 66) / 90) * 0.09 }), 10_000 + k * 66);
    expect(Math.abs(rec.runStartMs() - 10_000)).toBeLessThan(60);
  });

  it('notes take the time of the attack just before them, and leftover attacks become timing-only sounds', () => {
    const rec = new RunRecorder(state(), 10_000, 28.8);
    rec.transport(state({ positionSec: 1 }), 11_000);
    rec.add(onset(0.5), 9_500, 11_100); // page time 10 000
    rec.add(note(0.56, 60, 20), 9_500, 11_200); // a note that was only recognised 60 ms later (page time 10 060)
    rec.add(onset(1.5), 9_500, 11_300); // an attack with no note
    rec.add({ version: 1, type: 'calibration', time_sec: 0.2, latency_offset_ms: 100 }, 9_500, 11_300);
    rec.stop();
    const s = rec.summary();
    expect(s.played).toHaveLength(2);
    expect(s.played[0].timeSec).toBeCloseTo(0, 6); // the attack, not the later note start
    expect(s.played[0].pitch).toBeCloseTo(60.2, 6);
    expect(s.played[1].pitch).toBeUndefined();
    expect(s.played[1].timeSec).toBeCloseTo(1, 6);
  });

  it('knows why a run ended', () => {
    const run = (next: ReturnType<typeof state>, at = 10_066, first = state()) => {
      const rec = new RunRecorder(first, 10_000, 28.8);
      return { reason: rec.transport(next, at), rec };
    };
    expect(run(state({ playing: false, positionSec: 0.07 })).reason).toBe('paused');
    expect(run(state({ playing: false, positionSec: 0 }), 10_066, state({ positionSec: 28.5 })).reason).toBe('finished');
    expect(run(state({ tempo: 0.9, positionSec: 0.06 })).reason).toBe('changed');
    expect(run(state({ pitch: 2, positionSec: 0.06 })).reason).toBe('changed');
    expect(run(state({ positionSec: 5 })).reason).toBe('jumped');
    expect(run(state({ positionSec: 0.07 })).reason).toBeNull();
  });

  it('works out the part of the song that was due', () => {
    const rec = new RunRecorder(state({ positionSec: 4 }), 0, 28.8);
    rec.transport(state({ positionSec: 5 }), 1000);
    rec.transport(state({ playing: false, positionSec: 5 }), 1100);
    expect(rec.summary()).toMatchObject({ startSec: 4, endSec: 4.6, endReason: 'paused' }); // the last 0.4 s were not due yet
    const done = new RunRecorder(state({ positionSec: 28 }), 0, 28.8);
    done.transport(state({ positionSec: 28.7 }), 700);
    done.transport(state({ playing: false, positionSec: 0 }), 770);
    expect(done.summary()).toMatchObject({ endSec: 28.8, endReason: 'finished' });
  });

  it('sound from just before the song started still counts, earlier does not', () => {
    const rec = new RunRecorder(state(), 10_000, 28.8);
    rec.add(note(0.1 - 0.2), 10_000, 10_000); // 200 ms early
    rec.add(note(0.1 - 0.6), 10_000, 10_000); // 600 ms early
    expect(rec.summary().played).toHaveLength(1);
  });
});
