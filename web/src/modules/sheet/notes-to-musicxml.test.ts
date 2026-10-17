// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import twinkleJson from '@fixtures/song-analysis/twinkle.json';
import minimalJson from '@fixtures/song-analysis/minimal.json';
import type { Note, SongAnalysis } from '@/contracts';
import { buildScore, displayStyle, keyFifths, noteLetter, notesToMusicXml, spellPitch } from './notes-to-musicxml';

const twinkle = twinkleJson as unknown as SongAnalysis;
const minimal = minimalJson as unknown as SongAnalysis;

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  return doc;
}
const text = (el: Element | null | undefined, tag: string) => el?.getElementsByTagName(tag)[0]?.textContent ?? null;

/** Pitched notes of a document as "C4", "F#4" ... in order. */
function pitches(doc: Document): string[] {
  return [...doc.getElementsByTagName('note')]
    .filter((n) => n.getElementsByTagName('pitch').length)
    .map((n) => {
      const alter = Number(text(n, 'alter') ?? 0);
      return `${text(n, 'step')}${alter === 1 ? '#' : alter === -1 ? 'b' : ''}${text(n, 'octave')}`;
    });
}

/** A one-part song to test small cases. */
function song(notes: Note[], extra: Partial<SongAnalysis> = {}, partExtra: { instrument?: string; kind?: 'bass' } = {}): SongAnalysis {
  return {
    version: 1,
    song_id: 't',
    duration_sec: 10,
    tempo_bpm: 120,
    key: { tonic: 'C', mode: 'major' },
    time_signature: { numerator: 4, denominator: 4 },
    parts: [{ id: 'p', name: 'P', ...partExtra, notes }],
    ...extra,
  };
}
const q = (pitch: number, beat: number, beats = 1): Note => ({ pitch, onset_sec: beat / 2, duration_sec: beats / 2, onset_beat: beat, duration_beat: beats });

describe('Twinkle melody (clarinet part, written transposed)', () => {
  const score = buildScore(twinkle, 'melody');
  const doc = parse(score.xml);

  it('is well formed MusicXML with 12 bars of 4/4 and a tempo mark', () => {
    expect(doc.documentElement.tagName).toBe('score-partwise');
    expect(doc.getElementsByTagName('measure').length).toBe(12);
    expect(score.measureCount).toBe(12);
    expect(text(doc.documentElement, 'beats')).toBe('4');
    expect(text(doc.documentElement, 'beat-type')).toBe('4');
    expect(text(doc.documentElement, 'per-minute')).toBe('100');
    expect(text(doc.documentElement, 'divisions')).toBe('4');
  });

  it('writes treble clef and a clarinet key signature (C concert = D major, 2 sharps)', () => {
    expect(score.clef).toBe('treble');
    expect(text(doc.documentElement, 'sign')).toBe('G');
    expect(score.transposeSemitones).toBe(2);
    expect(score.fifths).toBe(2);
    expect(text(doc.documentElement, 'fifths')).toBe('2');
  });

  it('draws all 42 notes, the first bars are C C G G A A G (+2 semitones: D D A A B B A)', () => {
    expect(score.noteCount).toBe(42);
    const p = pitches(doc);
    expect(p.length).toBe(42);
    expect(p.slice(0, 7)).toEqual(['D4', 'D4', 'A4', 'A4', 'B4', 'B4', 'A4']);
  });

  it('every bar adds up to 16 divisions and nothing is tied or rested in this simple tune except the last half note', () => {
    for (const m of [...doc.getElementsByTagName('measure')]) {
      const total = [...m.getElementsByTagName('note')]
        .filter((n) => !n.getElementsByTagName('chord').length)
        .reduce((sum, n) => sum + Number(text(n, 'duration')), 0);
      expect(total).toBe(16);
    }
    expect(doc.getElementsByTagName('tie').length).toBe(0);
    expect(doc.getElementsByTagName('rest').length).toBe(0);
    const last = [...doc.getElementsByTagName('note')].pop()!;
    expect(text(last, 'type')).toBe('half');
  });

  it('concert-pitch option keeps the real pitches (C C G G A A G, key of C)', () => {
    const concert = buildScore(twinkle, 'melody', { instrument: 'concert' });
    expect(concert.fifths).toBe(0);
    expect(concert.transposeSemitones).toBe(0);
    expect(pitches(parse(concert.xml)).slice(0, 7)).toEqual(['C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4']);
  });

  it('does not change the analysis data', () => {
    expect(twinkle.parts[0].notes[0].pitch).toBe(60);
  });
});

describe('Twinkle bass (trombone: concert pitch, bass clef)', () => {
  const score = buildScore(twinkle, 'bass');
  const doc = parse(score.xml);

  it('uses bass clef, no transposition, C major, 12 whole notes', () => {
    expect(score.clef).toBe('bass');
    expect(text(doc.documentElement, 'sign')).toBe('F');
    expect(text(doc.documentElement, 'line')).toBe('4');
    expect(score.transposeSemitones).toBe(0);
    expect(score.fifths).toBe(0);
    expect(score.noteCount).toBe(12);
    expect(doc.getElementsByTagName('measure').length).toBe(12);
    expect(pitches(doc).slice(0, 4)).toEqual(['C3', 'F3', 'C3', 'G3']);
    for (const n of [...doc.getElementsByTagName('note')]) expect(text(n, 'type')).toBe('whole');
  });
});

describe('beginner mode', () => {
  it('puts the written note letter under each note, and none by default', () => {
    expect(buildScore(twinkle, 'melody').xml).not.toContain('<lyric');
    const doc = parse(buildScore(twinkle, 'melody', { beginner: true, instrument: 'concert' }).xml);
    const letters = [...doc.getElementsByTagName('lyric')].map((l) => text(l, 'text'));
    expect(letters.length).toBe(42);
    expect(letters.slice(0, 7)).toEqual(['C', 'C', 'G', 'G', 'A', 'A', 'G']);
  });

  it('shows the written letters when transposed', () => {
    const doc = parse(buildScore(twinkle, 'melody', { beginner: true }).xml);
    expect([...doc.getElementsByTagName('lyric')].slice(0, 3).map((l) => text(l, 'text'))).toEqual(['D', 'D', 'A']);
  });
});

describe('minimal fixture (no beats, no time signature, no title)', () => {
  it('falls back to seconds and the tempo, and to 4/4', () => {
    const score = buildScore(minimal, 'melody');
    const doc = parse(score.xml);
    expect(score.measureCount).toBe(1);
    expect(score.noteCount).toBe(3);
    expect(pitches(doc)).toEqual(['C4', 'D4', 'E4']);
    expect([...doc.getElementsByTagName('note')].map((n) => text(n, 'duration'))).toEqual(['4', '4', '8']);
    expect(text(doc.documentElement, 'beats')).toBe('4');
    expect(text(doc.documentElement, 'per-minute')).toBe('120');
    expect(text(doc.documentElement, 'work-title')).toBe('demo-minimal');
    expect(doc.getElementsByTagName('rest').length).toBe(0); // the three notes fill the bar exactly
  });
});

describe('rests, ties and the grid', () => {
  it('turns gaps into rests and pads the last bar', () => {
    const doc = parse(notesToMusicXml(song([q(60, 1), q(62, 3)]), 'p'));
    const notes = [...doc.getElementsByTagName('note')];
    expect(notes.map((n) => (n.getElementsByTagName('rest').length ? 'r' : 'n') + text(n, 'duration'))).toEqual(['r4', 'n4', 'r4', 'n4']);
  });

  it('uses one whole-bar rest for an empty bar', () => {
    const doc = parse(notesToMusicXml(song([q(60, 0), q(62, 8)]), 'p'));
    const bars = [...doc.getElementsByTagName('measure')];
    expect(bars.length).toBe(3);
    const middle = bars[1];
    expect(middle.getElementsByTagName('rest')[0].getAttribute('measure')).toBe('yes');
    expect(text(middle, 'duration')).toBe('16');
  });

  it('ties a note that crosses a barline', () => {
    // half note starting on beat 3 of bar 1 runs to beat 1 of bar 2 plus a beat: 3 beats = 2 + 1
    const doc = parse(notesToMusicXml(song([q(67, 2, 3)]), 'p'));
    const bars = [...doc.getElementsByTagName('measure')];
    expect(bars.length).toBe(2);
    const first = [...bars[0].getElementsByTagName('note')].filter((n) => n.getElementsByTagName('pitch').length);
    expect(first.length).toBe(1);
    expect(first[0].getElementsByTagName('tie')[0].getAttribute('type')).toBe('start');
    const second = [...bars[1].getElementsByTagName('note')][0];
    expect(second.getElementsByTagName('tie')[0].getAttribute('type')).toBe('stop');
    expect(text(second, 'duration')).toBe('4');
    // counts as one note, and gets only one letter in beginner mode
    const score = buildScore(song([q(67, 2, 3)]), 'p', { beginner: true });
    expect(score.noteCount).toBe(1);
    expect(score.xml.match(/<lyric/g)?.length).toBe(1);
  });

  it('splits odd lengths into real note values with ties (5 sixteenths = quarter + sixteenth)', () => {
    const doc = parse(notesToMusicXml(song([q(60, 0, 1.25)]), 'p'));
    const first = [...doc.getElementsByTagName('note')].slice(0, 2);
    expect(first.map((n) => text(n, 'duration'))).toEqual(['4', '1']);
    expect(first[0].getElementsByTagName('tie')[0].getAttribute('type')).toBe('start');
    expect(first[1].getElementsByTagName('tie')[0].getAttribute('type')).toBe('stop');
  });

  it('rounds wobbly times to the sixteenth-note grid', () => {
    const wobbly: Note[] = [
      { pitch: 60, onset_sec: 0.02, duration_sec: 0.46 },
      { pitch: 62, onset_sec: 0.53, duration_sec: 0.47 },
    ];
    const doc = parse(notesToMusicXml(song(wobbly), 'p'));
    const notes = [...doc.getElementsByTagName('note')].filter((n) => n.getElementsByTagName('pitch').length);
    expect(notes.map((n) => text(n, 'duration'))).toEqual(['4', '4']);
    expect(doc.getElementsByTagName('rest').length).toBe(1); // just the half rest that pads the bar
  });

  it('writes notes that start together as a chord and cuts overlaps short', () => {
    const doc = parse(notesToMusicXml(song([q(60, 0, 2), q(64, 0, 2), q(67, 1, 1)]), 'p'));
    const notes = [...doc.getElementsByTagName('note')];
    expect(notes[1].getElementsByTagName('chord').length).toBe(1);
    expect(text(notes[0], 'duration')).toBe('4'); // cut at the next note
  });

  it('works in 3/4 and 6/8', () => {
    const waltz = song([q(60, 0), q(62, 1), q(64, 2), q(65, 3, 3)], { time_signature: { numerator: 3, denominator: 4 } });
    expect(buildScore(waltz, 'p').measureCount).toBe(2);
    const jig = song([q(60, 0), q(62, 1), q(64, 2)], { time_signature: { numerator: 6, denominator: 8 } });
    const doc = parse(buildScore(jig, 'p').xml);
    expect(text(doc.documentElement, 'beat-type')).toBe('8');
    expect(doc.getElementsByTagName('measure').length).toBe(1);
  });

  it('skips junk notes and handles a part with no notes', () => {
    const junk = song([{ pitch: 60, onset_sec: Number.NaN, duration_sec: 1 }, q(62, 0)]);
    expect(buildScore(junk, 'p').noteCount).toBe(1);
    const empty = buildScore(song([]), 'p');
    expect(empty.noteCount).toBe(0);
    expect(empty.measureCount).toBe(1);
    parse(empty.xml);
  });

  it('says so when the part does not exist', () => {
    expect(() => buildScore(twinkle, 'nope')).toThrow(/nope/);
  });

  it('escapes the title', () => {
    const doc = parse(notesToMusicXml(song([q(60, 0)], { title: 'Rock & <Roll>' }), 'p'));
    expect(text(doc.documentElement, 'work-title')).toBe('Rock & <Roll>');
  });
});

describe('display rules', () => {
  it('clarinet +2, guitar +12 (octave up), trombone bass clef at concert pitch, others untouched', () => {
    expect(displayStyle({ instrument: 'Bb Clarinet' })).toEqual({ clef: 'treble', semitones: 2 });
    expect(displayStyle({ instrument: 'acoustic guitar' })).toEqual({ clef: 'treble', semitones: 12 });
    expect(displayStyle({ instrument: 'trombone' })).toEqual({ clef: 'bass', semitones: 0 });
    expect(displayStyle({ kind: 'bass' })).toEqual({ clef: 'bass', semitones: 0 });
    expect(displayStyle({ instrument: 'piano', kind: 'melody' })).toEqual({ clef: 'treble', semitones: 0 });
    expect(displayStyle({})).toEqual({ clef: 'treble', semitones: 0 });
    expect(displayStyle({ instrument: 'clarinet' }, 'concert')).toEqual({ clef: 'treble', semitones: 0 });
  });

  it('guitar part sounds middle C, is written an octave up', () => {
    const doc = parse(notesToMusicXml(song([q(60, 0)], {}, { instrument: 'guitar' }), 'p'));
    expect(pitches(doc)).toEqual(['C5']);
  });

  it('key signatures', () => {
    expect(keyFifths('C', 'major')).toBe(0);
    expect(keyFifths('G', 'major')).toBe(1);
    expect(keyFifths('F', 'major')).toBe(-1);
    expect(keyFifths('A', 'minor')).toBe(0);
    expect(keyFifths('D', 'minor')).toBe(-1);
    expect(keyFifths('E', 'minor')).toBe(1);
    expect(keyFifths('Bb', 'major')).toBe(-2);
    expect(keyFifths('F#', 'major')).toBe(6);
    expect(keyFifths('Gb', 'major')).toBe(-6);
    expect(keyFifths('C#', 'major')).toBe(7);
    expect(keyFifths('Db', 'major')).toBe(-5);
    expect(keyFifths('C', 'major', 2)).toBe(2); // clarinet
    expect(keyFifths('Bb', 'major', 2)).toBe(0);
  });

  it('spells notes with flats in flat keys and sharps otherwise', () => {
    expect(spellPitch(61, 0)).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(spellPitch(61, -2)).toEqual({ step: 'D', alter: -1, octave: 4 });
    expect(spellPitch(59, 0)).toEqual({ step: 'B', alter: 0, octave: 3 });
    expect(noteLetter(70, -2)).toBe('Bb');
    expect(noteLetter(66, 1)).toBe('F#');
  });
});
