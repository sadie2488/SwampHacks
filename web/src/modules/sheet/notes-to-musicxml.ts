// Turns one part of a song analysis into MusicXML for OpenSheetMusicDisplay.
// Notes stay in concert pitch everywhere else; the written transposition (clarinet, guitar) happens only here.
import type { Part, SongAnalysis, Tonic } from '@/contracts';
import { isCompound, quartersPerBar, quartersPerBeat, secPerQuarter } from './bar-grid';

export interface ScoreOptions {
  /**
   * Which instrument to write the part for. Leave out to use the part's own instrument.
   * "concert" (or any name we do not know) means no transposition.
   */
  instrument?: string | null;
  /** Put the note letter (C, F#, Bb ...) under every note. */
  beginner?: boolean;
}

export interface Score {
  xml: string;
  /** Notes written (a note tied across a barline counts once). */
  noteCount: number;
  measureCount: number;
  clef: 'treble' | 'bass';
  /** Semitones added to the concert pitch for display. */
  transposeSemitones: number;
  /** Key signature as written: negative = flats, positive = sharps. */
  fifths: number;
}

/** Smallest note we write is a sixteenth, so one tick = one sixteenth note = 1 MusicXML division (4 per quarter). */
const DIVISIONS_PER_QUARTER = 4;

/** Note lengths in ticks, longest first. Anything else is split and tied. */
const NOTE_VALUES: Array<{ ticks: number; type: string; dots: number }> = [
  { ticks: 24, type: 'whole', dots: 1 },
  { ticks: 16, type: 'whole', dots: 0 },
  { ticks: 12, type: 'half', dots: 1 },
  { ticks: 8, type: 'half', dots: 0 },
  { ticks: 6, type: 'quarter', dots: 1 },
  { ticks: 4, type: 'quarter', dots: 0 },
  { ticks: 3, type: 'eighth', dots: 1 },
  { ticks: 2, type: 'eighth', dots: 0 },
  { ticks: 1, type: '16th', dots: 0 },
];

const BEAT_UNIT: Record<number, string> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th' };

const TONIC_PC: Record<Tonic, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
/** Key signature of the major key that starts on each pitch class (C Db D Eb E F F# G Ab A Bb B). */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

// ---- how an instrument is written ----

export const INSTRUMENT_CHOICES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: "The part's own instrument" },
  { value: 'concert', label: 'Concert pitch (as it sounds)' },
  { value: 'clarinet', label: 'B-flat clarinet' },
  { value: 'guitar', label: 'Guitar' },
  { value: 'trombone', label: 'Trombone' },
];

/** How the part is written on the page: which clef and how far the notes are moved up. */
export function displayStyle(part: Pick<Part, 'instrument' | 'kind'>, instrument?: string | null): { clef: 'treble' | 'bass'; semitones: number } {
  const name = (instrument ?? part.instrument ?? '').toLowerCase();
  // B-flat clarinet is written a whole step above it sounds; guitar an octave above.
  const semitones = name.includes('clarinet') ? 2 : name.includes('guitar') ? 12 : 0;
  // Trombone is written at concert pitch but in bass clef; so are bass parts.
  const bass = part.kind === 'bass' || /trombone|tuba|cello|bassoon|\bbass\b/.test(name);
  return { clef: bass ? 'bass' : 'treble', semitones };
}

// ---- keys and note names ----

/** Key signature (sharps positive, flats negative) for a key, written `semitones` higher than it sounds. */
export function keyFifths(tonic: Tonic | undefined, mode: 'major' | 'minor' | undefined, semitones = 0): number {
  const base = tonic !== undefined && tonic in TONIC_PC ? TONIC_PC[tonic] : 0;
  const majorPc = (base + (mode === 'minor' ? 3 : 0) + semitones + 120) % 12;
  const spelledSharp = tonic?.includes('#') ?? false;
  const spelledFlat = tonic?.includes('b') ?? false;
  // Only C#/Db and F#/Gb can be written two ways: keep the way the key was named when it is not moved.
  if (semitones === 0 && majorPc === 1 && spelledSharp) return 7;
  if (semitones === 0 && majorPc === 6 && spelledFlat) return -6;
  return MAJOR_FIFTHS[majorPc];
}

const SHARP_NAMES: Array<[string, number]> = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_NAMES: Array<[string, number]> = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/** Spell a MIDI note as step, alter (-1 flat, 1 sharp) and octave, using flats in flat keys and sharps otherwise. */
export function spellPitch(midi: number, fifths: number): { step: string; alter: number; octave: number } {
  const [step, alter] = (fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[((midi % 12) + 12) % 12];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

/** "C", "F#", "Bb": the letter shown under a note in beginner mode. */
export function noteLetter(midi: number, fifths: number): string {
  const { step, alter } = spellPitch(midi, fifths);
  return step + (alter === 1 ? '#' : alter === -1 ? 'b' : '');
}

// ---- the conversion ----

interface Event {
  start: number;
  end: number;
  pitches: number[];
}

interface Piece {
  /** null = rest */
  pitches: number[] | null;
  ticks: number;
  tieStart: boolean;
  tieStop: boolean;
  wholeMeasureRest: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Split a length into note values that exist (longest first). */
function splitTicks(ticks: number): number[] {
  const out: number[] = [];
  let left = ticks;
  while (left > 0) {
    const v = NOTE_VALUES.find((n) => n.ticks <= left)!;
    out.push(v.ticks);
    left -= v.ticks;
  }
  return out;
}

/**
 * Build the sheet music for one part of an analysis.
 * Times come from onset_beat/duration_beat (quarter notes), or from seconds and the tempo when those are missing.
 * Bars are every `quartersPerBar` quarter notes from beat 0 (see bar-grid.ts, which practice feedback uses too).
 * Everything is rounded to a sixteenth-note grid; gaps become rests; long notes are tied over barlines.
 */
export function buildScore(analysis: SongAnalysis, partId: string, options: ScoreOptions = {}): Score {
  const part = analysis.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`This song has no part called "${partId}".`);

  const { clef, semitones } = displayStyle(part, options.instrument);
  const numerator = analysis.time_signature?.numerator ?? 4;
  const denominator = analysis.time_signature?.denominator ?? 4;
  const ts = { numerator, denominator };
  const beatTicks = DIVISIONS_PER_QUARTER; // onset_beat counts quarter notes in every time signature
  const measureTicks = Math.round(quartersPerBar(ts) * DIVISIONS_PER_QUARTER);
  const bpm = analysis.tempo_bpm > 0 ? analysis.tempo_bpm : 120; // counts the felt beat (a dotted quarter in 6/8)
  const quarterSec = secPerQuarter({ tempo_bpm: bpm, time_signature: ts });
  const fifths = keyFifths(analysis.key?.tonic, analysis.key?.mode, semitones);

  // 1. notes -> events on the tick grid (notes that start together become one chord; overlaps are cut short)
  const raw: Array<{ start: number; end: number; pitch: number }> = [];
  for (const n of part.notes) {
    const onsetBeat = n.onset_beat ?? n.onset_sec / quarterSec;
    const durationBeat = n.duration_beat ?? n.duration_sec / quarterSec;
    if (!Number.isFinite(onsetBeat) || !Number.isFinite(durationBeat) || !Number.isFinite(n.pitch)) continue;
    const start = Math.max(0, Math.round(onsetBeat * beatTicks));
    const end = Math.max(start + 1, Math.round((onsetBeat + durationBeat) * beatTicks));
    raw.push({ start, end, pitch: Math.round(n.pitch) });
  }
  raw.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const events: Event[] = [];
  for (const r of raw) {
    const last = events[events.length - 1];
    if (last && last.start === r.start) {
      if (!last.pitches.includes(r.pitch)) last.pitches.push(r.pitch);
      last.end = Math.max(last.end, r.end);
    } else {
      events.push({ start: r.start, end: r.end, pitches: [r.pitch] });
    }
  }
  for (let i = 0; i + 1 < events.length; i++) events[i].end = Math.min(events[i].end, events[i + 1].start);
  const noteCount = events.reduce((sum, e) => sum + e.pitches.length, 0);

  // 2. events + gaps -> pieces that each sit inside one measure (and are one real note length)
  const lastTick = events.length ? events[events.length - 1].end : 0;
  const measureCount = Math.max(1, Math.ceil(lastTick / measureTicks));
  const pieces: Piece[][] = Array.from({ length: measureCount }, () => []);
  const place = (start: number, end: number, pitches: number[] | null) => {
    const chain: Piece[] = [];
    for (let pos = start; pos < end; ) {
      const m = Math.floor(pos / measureTicks);
      const chunkEnd = Math.min(end, (m + 1) * measureTicks);
      if (pitches === null && pos === m * measureTicks && chunkEnd === pos + measureTicks) {
        pieces[m].push({ pitches: null, ticks: measureTicks, tieStart: false, tieStop: false, wholeMeasureRest: true });
      } else {
        for (const ticks of splitTicks(chunkEnd - pos)) {
          const piece: Piece = { pitches, ticks, tieStart: false, tieStop: false, wholeMeasureRest: false };
          pieces[m].push(piece);
          chain.push(piece);
        }
      }
      pos = chunkEnd;
    }
    if (pitches) {
      chain.forEach((p, i) => {
        p.tieStop = i > 0;
        p.tieStart = i < chain.length - 1;
      });
    }
  };
  let cursor = 0;
  for (const e of events) {
    if (e.start > cursor) place(cursor, e.start, null);
    place(e.start, e.end, e.pitches);
    cursor = e.end;
  }
  if (cursor < measureCount * measureTicks) place(cursor, measureCount * measureTicks, null);

  // 3. pieces -> XML
  const writtenFifths = fifths;
  const noteXml = (piece: Piece, withLetter: boolean): string => {
    const value = NOTE_VALUES.find((v) => v.ticks === piece.ticks);
    const typeXml = value ? `<type>${value.type}</type>${'<dot/>'.repeat(value.dots)}` : '';
    if (piece.pitches === null) {
      if (piece.wholeMeasureRest) return `<note><rest measure="yes"/><duration>${piece.ticks}</duration><voice>1</voice></note>`;
      return `<note><rest/><duration>${piece.ticks}</duration><voice>1</voice>${typeXml}</note>`;
    }
    return piece.pitches
      .map((midi, i) => {
        const { step, alter, octave } = spellPitch(midi + semitones, writtenFifths);
        const ties = (piece.tieStop ? '<tie type="stop"/>' : '') + (piece.tieStart ? '<tie type="start"/>' : '');
        const tied = (piece.tieStop ? '<tied type="stop"/>' : '') + (piece.tieStart ? '<tied type="start"/>' : '');
        const lyric =
          withLetter && i === 0 && !piece.tieStop
            ? `<lyric number="1"><syllabic>single</syllabic><text>${esc(noteLetter(midi + semitones, writtenFifths))}</text></lyric>`
            : '';
        return (
          '<note>' +
          (i > 0 ? '<chord/>' : '') +
          `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>` +
          `<duration>${piece.ticks}</duration>${ties}<voice>1</voice>${typeXml}` +
          (tied ? `<notations>${tied}</notations>` : '') +
          lyric +
          '</note>'
        );
      })
      .join('');
  };

  const mode = analysis.key?.mode === 'minor' ? 'minor' : 'major';
  const beatUnit = isCompound(ts) ? '<beat-unit>quarter</beat-unit><beat-unit-dot/>' : `<beat-unit>${BEAT_UNIT[denominator] ?? 'quarter'}</beat-unit>`;
  const tempoXml =
    `<direction placement="above"><direction-type><metronome>${beatUnit}` +
    `<per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm * quartersPerBeat(ts))}"/></direction>`;
  const attributesXml =
    `<attributes><divisions>${DIVISIONS_PER_QUARTER}</divisions><key><fifths>${fifths}</fifths><mode>${mode}</mode></key>` +
    `<time><beats>${numerator}</beats><beat-type>${denominator}</beat-type></time>` +
    `<clef><sign>${clef === 'bass' ? 'F' : 'G'}</sign><line>${clef === 'bass' ? 4 : 2}</line></clef></attributes>`;

  const measuresXml = pieces
    .map((list, m) => {
      const head = m === 0 ? attributesXml + tempoXml : '';
      const tail = m === measureCount - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : '';
      return `<measure number="${m + 1}">${head}${list.map((p) => noteXml(p, options.beginner === true)).join('')}${tail}</measure>`;
    })
    .join('');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<score-partwise version="3.1">' +
    `<work><work-title>${esc(analysis.title ?? analysis.song_id)}</work-title></work>` +
    `<part-list><score-part id="P1"><part-name>${esc(part.name)}</part-name></score-part></part-list>` +
    `<part id="P1">${measuresXml}</part>` +
    '</score-partwise>';

  return { xml, noteCount, measureCount, clef, transposeSemitones: semitones, fifths };
}

/** MusicXML text for one part of a song (see buildScore for the details). */
export function notesToMusicXml(analysis: SongAnalysis, partId: string, options: ScoreOptions = {}): string {
  return buildScore(analysis, partId, options).xml;
}
