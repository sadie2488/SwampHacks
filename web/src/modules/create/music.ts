// Small music helpers for Create mode. Pure, no audio. Pitches are concert-pitch MIDI.
import type { Note } from '@/contracts';
import { controlInfo } from '@/contracts/catalogs';

/** Instrument and effect ids come from contracts/control-catalog.json (create.instrument / create.effects). */
export type InstrumentId = string;
export type EffectId = string;

export const INSTRUMENT_IDS: readonly InstrumentId[] = controlInfo('create.instrument')?.options ?? ['piano', 'synth', 'bass', 'pluck', 'drums'];
export const EFFECT_IDS: readonly EffectId[] = controlInfo('create.effects')?.options ?? ['none', 'reverb', 'delay', 'filter'];
export const DEFAULT_INSTRUMENT: InstrumentId = String(controlInfo('create.instrument')?.default ?? 'piano');
export const DEFAULT_EFFECT: EffectId = String(controlInfo('create.effects')?.default ?? 'none');
export const DEFAULT_LAYER_VOLUME = Number(controlInfo('create.layer.volume')?.default ?? 0.8);

export const DEFAULT_BPM = 100;
export const DEFAULT_BARS = 2;
export const BEATS_PER_BAR = 4;

export const isInstrument = (v: unknown): v is InstrumentId => typeof v === 'string' && INSTRUMENT_IDS.includes(v);
export const isEffect = (v: unknown): v is EffectId => typeof v === 'string' && EFFECT_IDS.includes(v);

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 60 -> "C4". Accepts a fractional MIDI number (rounded to the nearest semitone). */
export function midiToName(midi: number): string {
  const m = Math.round(midi);
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export const secPerBeat = (bpm: number): number => 60 / bpm;
export const loopBeats = (bars: number): number => bars * BEATS_PER_BAR;
export const loopSeconds = (bars: number, bpm: number): number => loopBeats(bars) * secPerBeat(bpm);

export type DrumPart = 'kick' | 'snare' | 'hat';

/** Low hums make a kick, middle ones a snare, high ones a hat, so any melody still turns into a beat. */
export function drumPartForPitch(pitch: number): DrumPart {
  if (pitch < 57) return 'kick';
  if (pitch < 65) return 'snare';
  return 'hat';
}

/** Pitches the built-in beat uses (they land in the right drum range above). */
export const BEAT_PITCH: Record<DrumPart, number> = { kick: 48, snare: 60, hat: 72 };

/** A simple rock beat: kick on 1 and 3, snare on 2 and 4, closed hat on every eighth note, repeated for each bar. */
export function buildBeatNotes(bpm: number, bars: number): Note[] {
  const notes: Note[] = [];
  const spb = secPerBeat(bpm);
  const add = (pitch: number, beat: number, lengthBeats: number, velocity: number) =>
    notes.push({ pitch, onset_beat: beat, duration_beat: lengthBeats, onset_sec: beat * spb, duration_sec: lengthBeats * spb, velocity, part: 'beat' });
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * BEATS_PER_BAR;
    add(BEAT_PITCH.kick, b0, 0.5, 1);
    add(BEAT_PITCH.snare, b0 + 1, 0.5, 0.9);
    add(BEAT_PITCH.kick, b0 + 2, 0.5, 0.9);
    add(BEAT_PITCH.snare, b0 + 3, 0.5, 0.9);
    for (let eighth = 0; eighth < 8; eighth++) add(BEAT_PITCH.hat, b0 + eighth * 0.5, 0.25, eighth % 2 === 0 ? 0.7 : 0.45);
  }
  return notes.sort((a, b) => a.onset_beat! - b.onset_beat!);
}
