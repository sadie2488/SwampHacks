// Turning the layers into something the server can keep, and back. Pure: no network, no screen.
//
// What is saved for each layer: { name, kind, instrument, volume, effect, muted, notes }.
//   - Layer ids are not saved; they are made again when a track is loaded (layer-1, layer-2, ... and "beat").
//   - Mute IS saved, as its own true/false flag, so a muted layer comes back muted and keeps its volume.
//   - "effect" is the store's `effects`.
// Everything that comes back from the server is treated as untrusted: unknown fields are ignored, numbers are
// clamped, notes with a bad pitch or time are dropped, and the number of layers and notes is capped.
import type { Note } from '@/contracts';
import { BEAT_ID, type Layer } from './layers';
import { BEATS_PER_BAR, DEFAULT_BARS, DEFAULT_BPM, DEFAULT_EFFECT, DEFAULT_INSTRUMENT, DEFAULT_LAYER_VOLUME, isEffect, isInstrument } from './music';

export const DEFAULT_TRACK_NAME = 'My track';
export const MAX_TRACK_NAME = 120;
const MAX_LAYER_NAME = 60;
export const MAX_LAYERS = 32;
export const MAX_NOTES_PER_LAYER = 1000;
export const MAX_TOTAL_NOTES = 4000;
/** No note may start at or after this many beats (16 bars of 4/4). */
export const MAX_BEATS = 64;
const MIN_BPM = 20;
const MAX_BPM = 400;
const MAX_BARS = MAX_BEATS / BEATS_PER_BAR;

/** The body sent to POST /api/creations (and what GET /api/creations/{id} returns, plus id and created_at). */
export interface TrackPayload {
  name: string;
  tempo_bpm: number;
  layers: PayloadLayer[];
}

export interface PayloadLayer {
  name: string;
  kind: 'hum' | 'beat';
  instrument: string;
  volume: number;
  effect: string;
  muted: boolean;
  notes: Note[];
}

/** A saved track made safe to put into the store. */
export interface LoadedTrack {
  name: string;
  bpm: number;
  bars: number;
  layers: Layer[];
  /** How many layers and notes were thrown away because they were unusable or over the limits. */
  skippedLayers: number;
  skippedNotes: number;
}

// ---- small helpers ----
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Text without control characters, trimmed and cut to a length; the fallback when nothing is left. */
export function cleanText(v: unknown, max: number, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const text = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return text || fallback;
}

export const cleanTrackName = (v: unknown): string => cleanText(v, MAX_TRACK_NAME, DEFAULT_TRACK_NAME);

function cleanBpm(v: unknown): number {
  const n = finite(v);
  return n === null || n <= 0 ? DEFAULT_BPM : clamp(n, MIN_BPM, MAX_BPM);
}

/** One note, checked and cleaned; null when it cannot be used. Only known fields are copied. */
export function cleanNote(raw: unknown, bpm: number): Note | null {
  if (!isObject(raw)) return null;
  const pitch = finite(raw.pitch);
  if (pitch === null || pitch < 0 || pitch > 127) return null;
  const beatsPerSec = bpm / 60;

  let onsetBeat = finite(raw.onset_beat);
  let onsetSec = finite(raw.onset_sec);
  let durBeat = finite(raw.duration_beat);
  let durSec = finite(raw.duration_sec);
  if (onsetBeat === null && onsetSec !== null) onsetBeat = onsetSec * beatsPerSec;
  if (onsetSec === null && onsetBeat !== null) onsetSec = onsetBeat / beatsPerSec;
  if (durBeat === null && durSec !== null) durBeat = durSec * beatsPerSec;
  if (durSec === null && durBeat !== null) durSec = durBeat / beatsPerSec;
  if (onsetBeat === null || onsetSec === null || durBeat === null || durSec === null) return null;

  if (onsetBeat >= MAX_BEATS || durBeat <= 0 || durSec <= 0) return null;
  if (onsetBeat < 0 || onsetSec < 0) {
    onsetBeat = Math.max(0, onsetBeat);
    onsetSec = Math.max(0, onsetSec);
  }
  if (onsetBeat + durBeat > MAX_BEATS) {
    durBeat = MAX_BEATS - onsetBeat;
    durSec = durBeat / beatsPerSec;
  }

  const note: Note = { pitch, onset_sec: onsetSec, duration_sec: durSec, onset_beat: onsetBeat, duration_beat: durBeat };
  const velocity = finite(raw.velocity);
  if (velocity !== null) note.velocity = clamp(velocity, 0, 1);
  const confidence = finite(raw.confidence);
  if (confidence !== null) note.confidence = clamp(confidence, 0, 1);
  if (typeof raw.part === 'string' && raw.part.length > 0 && raw.part.length <= 32) note.part = raw.part;
  if (typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64) note.id = raw.id;
  return note;
}

/** Clean a list of notes, keeping at most `room` of them. Counts what was thrown away. */
function cleanNotes(raw: unknown, bpm: number, room: number): { notes: Note[]; skipped: number } {
  if (!Array.isArray(raw)) return { notes: [], skipped: 0 };
  const limit = Math.min(MAX_NOTES_PER_LAYER, Math.max(0, room));
  const notes: Note[] = [];
  let skipped = 0;
  for (const item of raw) {
    const note = notes.length < limit ? cleanNote(item, bpm) : null;
    if (note) notes.push(note);
    else skipped++;
  }
  return { notes, skipped };
}

// ---- layers -> payload ----

/** The body to send when saving: what the person built, in a plain shape. Bad notes and anything over the caps are left out. */
export function layersToPayload(layers: readonly Layer[], bpm: number, name: string): TrackPayload {
  const tempo = cleanBpm(bpm);
  let room = MAX_TOTAL_NOTES;
  const out: PayloadLayer[] = [];
  for (const layer of layers.slice(0, MAX_LAYERS)) {
    const { notes } = cleanNotes(layer.notes, tempo, room);
    room -= notes.length;
    out.push({
      name: cleanText(layer.name, MAX_LAYER_NAME, 'Layer'),
      kind: layer.kind === 'beat' ? 'beat' : 'hum',
      instrument: layer.instrument,
      volume: clamp(finite(layer.volume) ?? DEFAULT_LAYER_VOLUME, 0, 1),
      effect: layer.effects,
      muted: layer.muted === true,
      notes,
    });
  }
  return { name: cleanTrackName(name), tempo_bpm: tempo, layers: out };
}

// ---- payload -> layers ----

/**
 * Make a track from whatever the server (or the computer's own storage) gave back. Returns null when nothing usable
 * is left. Never throws, whatever the input is.
 */
export function payloadToLayers(payload: unknown): LoadedTrack | null {
  if (!isObject(payload) || !Array.isArray(payload.layers)) return null;
  const bpm = cleanBpm(payload.tempo_bpm);
  const rawLayers = payload.layers;
  let skippedLayers = Math.max(0, rawLayers.length - MAX_LAYERS * 2);
  let skippedNotes = 0;
  let room = MAX_TOTAL_NOTES;
  const hum: Layer[] = [];
  let beat: Layer | undefined;

  for (const raw of rawLayers.slice(0, MAX_LAYERS * 2)) {
    if (!isObject(raw) || hum.length + (beat ? 1 : 0) >= MAX_LAYERS) {
      skippedLayers++;
      continue;
    }
    const isBeat = raw.kind === 'beat';
    if (isBeat && beat) {
      skippedLayers++; // only one beat layer can exist
      continue;
    }
    const { notes, skipped } = cleanNotes(raw.notes, bpm, room);
    room -= notes.length;
    skippedNotes += skipped;
    const layer: Layer = {
      id: isBeat ? BEAT_ID : `layer-${hum.length + 1}`,
      name: cleanText(raw.name, MAX_LAYER_NAME, isBeat ? 'Beat' : `Layer ${hum.length + 1}`),
      kind: isBeat ? 'beat' : 'hum',
      instrument: isBeat ? 'drums' : isInstrument(raw.instrument) ? raw.instrument : DEFAULT_INSTRUMENT,
      volume: clamp(finite(raw.volume) ?? DEFAULT_LAYER_VOLUME, 0, 1),
      effects: isEffect(raw.effect) ? raw.effect : DEFAULT_EFFECT,
      muted: raw.muted === true,
      notes,
    };
    if (isBeat) beat = layer;
    else hum.push(layer);
  }

  const layers = beat ? [...hum, beat] : hum;
  if (layers.length === 0) return null;
  return { name: cleanTrackName(payload.name), bpm, bars: barsFor(layers), layers, skippedLayers, skippedNotes };
}

/** The loop is at least the usual length, and longer only when a note reaches past it. */
function barsFor(layers: readonly Layer[]): number {
  let end = 0;
  for (const l of layers) for (const n of l.notes) end = Math.max(end, (n.onset_beat ?? 0) + (n.duration_beat ?? 0));
  return clamp(Math.ceil(end / BEATS_PER_BAR - 1e-9), DEFAULT_BARS, MAX_BARS);
}

/** A short text that changes when anything the person would want saved changes. Used to tell if there is unsaved work. */
export function layersSignature(layers: readonly Layer[], bpm: number): string {
  return JSON.stringify(layersToPayload(layers, bpm, ''));
}
