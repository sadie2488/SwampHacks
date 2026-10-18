// Scripted players against the demo song: does the comparison find what was done, and does the coaching say it kindly?
import slowFixture from '@fixtures/performance-event/twinkle-played-slow.json';
import { describe, expect, it } from 'vitest';
import type { Feedback, PerformanceEvent } from '@/contracts';
import { compareNotes, timingClass, type CompareOptions, type PlayedNote } from './compare';
import { buildFeedback } from './feedback';
import { floatPitch } from './run';
import { scriptPlayed, type ScriptOptions } from './script';
import { expectedTwinkle, feedbackProblems, song } from './test-kit';

const NOW = new Date('2026-10-17T10:00:00Z');

/** Play a scripted player against the demo song and get the coaching for it. */
function scenario(script: ScriptOptions, compare: Partial<CompareOptions> = {}, calibrated = true) {
  const played = scriptPlayed(expectedTwinkle, script);
  const result = compareNotes(expectedTwinkle, played, { rate: script.rate ?? 1, latencyMs: script.latencyMs ?? 0, startSec: script.startSec, endSec: script.endSec, pitchShift: script.pitchShift, ...compare });
  const fb = buildFeedback({ analysis: song, result, calibrated, sessionId: 's1', now: NOW });
  return { played, result, fb };
}

/** Everything every Feedback must satisfy, whatever happened. */
function expectValid(fb: Feedback, totalBars = 12) {
  expect(feedbackProblems(fb)).toEqual([]);
  expect(fb.version).toBe(1);
  expect(fb.source).toBe('rules');
  expect(fb.pending).toBe(true);
  expect(fb.song_id).toBe(song.song_id);
  expect(fb.summary.length).toBeGreaterThan(10);
  expect((fb.issues ?? []).length).toBeLessThanOrEqual(3);
  expect((fb.strengths ?? []).length).toBeLessThanOrEqual(2);
  for (const issue of fb.issues ?? []) {
    expect(issue.message.length).toBeGreaterThan(10);
    expect(issue.severity).toBeDefined();
    if (issue.bars) {
      expect(issue.bars[0]).toBeGreaterThanOrEqual(1);
      expect(issue.bars[0]).toBeLessThanOrEqual(issue.bars[1]);
      expect(issue.bars[1]).toBeLessThanOrEqual(totalBars);
    }
    if (issue.start_sec !== undefined && issue.end_sec !== undefined) expect(issue.start_sec).toBeLessThanOrEqual(issue.end_sec);
  }
  expect(fb.next_step?.length).toBeGreaterThan(10);
  // plain words: no raw numbers beyond a percentage, no jargon
  expect(fb.summary).not.toMatch(/\bms\b|cents|\bBPM\b/i);
}

describe('timing grades (music-notes section 7)', () => {
  it('50 ms is on time, 50-100 a bit, beyond that off', () => {
    expect(timingClass(0)).toBe('on time');
    expect(timingClass(-50)).toBe('on time');
    expect(timingClass(75)).toBe('a bit late');
    expect(timingClass(-75)).toBe('a bit early');
    expect(timingClass(160)).toBe('late');
    expect(timingClass(-160)).toBe('early');
  });
});

describe('perfect playing', () => {
  const { result, fb } = scenario({ latencyMs: 120, jitterMs: 25 });

  it('matches every note with small errors', () => {
    expect(result.notes).toHaveLength(42);
    expect(result.matched).toHaveLength(42);
    expect(result.missed).toHaveLength(0);
    expect(result.extras).toHaveLength(0);
    for (const m of result.matched) expect(Math.abs(m.timingErrorMs!)).toBeLessThanOrEqual(26);
    expect(result.line!.slope).toBeCloseTo(1, 2);
  });

  it('says steady, with no problems, and starts with something good', () => {
    expectValid(fb);
    expect(fb.tempo).toMatchObject({ target_bpm: 100, verdict: 'steady' });
    expect(fb.tempo!.played_bpm).toBeCloseTo(100, 0);
    expect(fb.tempo!.ratio).toBeCloseTo(1, 2);
    expect(fb.issues).toEqual([]);
    expect(fb.strengths![0]).toBe('You kept a steady tempo');
    expect(fb.summary).toMatch(/^Nice playing/);
  });
});

describe('the slow fixture (10 percent slow, 120 ms of lag)', () => {
  const played: PlayedNote[] = (slowFixture as PerformanceEvent[]).map((e) => ({ timeSec: e.time_sec, pitch: floatPitch(e), durationSec: e.duration_sec }));
  const result = compareNotes(expectedTwinkle, played, { rate: 1, latencyMs: 120, endSec: 5.4 });
  const fb = buildFeedback({ analysis: song, result, calibrated: true, now: NOW });

  it('lines all eight notes up even though the player drifts 0.5 s by the end', () => {
    expect(result.notes).toHaveLength(8);
    expect(result.matched).toHaveLength(8);
    expect(result.extras).toHaveLength(0);
    expect(result.notes[0].timingErrorMs).toBeCloseTo(0, 0);
    expect(result.notes[7].timingErrorMs).toBeGreaterThan(500);
    expect(result.line!.slope).toBeCloseTo(1.111, 2);
  });

  it('says dragging, ratio about 0.9, 90 beats per minute out of 100', () => {
    expectValid(fb);
    expect(fb.tempo!.verdict).toBe('dragging');
    expect(fb.tempo!.ratio).toBeGreaterThan(0.89);
    expect(fb.tempo!.ratio).toBeLessThan(0.91);
    expect(fb.tempo!.target_bpm).toBe(100);
    expect(fb.tempo!.played_bpm).toBeGreaterThan(89);
    expect(fb.tempo!.played_bpm).toBeLessThan(91);
  });

  it('puts the tempo first and flags the sharp 4th note as a pitch problem', () => {
    expect(fb.issues!.map((i) => i.kind)).toEqual(['tempo', 'pitch']);
    expect(fb.issues![0].message).toMatch(/dragged/);
    expect(fb.issues![0].severity).toBe('medium');
    expect(fb.issues![0].bars).toEqual([1, 2]);
    const pitch = fb.issues![1];
    expect(pitch.severity).toBe('low');
    expect(pitch.message).toMatch(/G was slightly sharp/);
    expect(pitch.bars).toEqual([1, 1]);
    expect(pitch.start_sec).toBe(1.8);
    expect(result.notes[3].pitchErrorCents).toBeCloseTo(30, 0);
  });

  it('is kind: leads with what went well, one next step, even rhythm noticed', () => {
    expect(fb.strengths).toEqual(['Your rhythm was even from note to note', 'You played every note, with no extras']);
    expect(fb.summary).toMatch(/about 10% slower than the song, but your rhythm was even/);
    expect(fb.next_step).toBe('Loop bars 1-2 at 80% speed, then bring it back up.');
  });
});

describe('rushing', () => {
  const { fb, result } = scenario({ latencyMs: 80, pace: 1.12 });
  it('says rushing with a ratio above 1', () => {
    expectValid(fb);
    expect(result.matched).toHaveLength(42);
    expect(fb.tempo!.verdict).toBe('rushing');
    expect(fb.tempo!.ratio).toBeCloseTo(1.12, 2);
    expect(fb.tempo!.played_bpm).toBeCloseTo(112, 0);
    expect(fb.issues![0]).toMatchObject({ kind: 'tempo', severity: 'medium' });
    expect(fb.issues![0].message).toMatch(/rushed through bars 1-12/);
    expect(fb.next_step).toBe('Loop bars 1-2 at 90% speed, then bring it back up.'); // a whole piece is too long to loop: start with the first two bars
  });
});

describe('the slowed song is named in the words', () => {
  it('says "at this speed" when the song was not at full tempo', () => {
    const { fb } = scenario({ rate: 0.8, pace: 1.25 });
    expect(fb.summary).toMatch(/about 25% faster than the song at this speed/);
    expect(fb.issues![0].message).toMatch(/at this speed/);
    expect(scenario({ pace: 1.25 }).fb.summary).not.toMatch(/at this speed/);
  });
  it('suggests a practice speed a notch under what the player managed', () => {
    expect(scenario({ pace: 0.9 }).fb.next_step).toBe('Loop bars 1-2 at 80% speed, then bring it back up.');
    expect(scenario({ rate: 0.8, pace: 0.9 }).fb.next_step).toMatch(/at 60% speed/);
    expect(scenario({ rate: 0.6, pace: 0.5 }).fb.next_step).toMatch(/at 50% speed/);
  });
});

describe('a steady player a little under the band is still steady', () => {
  it('4 percent slow is steady, 8 percent is dragging', () => {
    expect(scenario({ pace: 0.96 }).fb.tempo!.verdict).toBe('steady');
    expect(scenario({ pace: 0.92 }).fb.tempo!.verdict).toBe('dragging');
    expect(scenario({ pace: 1.04 }).fb.tempo!.verdict).toBe('steady');
  });
});

describe('only part of the song gets slow', () => {
  // in time up to bar 4, drifts half a second behind during bars 5-6, then slowly catches up again over bars 7-10
  const bump = (songSec: number) => (songSec < 9.6 ? 0 : songSec < 14.4 ? ((songSec - 9.6) / 4.8) * 0.5 : songSec < 24 ? 0.5 - ((songSec - 14.4) / 9.6) * 0.5 : 0);
  const played = scriptPlayed(expectedTwinkle, {}).map((p, k) => ({ ...p, timeSec: p.timeSec + bump(expectedTwinkle[k].onsetSec) }));
  const result = compareNotes(expectedTwinkle, played, { rate: 1 });
  const fb = buildFeedback({ analysis: song, result, calibrated: true, now: NOW });

  it('still pairs every note, even though the player is 0.5 s from a straight line', () => {
    expect(result.matched).toHaveLength(42);
    expect(result.extras).toHaveLength(0);
  });
  it('is steady overall but names the bars where the tempo dragged', () => {
    expectValid(fb);
    expect(fb.tempo!.verdict).toBe('steady');
    expect(fb.issues![0]).toMatchObject({ kind: 'tempo', bars: [5, 6] });
    expect(fb.issues![0].message).toMatch(/dragged in bars 5-6/);
    expect(fb.next_step).toMatch(/bars 5-6/);
    expect(fb.summary).toMatch(/^You kept a steady tempo overall\./);
    expect(fb.strengths![0]).toBe('You kept a steady tempo overall');
  });
  it('does not call a smooth change a wobble', () => {
    expect(fb.issues!.some((i) => i.kind === 'rhythm')).toBe(false);
  });
});

describe('one missed note', () => {
  const { result, fb } = scenario({ latencyMs: 100, skip: [5] }, { latencyMs: 100 });
  it('finds the skipped note and nothing else', () => {
    expect(result.missed.map((m) => m.index)).toEqual([5]);
    expect(result.matched).toHaveLength(41);
    expect(result.extras).toHaveLength(0);
    expectValid(fb);
    expect(fb.tempo!.verdict).toBe('steady');
    expect(fb.issues).toHaveLength(1);
    expect(fb.issues![0]).toMatchObject({ kind: 'missed', bars: [2, 2], severity: 'low' });
    expect(fb.issues![0].message).toMatch(/skipped a note in bar 2/);
    expect(fb.next_step).toMatch(/^Loop bar 2 at/);
    expect(fb.strengths![0]).toBe('You kept a steady tempo');
  });
});

describe('extra notes', () => {
  const { result, fb } = scenario({ extras: [{ songSec: 0.9, pitch: 62 }, { songSec: 6.3 }, { songSec: 13.5, pitch: 71 }] });
  it('counts them without upsetting the matching', () => {
    expect(result.matched).toHaveLength(42);
    expect(result.missed).toHaveLength(0);
    expect(result.extras).toHaveLength(3);
    expectValid(fb);
    expect(fb.tempo!.verdict).toBe('steady');
    const extra = fb.issues!.find((i) => i.kind === 'extra')!;
    expect(extra.message).toMatch(/3 extra notes/);
    expect(extra.bars).toEqual([1, 6]);
    expect(extra.severity).toBe('medium');
  });
  it('keeps a wrong-pitched sound from stealing a note that was played right nearby', () => {
    const played = scriptPlayed(expectedTwinkle, { extras: [{ songSec: 1.22, pitch: 62 }] });
    const r = compareNotes(expectedTwinkle, played, { rate: 1 });
    expect(r.extras).toHaveLength(1);
    expect(r.extras[0].pitch).toBe(62);
    expect(r.notes[2].played!.pitch).toBe(67);
  });
});

describe('slowed playback (tempo factor 0.8)', () => {
  it('a player in time with the slowed song is steady, at 80 beats per minute', () => {
    const { result, fb } = scenario({ rate: 0.8, latencyMs: 120 });
    expect(result.windowMs).toBeCloseTo(312.5, 1);
    expect(result.matched).toHaveLength(42);
    expect(result.notes[10].expectedSec).toBeCloseTo(song.parts[0].notes[10].onset_sec / 0.8, 6);
    expectValid(fb);
    expect(fb.tempo).toMatchObject({ target_bpm: 80, verdict: 'steady' });
    expect(fb.tempo!.played_bpm).toBeCloseTo(80, 0);
    expect(fb.issues).toEqual([]);
  });
  it('a player who keeps the original speed against the slowed song is rushing', () => {
    const { fb } = scenario({ rate: 0.8, pace: 1.25 });
    expect(fb.tempo!.verdict).toBe('rushing');
    expect(fb.tempo!.ratio).toBeCloseTo(1.25, 2);
    expect(fb.tempo!.target_bpm).toBe(80);
    expect(fb.tempo!.played_bpm).toBeCloseTo(100, 0);
    expect(fb.issues![0].severity).toBe('high');
  });
  it('a slowed song that starts part way in measures time from where the run began', () => {
    const { result, fb } = scenario({ rate: 0.8, startSec: 4.8, endSec: 9.6, latencyMs: 60 });
    expect(result.notes.map((n) => n.index)).toEqual([0, 1, 2, 3, 4, 5, 6]); // notes 7 to 13 of the song: 4.8 s up to 9.6 s
    expect(result.notes[0].expectedSec).toBe(0);
    expect(result.notes[1].expectedSec).toBeCloseTo(0.6 / 0.8, 6);
    expect(result.matched).toHaveLength(7);
    expect(fb.tempo!.verdict).toBe('steady');
    expect(fb.issues).toEqual([]);
  });
});

describe('pitch', () => {
  it('ignores small errors, mentions slightly sharp past 25 cents and a bit flat past 40', () => {
    const fine = scenario({ detune: { 3: 20, 4: -24 } });
    expect(fine.fb.issues).toEqual([]);
    const slight = scenario({ detune: { 3: 30 } });
    expect(slight.fb.issues![0].message).toMatch(/slightly sharp/);
    const flat = scenario({ detune: { 8: -45 } });
    expect(flat.fb.issues![0]).toMatchObject({ kind: 'pitch', severity: 'medium' });
    expect(flat.fb.issues![0].message).toMatch(/In bar 3 the F was a bit flat: aim a touch higher/);
  });
  it('treats a semitone off as a wrong note', () => {
    const { fb } = scenario({ detune: { 4: 100 } });
    expectValid(fb);
    expect(fb.issues![0].message).toMatch(/In bar 2 you played A# instead of A/);
  });
  it('does not mind a person humming an octave lower', () => {
    const played = scriptPlayed(expectedTwinkle, {}).map((p) => ({ ...p, pitch: p.pitch! - 12 }));
    const result = compareNotes(expectedTwinkle, played, { rate: 1 });
    const fb = buildFeedback({ analysis: song, result, calibrated: true, now: NOW });
    expect(fb.issues).toEqual([]);
    expect(result.matched.every((m) => Math.abs(m.pitchErrorCents!) < 1e-6)).toBe(true);
  });
  it('follows a pitch shift of the song', () => {
    const { fb } = scenario({ pitchShift: 2 }, { pitchShift: 2 });
    expect(fb.issues).toEqual([]);
    const unaware = scenario({ pitchShift: 2 }, { pitchShift: 0 });
    expect(unaware.fb.issues!.some((i) => i.kind === 'pitch')).toBe(true);
  });
  it('groups many sharp notes into one issue', () => {
    const detune: Record<number, number> = {};
    for (let k = 0; k < 12; k++) detune[k] = 35;
    const { fb } = scenario({ detune });
    const pitch = fb.issues!.filter((i) => i.kind === 'pitch');
    expect(pitch).toHaveLength(1);
    expect(pitch[0].message).toMatch(/12 notes were slightly sharp, in bars 1-4/);
  });
});

describe('rhythm', () => {
  it('names a section where the timing wobbles', () => {
    const base = scriptPlayed(expectedTwinkle, {});
    const wobbly = base.map((p, k) => (k >= 8 && k < 16 ? { ...p, timeSec: p.timeSec + (k % 2 ? 0.15 : -0.15) } : p));
    const fb = buildFeedback({ analysis: song, result: compareNotes(expectedTwinkle, wobbly, { rate: 1 }), calibrated: true, now: NOW });
    expectValid(fb);
    const r = fb.issues!.find((i) => i.kind === 'rhythm')!;
    expect(r.bars![0]).toBeGreaterThanOrEqual(3);
    expect(r.bars![1]).toBeLessThanOrEqual(5);
    expect(r.message).toMatch(/timing wobbled in bars/);
    expect(fb.strengths).not.toContain('Your rhythm was even from note to note');
  });
  it('tells a steady player who is always a little late, but only after the clap check', () => {
    const late = scenario({ shiftMs: 70 });
    expect(late.fb.tempo!.verdict).toBe('steady');
    expect(late.fb.issues![0]).toMatchObject({ kind: 'rhythm', severity: 'low' });
    expect(late.fb.issues![0].message).toMatch(/a bit late on most notes/);
    const early = scenario({ shiftMs: -140 });
    expect(early.fb.issues![0]).toMatchObject({ kind: 'rhythm', severity: 'medium' });
    expect(early.fb.issues![0].message).toMatch(/came in early/);
    const unchecked = scenario({ shiftMs: 70 }, {}, false);
    expect(unchecked.fb.issues).toEqual([]);
  });
});

describe('very little to go on', () => {
  it('says so when nothing was heard', () => {
    const result = compareNotes(expectedTwinkle, [], { rate: 1 });
    const fb = buildFeedback({ analysis: song, result, calibrated: true, now: NOW });
    expectValid(fb);
    expect(fb.tempo).toBeUndefined();
    expect(fb.summary).toMatch(/didn't hear any notes/);
  });
  it('does not judge tempo from two notes', () => {
    const played = scriptPlayed(expectedTwinkle, { endSec: 1.0 });
    const result = compareNotes(expectedTwinkle, played, { rate: 1 });
    const fb = buildFeedback({ analysis: song, result, calibrated: true, now: NOW });
    expectValid(fb);
    expect(result.matched).toHaveLength(2);
    expect(fb.tempo).toBeUndefined();
    expect(fb.summary).toMatch(/too few to judge your tempo/);
  });
  it('counts the notes after the last one played as missed only when told where the run ended', () => {
    const played = scriptPlayed(expectedTwinkle, { endSec: 4.8 });
    expect(compareNotes(expectedTwinkle, played, { rate: 1 }).missed).toHaveLength(0);
    expect(compareNotes(expectedTwinkle, played, { rate: 1, endSec: 28.8 }).missed).toHaveLength(42 - 7);
  });
  it('a long stop is a big problem', () => {
    const played = scriptPlayed(expectedTwinkle, { endSec: 9.6 });
    const fb = buildFeedback({ analysis: song, result: compareNotes(expectedTwinkle, played, { rate: 1, endSec: 28.8 }), calibrated: true, now: NOW });
    expectValid(fb);
    expect(fb.issues![0]).toMatchObject({ kind: 'missed', severity: 'high' });
  });
});

describe('every feedback follows the contract', () => {
  const runs: Array<[string, ScriptOptions]> = [
    ['perfect', {}],
    ['slow', { pace: 0.85, latencyMs: 90 }],
    ['fast', { pace: 1.2 }],
    ['missed', { skip: [1, 2, 3, 20] }],
    ['extras', { extras: [{ songSec: 3.3 }, { songSec: 3.4 }] }],
    ['everything', { pace: 0.9, skip: [4], extras: [{ songSec: 5 }], detune: { 2: 60, 7: -50 }, jitterMs: 40 }],
    ['slowed song', { rate: 0.6, latencyMs: 30 }],
  ];
  for (const [name, script] of runs) {
    it(name, () => {
      const { fb } = scenario(script, { latencyMs: script.latencyMs ?? 0 });
      expectValid(fb);
      if (fb.tempo) {
        expect(fb.tempo.target_bpm).toBeCloseTo(100 * (script.rate ?? 1), 1);
        expect(['rushing', 'dragging', 'steady']).toContain(fb.tempo.verdict);
      }
    });
  }
});
