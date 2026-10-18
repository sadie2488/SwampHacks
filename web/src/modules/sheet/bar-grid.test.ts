import { describe, expect, it } from 'vitest';
import twinkleJson from '@fixtures/song-analysis/twinkle.json';
import type { Note, SongAnalysis } from '@/contracts';
import { barAt, barOfQuarter, barStartAt, beatsPerBar, quartersPerBar, quartersPerBeat, sheetGrid } from './bar-grid';
import { buildScore } from './notes-to-musicxml';

const twinkle = twinkleJson as unknown as SongAnalysis;
const ts = (numerator: number, denominator: number) => ({ numerator, denominator }) as SongAnalysis['time_signature'];
const note = (onsetSec: number, onsetBeat: number, beats = 1, pitch = 60): Note => ({ pitch, onset_sec: onsetSec, duration_sec: 0.3, onset_beat: onsetBeat, duration_beat: beats });
const song = (notes: Note[], extra: Partial<SongAnalysis>): SongAnalysis => ({
  version: 1, song_id: 't', duration_sec: 30, tempo_bpm: 120, key: { tonic: 'C', mode: 'major' }, time_signature: ts(4, 4),
  parts: [{ id: 'p', name: 'P', kind: 'melody', notes }], ...extra,
});

describe('beat lengths', () => {
  it('a beat is a quarter in 4/4 and 3/4, a dotted quarter in 6/8, 9/8 and 12/8', () => {
    expect([ts(4, 4), ts(3, 4), ts(6, 8), ts(9, 8), ts(12, 8), ts(3, 8), ts(2, 2)].map(quartersPerBeat)).toEqual([1, 1, 1.5, 1.5, 1.5, 0.5, 2]);
    expect([ts(4, 4), ts(3, 4), ts(6, 8), ts(12, 8)].map(beatsPerBar)).toEqual([4, 3, 2, 4]);
    expect([ts(4, 4), ts(3, 4), ts(6, 8), ts(12, 8), ts(3, 8)].map(quartersPerBar)).toEqual([4, 3, 3, 6, 1.5]);
  });
  it('bars of quarter notes, rounded to the sixteenth grid like the sheet', () => {
    expect([0, 3.8, 3.9, 4, 8].map((q) => barOfQuarter(ts(4, 4), q))).toEqual([1, 1, 2, 2, 3]);
    expect([0, 2.8, 2.9, 3, 6].map((q) => barOfQuarter(ts(6, 8), q))).toEqual([1, 1, 2, 2, 3]);
    expect(barOfQuarter(ts(4, 4), -1)).toBe(1);
  });
});

describe('bar numbers match the sheet', () => {
  /** The bar each note is drawn in on the sheet: count the notes per <measure>. */
  const sheetBars = (a: SongAnalysis): number[] =>
    buildScore(a, 'p').xml.split('<measure ').slice(1).flatMap((m, i) => Array(m.split('<pitch>').length - 1).fill(i + 1));
  const gridBars = (a: SongAnalysis): number[] => a.parts[0].notes.map((n) => barAt(sheetGrid(a, a.parts[0]), n.onset_sec));

  it('the demo song (first downbeat at 0 s) is unchanged: bar n starts every 2.4 s', () => {
    const g = sheetGrid(twinkle, twinkle.parts[0]);
    expect([0, 1.2, 2.39, 2.4, 4.8, 28.7].map((t) => barAt(g, t))).toEqual([1, 1, 1, 2, 3, 12]);
    expect(barStartAt(g, 5)).toBeCloseTo(9.6);
  });
  it('first downbeat on beat 2 of the sheet: bars still follow the sheet, not the downbeats', () => {
    // beats every 0.5 s from 1.0 s; the server heard the first downbeat on the second beat (1.5 s)
    const a = song([0, 1, 2, 3, 4, 5].map((b) => note(1 + b * 0.5, b)), { beats: [1, 1.5, 2, 2.5, 3, 3.5], downbeats: [1.5, 3.5] });
    expect(gridBars(a)).toEqual(sheetBars(a));
    expect(gridBars(a)).toEqual([1, 1, 1, 1, 2, 2]);
    expect(barStartAt(sheetGrid(a, a.parts[0]), 2)).toBeCloseTo(3);
  });
  it('a pickup note before the first beat moves the sheet start back one beat', () => {
    // a note at 0.5 s, first beat at 1.0 s: the server counted beat 0 from 0.5 s
    const a = song([note(0.5, 0), ...[0, 1, 2, 3, 4].map((b) => note(1 + b * 0.5, b + 1))], { beats: [1, 1.5, 2, 2.5, 3], downbeats: [1, 3] });
    expect(sheetGrid(a, a.parts[0]).startSec).toBeCloseTo(0.5);
    expect(gridBars(a)).toEqual(sheetBars(a));
    expect(gridBars(a)).toEqual([1, 1, 1, 1, 2, 2]);
  });
  it('3/4: three quarters per bar', () => {
    const a = song([0, 1, 2, 3, 4, 5, 6].map((b) => note(b * 0.5, b)), { time_signature: ts(3, 4), beats: [0, 0.5, 1] });
    expect(gridBars(a)).toEqual(sheetBars(a));
    expect(gridBars(a)).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });
  it('6/8: a bar is six eighths (3 quarters), two dotted-quarter beats', () => {
    // 60 BPM counts dotted quarters: an eighth lasts 1/3 s, a bar 2 s
    const eighths = Array.from({ length: 12 }, (_, i) => note(i / 3, i * 0.5, 0.5));
    const a = song(eighths, { tempo_bpm: 60, time_signature: ts(6, 8), beats: [0, 1, 2, 3] });
    expect(gridBars(a)).toEqual(sheetBars(a));
    expect(gridBars(a)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
    expect(barStartAt(sheetGrid(a, a.parts[0]), 2)).toBeCloseTo(2);
  });
});

describe('the sheet in 6/8', () => {
  const eighths = Array.from({ length: 6 }, (_, i) => note(i / 3, i * 0.5, 0.5));
  const score = buildScore(song(eighths, { tempo_bpm: 60, time_signature: ts(6, 8) }), 'p');
  it('writes six eighth notes in one bar', () => {
    expect(score.measureCount).toBe(1);
    expect(score.xml.match(/<type>eighth<\/type>/g)?.length).toBe(6);
    expect(score.xml.match(/<duration>2<\/duration>/g)?.length).toBe(6);
  });
  it('marks the tempo as dotted quarters, and plays quarters 1.5 times as fast', () => {
    expect(score.xml).toContain('<beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute>');
    expect(score.xml).toContain('<sound tempo="90"/>');
  });
  it('4/4 and 3/4 tempo marks are unchanged', () => {
    expect(buildScore(song(eighths, {}), 'p').xml).toContain('<beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/>');
    expect(buildScore(song(eighths, { time_signature: ts(3, 4) }), 'p').xml).toContain('<sound tempo="120"/>');
  });
});
