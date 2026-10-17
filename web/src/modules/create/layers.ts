// The state of Create mode: layers, which one is current, and what the loop is doing.
// A pure reducer: no audio, no bus, no timers. The controller turns bus messages into these actions and
// copies the result to the sound engine.
import type { Note } from '@/contracts';
import { buildBeatNotes, DEFAULT_BARS, DEFAULT_BPM, DEFAULT_EFFECT, DEFAULT_INSTRUMENT, DEFAULT_LAYER_VOLUME, type EffectId, type InstrumentId } from './music';

export interface Layer {
  id: string;
  name: string;
  /** 'hum' layers hold a recorded melody; the 'beat' layer is the built-in drum pattern. */
  kind: 'hum' | 'beat';
  instrument: InstrumentId;
  volume: number;
  pitchSemitones?: number;
  handPitchEnabled?: boolean;
  pitchConfirmed?: boolean;
  instrumentVoiceEnabled?: boolean;
  loopBeats?: number;
  effects: EffectId;
  muted: boolean;
  notes: Note[];
}

/** idle: silent. countIn: one bar of clicks. recording: listening to the hum. playing: the loop is running. */
export type Phase = 'idle' | 'countIn' | 'recording' | 'playing';

export interface CreateState {
  bpm: number;
  bars: number;
  layers: Layer[];
  currentId: string | null;
  phase: Phase;
  /** The layer that the running or finished take goes into. */
  recordingId: string | null;
  /** The instrument a new layer starts with (the last one chosen). */
  newLayerInstrument: InstrumentId;
  counter: number;
  /** A short sentence about the last take, for the screen. */
  message: string;
}

export type Action =
  | { type: 'addLayer' }
  | { type: 'selectLayer'; id: string }
  | { type: 'setInstrument'; value: InstrumentId }
  | { type: 'setVolume'; value: number }
  | { type: 'setPitch'; id: string; value: number }
  | { type: 'setHandPitchEnabled'; id: string; enabled: boolean }
  | { type: 'confirmPitch'; id: string }
  | { type: 'setInstrumentVoiceEnabled'; id: string; enabled: boolean }
  | { type: 'advanceLayer' }
  | { type: 'setEffects'; value: EffectId }
  | { type: 'setMuted'; id: string; muted: boolean }
  | { type: 'recordStart' }
  | { type: 'recordGo' }
  | { type: 'recordEnd'; notes: Note[]; loopBeats?: number; message?: string }
  | { type: 'recordCancel' }
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'beatOn' }
  | { type: 'beatOff' }
  | { type: 'loadTrack'; bpm: number; bars: number; layers: Layer[] };

export const BEAT_ID = 'beat';

export function initialState(opts: { bpm?: number; bars?: number; instrument?: InstrumentId } = {}): CreateState {
  return {
    bpm: opts.bpm ?? DEFAULT_BPM,
    bars: opts.bars ?? DEFAULT_BARS,
    layers: [],
    currentId: null,
    phase: 'idle',
    recordingId: null,
    newLayerInstrument: opts.instrument ?? DEFAULT_INSTRUMENT,
    counter: 0,
    message: '',
  };
}

// ---- reading the state ----
export const currentLayer = (s: CreateState): Layer | undefined => s.layers.find((l) => l.id === s.currentId);
export const hasBeat = (s: CreateState): boolean => s.layers.some((l) => l.kind === 'beat');
/** Layers that will make sound: they have notes and are not muted. */
export const audibleLayers = (s: CreateState): Layer[] => s.layers.filter((l) => l.notes.length > 0 && !l.muted);
export const hasAnyNotes = (s: CreateState): boolean => s.layers.some((l) => l.notes.length > 0);
export const isRecording = (s: CreateState): boolean => s.phase === 'countIn' || s.phase === 'recording';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function withLayer(s: CreateState, id: string, change: (l: Layer) => Layer): CreateState {
  return { ...s, layers: s.layers.map((l) => (l.id === id ? change(l) : l)) };
}

function newLayer(s: CreateState): CreateState {
  const n = s.counter + 1;
  const layer: Layer = { id: `layer-${n}`, name: `Layer ${n}`, kind: 'hum', instrument: s.newLayerInstrument, volume: DEFAULT_LAYER_VOLUME, pitchSemitones: 0, handPitchEnabled: false, pitchConfirmed: false, instrumentVoiceEnabled: currentLayer(s)?.instrumentVoiceEnabled ?? false, effects: DEFAULT_EFFECT, muted: false, notes: [] };
  // keep the beat layer last in the list so the numbered hum layers stay in the order they were added
  const beatAt = s.layers.findIndex((l) => l.kind === 'beat');
  const layers = beatAt === -1 ? [...s.layers, layer] : [...s.layers.slice(0, beatAt), layer, ...s.layers.slice(beatAt)];
  return { ...s, counter: n, layers, currentId: layer.id };
}

export function reduce(s: CreateState, a: Action): CreateState {
  switch (a.type) {
    case 'addLayer':
      return newLayer(s);

    case 'selectLayer':
      return s.layers.some((l) => l.id === a.id) ? { ...s, currentId: a.id } : s;

    case 'setInstrument': {
      const cur = currentLayer(s);
      // the beat is always drums; the choice is still remembered for the next new layer
      if (!cur || cur.kind === 'beat') return { ...s, newLayerInstrument: a.value };
      return { ...withLayer(s, cur.id, (l) => ({ ...l, instrument: a.value })), newLayerInstrument: a.value };
    }

    case 'setVolume': {
      const cur = currentLayer(s);
      return cur ? withLayer(s, cur.id, (l) => ({ ...l, volume: clamp01(a.value) })) : s;
    }

    case 'setPitch':
      return withLayer(s, a.id, (l) => (l.handPitchEnabled ? { ...l, pitchSemitones: Math.min(6, Math.max(-6, a.value)), pitchConfirmed: false } : l));

    case 'setHandPitchEnabled':
      return withLayer(s, a.id, (l) => ({ ...l, handPitchEnabled: a.enabled, pitchSemitones: a.enabled ? (l.pitchSemitones ?? 0) : 0, pitchConfirmed: a.enabled ? (l.pitchConfirmed ?? false) : false }));

    case 'confirmPitch':
      return withLayer(s, a.id, (l) => (l.kind === 'hum' && l.notes.length > 0 ? {
        ...l,
        notes: l.notes.map((note) => ({ ...note, pitch: Math.max(0, Math.min(127, note.pitch + (l.pitchSemitones ?? 0))) })),
        pitchSemitones: 0,
        handPitchEnabled: false,
        pitchConfirmed: true,
      } : l));

    case 'setInstrumentVoiceEnabled':
      return withLayer(s, a.id, (l) => (l.kind === 'hum' ? { ...l, instrumentVoiceEnabled: a.enabled } : l));

    case 'advanceLayer': {
      const cur = currentLayer(s);
      const instrumentVoiceEnabled = cur?.instrumentVoiceEnabled ?? false;
      const layers = cur?.kind === 'hum' && cur.pitchConfirmed !== true
        ? s.layers.map((l) => l.id === cur.id ? { ...l, pitchSemitones: 0, handPitchEnabled: false, pitchConfirmed: false } : l)
        : s.layers;
      const next = newLayer({ ...s, layers });
      return next.currentId && instrumentVoiceEnabled
        ? withLayer(next, next.currentId, (l) => ({ ...l, instrumentVoiceEnabled: true }))
        : next;
    }

    case 'setEffects': {
      const cur = currentLayer(s);
      return cur ? withLayer(s, cur.id, (l) => ({ ...l, effects: a.value })) : s;
    }

    case 'setMuted':
      return withLayer(s, a.id, (l) => ({ ...l, muted: a.muted }));

    case 'recordStart': {
      if (isRecording(s)) return s;
      // Record into the current layer, or into a fresh one when there is none (or the current one is the beat)
      const cur = currentLayer(s);
      const base = cur && cur.kind === 'hum' ? s : newLayer(s);
      return { ...base, phase: 'countIn', recordingId: base.currentId, message: '' };
    }

    case 'recordGo':
      return s.phase === 'countIn' ? { ...s, phase: 'recording' } : s;

    case 'recordEnd': {
      if (!isRecording(s) || !s.recordingId) return s;
      // A take with no notes leaves the layer as it was
      const next = a.notes.length > 0 ? withLayer(s, s.recordingId, (l) => ({ ...l, notes: a.notes, loopBeats: a.loopBeats ?? l.loopBeats, pitchSemitones: 0, handPitchEnabled: true, pitchConfirmed: false, instrumentVoiceEnabled: true })) : s;
      // the loop carries on with the new notes, unless there is still nothing to hear
      return { ...next, phase: hasAnyNotes(next) ? 'playing' : 'idle', recordingId: null, message: a.message ?? '' };
    }

    case 'recordCancel':
      return isRecording(s) ? { ...s, phase: 'idle', recordingId: null } : s;

    case 'play':
      return s.phase === 'idle' && hasAnyNotes(s) ? { ...s, phase: 'playing' } : s;

    case 'stop':
      return s.phase === 'idle' && !s.recordingId ? s : { ...s, phase: 'idle', recordingId: null };

    case 'beatOn':
      if (hasBeat(s)) return s;
      return {
        ...s,
        layers: [...s.layers, { id: BEAT_ID, name: 'Beat', kind: 'beat', instrument: 'drums', volume: DEFAULT_LAYER_VOLUME, pitchSemitones: 0, handPitchEnabled: false, pitchConfirmed: false, instrumentVoiceEnabled: false, effects: DEFAULT_EFFECT, muted: false, notes: buildBeatNotes(s.bpm, s.bars) }],
      };

    case 'loadTrack': {
      // a saved track replaces everything, but never in the middle of a take
      if (isRecording(s)) return s;
      const hum = a.layers.filter((l) => l.kind === 'hum');
      const current = hum[hum.length - 1] ?? a.layers[a.layers.length - 1];
      return { ...s, bpm: a.bpm, bars: a.bars, layers: a.layers, currentId: current?.id ?? null, phase: 'idle', recordingId: null, counter: hum.length, message: '' };
    }

    case 'beatOff': {
      if (!hasBeat(s)) return s;
      const layers = s.layers.filter((l) => l.kind !== 'beat');
      const currentId = layers.some((l) => l.id === s.currentId) ? s.currentId : (layers[layers.length - 1]?.id ?? null);
      const next = { ...s, layers, currentId };
      // nothing left to hear: the loop stops by itself (but never in the middle of a take)
      return s.phase === 'playing' && !hasAnyNotes(next) ? { ...next, phase: 'idle' } : next;
    }
  }
}

// ---- a few words for the screen and the status line ----
export function describeState(s: CreateState): string {
  const n = audibleLayers(s).length;
  const layers = `${n} layer${n === 1 ? '' : 's'}`;
  switch (s.phase) {
    case 'countIn':
      return 'Get ready: counting in one bar';
    case 'recording':
      return 'Recording: hum now';
    case 'playing':
      return `Loop playing, ${layers}`;
    case 'idle':
      return hasAnyNotes(s) ? `Stopped, ${layers} ready` : 'Ready: add a layer or press Record';
  }
}
