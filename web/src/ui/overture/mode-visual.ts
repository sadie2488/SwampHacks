// Pure helpers for each mode's base picture (from the Overture mockup's mode screens), kept apart so they can be tested.
import type { Note, SongAnalysis } from '@/contracts';

/** Learn's staff: where it sits and how far a second of music travels. */
export interface StaffGeometry {
  top: number;
  gap: number;
  playheadX: number;
  pxPerSec: number;
}

export function staffGeometry(w: number, h: number): StaffGeometry {
  const gap = Math.max(10, Math.min(18, h * 0.018));
  return { top: h * 0.66, gap, playheadX: w * 0.3, pxPerSec: Math.max(90, w * 0.09) };
}

// the white keys of one octave, as steps up from C
const DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

/** Steps above the bottom line of a treble staff (E4 = 0, F4 = 1, G4 = 2 ...), clamped to just around the staff. */
export function staffStep(midi: number): number {
  const m = Math.round(midi);
  const steps = Math.floor(m / 12) * 7 + DIATONIC[((m % 12) + 12) % 12];
  const e4 = 5 * 7 + 2;
  return Math.max(-3, Math.min(11, steps - e4));
}

/** The notes worth drawing: the melody part (or the first part with notes). */
export function staffNotes(analysis: SongAnalysis | undefined): Note[] {
  if (!analysis) return [];
  const parts = analysis.parts.filter((p) => p.notes.length > 0);
  const part = parts.find((p) => p.kind === 'melody') ?? parts[0];
  return part ? [...part.notes].sort((a, b) => a.onset_sec - b.onset_sec) : [];
}

export interface DrawnNote {
  x: number;
  y: number;
  on: boolean;
}

/** Where each visible note head goes at this moment of the song. Sounding notes sit on the playhead and light up. */
export function placeNotes(notes: Note[], positionSec: number, g: StaffGeometry, w: number): DrawnNote[] {
  const out: DrawnNote[] = [];
  const from = positionSec - g.playheadX / g.pxPerSec - 1;
  const to = positionSec + (w - g.playheadX) / g.pxPerSec + 1;
  const bottom = g.top + g.gap * 4;
  for (const n of notes) {
    if (n.onset_sec + n.duration_sec < from) continue;
    if (n.onset_sec > to) break;
    const on = n.onset_sec <= positionSec && positionSec < n.onset_sec + Math.max(0.05, n.duration_sec);
    out.push({ x: g.playheadX + (n.onset_sec - positionSec) * g.pxPerSec, y: bottom - (staffStep(n.pitch) * g.gap) / 2, on });
  }
  return out;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A MIDI note as a name, e.g. 64 -> "E4". */
export function noteName(midi: number): string {
  const m = Math.round(midi);
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** The song's key in words, e.g. "A minor". */
export function keyWords(analysis: SongAnalysis | undefined): string {
  return analysis ? `${analysis.key.tonic} ${analysis.key.mode}` : '—';
}

/** A signed semitone amount, e.g. "+2.0 st". */
export function signedSemitones(st: number): string {
  return `${st > 0 ? '+' : ''}${st.toFixed(1)} st`;
}

/** Play's readout labels: tempo follows the right hand's height; pitch is by voice (left fist + "higher"/"lower"). */
export const PLAY_READOUT_LABELS = { tempo: 'Tempo · hand height', pitch: 'Pitch · say higher / lower' } as const;
