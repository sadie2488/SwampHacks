// TypeScript versions of the JSON Schemas in the repo's contracts/ folder. If a contract grows, grow this file
// the same way (additive only). tests/ and scripts/validate-contracts.mjs keep the real schemas honest.
// Notes are CONCERT-PITCH MIDI everywhere; only the display transposes. Times are song time at 1.0x tempo, in seconds.

export type Mode = 'learn' | 'play' | 'create';
export type Tonic = 'C' | 'C#' | 'Db' | 'D' | 'D#' | 'Eb' | 'E' | 'F' | 'F#' | 'Gb' | 'G' | 'G#' | 'Ab' | 'A' | 'A#' | 'Bb' | 'B';

// ---- note-event / song-analysis ----
export interface Note {
  id?: string;
  /** Concert-pitch MIDI note number (60 = middle C). */
  pitch: number;
  onset_sec: number;
  duration_sec: number;
  onset_beat?: number;
  duration_beat?: number;
  velocity?: number;
  part?: string;
  confidence?: number;
}
export interface NoteEvent extends Note {
  version: 1;
}
export interface Part {
  id: string;
  name: string;
  kind?: 'melody' | 'bass' | 'harmony' | 'drums' | 'vocals' | 'other';
  instrument?: string;
  notes: Note[];
}
export interface SongAnalysis {
  version: 1;
  song_id: string;
  title?: string;
  source?: { kind?: 'upload' | 'demo' | 'fixture'; file_name?: string };
  analyzed_at?: string;
  /** Plain-words cautions to show the person (for example: the notes may be wrong for a full band mix). */
  warnings?: string[];
  duration_sec: number;
  tempo_bpm: number;
  tempo_confidence?: number;
  beats?: number[];
  downbeats?: number[];
  key: { tonic: Tonic; mode: 'major' | 'minor'; confidence?: number };
  time_signature: { numerator: number; denominator: 1 | 2 | 4 | 8 | 16 };
  sections?: Array<{ label: string; start_sec: number; end_sec: number }>;
  parts: Part[];
}

// ---- performance-event / feedback ----
export interface PerformanceEvent {
  version: 1;
  type: 'note' | 'onset' | 'calibration';
  session_id?: string;
  /** Seconds since practice started on the mic clock. Subtract latency_offset_ms to line up with the song. */
  time_sec: number;
  pitch?: number;
  cents_off?: number;
  duration_sec?: number;
  loudness?: number;
  confidence?: number;
  /** The ONE shared latency offset from clap calibration. */
  latency_offset_ms?: number;
}
export interface Feedback {
  version: 1;
  session_id?: string;
  song_id: string;
  generated_at?: string;
  source: 'rules' | 'gemini' | 'canned';
  pending?: boolean;
  summary: string;
  tempo?: { target_bpm: number; played_bpm: number; ratio?: number; verdict: 'rushing' | 'dragging' | 'steady' };
  issues?: Array<{ kind: 'tempo' | 'pitch' | 'rhythm' | 'missed' | 'extra'; start_sec?: number; end_sec?: number; bars?: [number, number]; severity?: 'low' | 'medium' | 'high'; message: string }>;
  strengths?: string[];
  next_step?: string;
  coaching?: string;
}

// ---- signal / signal-catalog ----
export type SignalKind = 'moment' | 'slider';
export interface Signal {
  version: 1;
  /** Dotted id from the signal catalog, e.g. vision.hand.right.height or audio.clap. */
  id: string;
  kind: SignalKind;
  /** Slider position from 0 to 1 (required for sliders). */
  value?: number;
  /** The same reading in the signal's own units (see the catalog), e.g. MIDI pitch. */
  raw?: number;
  /** For moments: 'start' when it happens, 'end' when a held gesture is released. */
  state?: 'start' | 'end';
  confidence?: number;
  /** Milliseconds on the page clock (performance.now()). */
  t_ms: number;
}
export interface SignalInfo {
  id: string;
  kind: SignalKind;
  source: 'vision' | 'audio' | 'ui';
  description: string;
  range?: [number, number];
  unit?: string;
  holdable?: boolean;
  status?: 'planned' | 'fake' | 'live';
}
export interface SignalCatalog {
  version: 1;
  signals: SignalInfo[];
}

// ---- command-event / control-catalog ----
export type CommandSource = 'button' | 'voice' | 'gesture' | 'email';
export type CommandHow = 'set' | 'follow' | 'trigger' | 'toggle' | 'nudge';
export type ControlValue = number | boolean | string | [number, number];
export interface CommandEvent {
  version: 1;
  /** Control id from the control catalog, e.g. playback.tempo. */
  command: string;
  source: CommandSource;
  how?: CommandHow;
  value?: ControlValue;
  mode?: Mode;
  mapping?: string;
  signal?: string;
  t_ms: number;
}
export interface ControlInfo {
  id: string;
  kind: 'value' | 'trigger' | 'toggle';
  value_type?: 'number' | 'string' | 'range';
  modes: Mode[];
  range?: [number, number];
  default?: ControlValue;
  step?: number;
  unit?: string;
  options?: string[];
  description: string;
  status?: 'planned' | 'fake' | 'live';
}
export interface ControlCatalog {
  version: 1;
  controls: ControlInfo[];
}

// ---- mapping (Veda's mappings.yaml) ----
export interface MappingRule {
  name?: string;
  mode?: Mode | 'any';
  when: string;
  do: string;
  how: 'follow' | 'trigger' | 'toggle' | 'nudge';
  range?: [number, number];
  smoothing?: number;
  min_confidence?: number;
  cooldown_ms?: number;
  only_while?: string;
  step?: number;
  value?: ControlValue;
  enabled?: boolean;
  [extra: string]: unknown;
}

// ---- td-message (stream to TouchDesigner) ----
export interface TdHand {
  x: number;
  y: number;
  height?: number;
  fist?: boolean;
  open_palm?: boolean;
  pinch?: number;
}
export interface TdMessage {
  version: 1;
  t_ms: number;
  mode?: Mode;
  intensity?: number;
  audio: { rms: number; onset: boolean; pitch_midi?: number | null; bpm?: number; beat_phase?: number; bands?: number[] };
  hands: { left?: TdHand | null; right?: TdHand | null; distance?: number };
}
