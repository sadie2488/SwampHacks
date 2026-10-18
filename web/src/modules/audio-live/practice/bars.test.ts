import { describe, expect, it } from 'vitest';
import type { Note, SongAnalysis } from '@/contracts';
import { notesToMusicXml } from '@/modules/sheet';
import { barEndSec, barOf, barStartSec, barsText } from './bars';
import { song } from './test-kit';

const note = (onsetSec: number, onsetBeat: number, beats = 1): Note => ({ pitch: 60, onset_sec: onsetSec, duration_sec: 0.3, onset_beat: onsetBeat, duration_beat: beats });
const upload = (notes: Note[], extra: Partial<SongAnalysis>): SongAnalysis => ({
  ...song, tempo_bpm: 120, time_signature: { numerator: 4, denominator: 4 }, parts: [{ id: 'melody', name: 'Melody', kind: 'melody', notes }], ...extra,
});
/** The sheet bar each note is drawn in (notes counted per <measure>). */
const sheetBars = (a: SongAnalysis): number[] =>
  notesToMusicXml(a, 'melody').split('<measure ').slice(1).flatMap((m, i) => Array(m.split('<pitch>').length - 1).fill(i + 1));
const feedbackBars = (a: SongAnalysis): number[] => a.parts[0].notes.map((n) => barOf(a, n.onset_sec));

describe('bars (numbered like the sheet music)', () => {
  it('the demo song (first downbeat at 0 s) is unchanged', () => {
    expect([0, 1.2, 2.39, 2.4, 4.8, 28.7].map((t) => barOf(song, t))).toEqual([1, 1, 1, 2, 3, 12]);
    expect(feedbackBars(song)).toEqual(sheetBars({ ...song, parts: [{ ...song.parts[0], id: 'melody' }] }));
    expect([barStartSec(song, 5), barEndSec(song, 5)]).toEqual([9.6, 12]);
    const noDownbeats = { ...song, downbeats: undefined };
    expect([0, 2.4, 4.8].map((t) => barOf(noDownbeats, t))).toEqual([1, 2, 3]);
  });

  it('first downbeat on beat 2: follows the sheet, not the downbeats', () => {
    // beats every 0.5 s from 1.0 s; the beat tracker put the first downbeat on the second beat
    const a = upload([0, 1, 2, 3, 4, 5, 6, 7, 8].map((b) => note(1 + b * 0.5, b)), { beats: [1, 1.5, 2, 2.5, 3, 3.5], downbeats: [1.5, 3.5] });
    expect(feedbackBars(a)).toEqual(sheetBars(a));
    expect(feedbackBars(a)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3]);
    expect([barStartSec(a, 2), barEndSec(a, 2)]).toEqual([3, 5]);
    expect(barOf(a, 2.9)).toBe(1); // a played note just before bar 2
  });

  it('a pickup note before the first beat is in bar 1, and bar 2 starts where the sheet says', () => {
    // a note half a second before the first beat: the server counted beat 0 from it
    const a = upload([note(0.5, 0), ...[0, 1, 2, 3, 4].map((b) => note(1 + b * 0.5, b + 1))], { beats: [1, 1.5, 2, 2.5, 3], downbeats: [1, 3] });
    expect(feedbackBars(a)).toEqual(sheetBars(a));
    expect(feedbackBars(a)).toEqual([1, 1, 1, 1, 2, 2]);
    expect(barStartSec(a, 2)).toBeCloseTo(2.5);
  });

  it('a note whose measured start is a little early is in the bar the sheet draws it in', () => {
    // played 30 ms before bar 2, but its beat (4) puts it at the start of bar 2 on the sheet
    const a = upload([note(0, 0, 4), note(1.97, 4)], { beats: [0, 0.5, 1, 1.5, 2] });
    expect(feedbackBars(a)).toEqual(sheetBars(a));
    expect(feedbackBars(a)).toEqual([1, 2]);
  });

  it('3/4: three beats a bar', () => {
    const a = upload([0, 1, 2, 3, 4, 5, 6].map((b) => note(b * 0.5, b)), { time_signature: { numerator: 3, denominator: 4 }, beats: [0, 0.5, 1] });
    expect(feedbackBars(a)).toEqual([1, 1, 1, 2, 2, 2, 3]);
    expect(barStartSec(a, 3)).toBeCloseTo(3);
  });

  it('6/8: two dotted-quarter beats a bar (six eighths)', () => {
    // 60 BPM counts dotted quarters: an eighth lasts 1/3 s, a bar 2 s; note beats are quarter notes
    const a = upload(Array.from({ length: 12 }, (_, i) => note(i / 3, i * 0.5, 0.5)), { tempo_bpm: 60, time_signature: { numerator: 6, denominator: 8 }, beats: [0, 1, 2, 3] });
    expect(feedbackBars(a)).toEqual(sheetBars(a));
    expect(feedbackBars(a)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
    expect([barOf(a, 1.9), barOf(a, 2.1), barStartSec(a, 2)]).toEqual([1, 2, 2]);
  });

  it('says bars in words', () => {
    expect(barsText([5, 5])).toBe('bar 5');
    expect(barsText([3, 4])).toBe('bars 3-4');
  });
});
