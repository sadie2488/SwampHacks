// Builds the frames streamed to TouchDesigner (the td-message contract). Everything here is plain logic with no bus, timers or
// browser calls, so it can be tested alone. The "tracker" remembers the latest value of everything we listen to;
// buildFrame() turns that memory into one valid frame.
// Keep imports type-only: the relay tests load this file directly with Node.
import type { ControlValue, Mode, Signal, TdHand, TdMessage } from '@/contracts';

/** A hand that has not been seen for this long counts as gone (its entry in the frame becomes null). */
export const HAND_TIMEOUT_MS = 500;
/** Mic readings older than this are ignored (the mic went quiet or was switched off). */
export const AUDIO_FRESH_MS = 500;

export type Side = 'left' | 'right';

export interface HandMemory {
  /** Left-to-right position, 0 = left edge. */
  x?: number;
  /** 1 = top of the picture. */
  height?: number;
  fist: boolean;
  openPalm: boolean;
  pinch: boolean;
  /** When (our clock) a reading for this hand last arrived, or null if never. */
  seenAt: number | null;
}

export interface TdState {
  mode?: Mode;
  controls: Record<string, ControlValue>;
  pitch?: { midi: number | null; rms: number; at: number };
  loudness?: { value: number; at: number };
  transport?: { bpm?: number; beatPhase?: number };
  /** An audio.onset arrived and has not been put in a frame yet. */
  onsetPending: boolean;
  hands: Record<Side, HandMemory>;
  distance?: { value: number; at: number };
  /** Eight frequency bands (0 to 1) of the playing song (the bus "songLevels" topic); until they arrive, frames carry zeros. */
  bands?: number[];
}

const newHand = (): HandMemory => ({ fist: false, openPalm: false, pinch: false, seenAt: null });

export function emptyState(): TdState {
  return { controls: {}, onsetPending: false, hands: { left: newHand(), right: newHand() } };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
/** Keep frames small: three decimals is plenty for visuals. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const unit = (n: number) => r3(clamp01(n));

function handFrame(h: HandMemory, now: number): TdHand | null {
  if (h.seenAt === null || now - h.seenAt > HAND_TIMEOUT_MS) return null;
  const height = unit(h.height ?? 0.5);
  return {
    x: unit(h.x ?? 0.5),
    y: r3(1 - height),
    height,
    fist: h.fist,
    open_palm: h.openPalm,
    pinch: h.pinch ? 1 : 0,
  };
}

/** One frame from the latest state. `now` is the page clock in milliseconds. Does not change the state. */
export function buildFrame(state: TdState, now: number): TdMessage {
  const pitchFresh = state.pitch && now - state.pitch.at <= AUDIO_FRESH_MS ? state.pitch : undefined;
  const loudFresh = state.loudness && now - state.loudness.at <= AUDIO_FRESH_MS ? state.loudness : undefined;
  const audio: TdMessage['audio'] = {
    // the louder of the mic frame's rms and the audio.loudness signal, whichever are recent
    rms: unit(Math.max(pitchFresh?.rms ?? 0, loudFresh?.value ?? 0)),
    onset: state.onsetPending,
    pitch_midi: pitchFresh && pitchFresh.midi !== null && Number.isFinite(pitchFresh.midi) ? r3(pitchFresh.midi) : null,
  };
  const t = state.transport;
  if (t?.bpm !== undefined && Number.isFinite(t.bpm)) audio.bpm = r3(Math.max(0, t.bpm));
  if (t?.beatPhase !== undefined && Number.isFinite(t.beatPhase)) audio.beat_phase = unit(t.beatPhase);
  audio.bands = state.bands && state.bands.length === 8 ? state.bands.map(unit) : [0, 0, 0, 0, 0, 0, 0, 0];

  const hands: TdMessage['hands'] = { left: handFrame(state.hands.left, now), right: handFrame(state.hands.right, now) };
  if (state.distance && now - state.distance.at <= HAND_TIMEOUT_MS) hands.distance = unit(state.distance.value);

  const frame: TdMessage = { version: 1, t_ms: r3(Math.max(0, now)), audio, hands };
  if (state.mode) frame.mode = state.mode;
  const intensity = state.controls['visual.intensity'];
  if (typeof intensity === 'number') frame.intensity = unit(intensity);
  return frame;
}

const HAND_SIGNAL = /^vision\.hand\.(left|right)\.([a-z_]+)$/;

/** Remembers the latest bus values and hands out frames. `now` is the page clock (performance.now in the browser). */
export function createTracker(now: () => number) {
  const state = emptyState();

  function onSignal(sig: Signal): void {
    const t = now();
    if (sig.id === 'audio.onset') {
      if (sig.state !== 'end') state.onsetPending = true;
    } else if (sig.id === 'audio.loudness') {
      if (typeof sig.value === 'number') state.loudness = { value: sig.value, at: t };
    } else if (sig.id === 'vision.hands.distance') {
      if (typeof sig.value === 'number') state.distance = { value: sig.value, at: t };
    } else {
      const m = HAND_SIGNAL.exec(sig.id);
      if (m) onHandSignal(state.hands[m[1] as Side], m[2], sig, t);
    }
  }

  function onHandSignal(h: HandMemory, what: string, sig: Signal, t: number): void {
    const held = sig.state === 'start' ? true : sig.state === 'end' ? false : undefined;
    // The end of a gesture is not a sighting: the hand may be leaving the picture.
    if (held === false) {
      if (what === 'fist') h.fist = false;
      else if (what === 'open_palm') h.openPalm = false;
      else if (what === 'pinch') h.pinch = false;
      return;
    }
    // A hand that comes back after being gone starts fresh, so old gestures don't linger.
    if (h.seenAt === null || t - h.seenAt > HAND_TIMEOUT_MS) {
      h.x = undefined;
      h.height = undefined;
      h.fist = h.openPalm = h.pinch = false;
    }
    h.seenAt = t;
    if (what === 'x' && typeof sig.value === 'number') h.x = sig.value;
    else if (what === 'height' && typeof sig.value === 'number') h.height = sig.value;
    else if (held === true) {
      if (what === 'fist') h.fist = true;
      else if (what === 'open_palm') h.openPalm = true;
      else if (what === 'pinch') h.pinch = true;
    }
  }

  return {
    state,
    setMode(mode: Mode): void {
      state.mode = mode;
    },
    setControls(controls: Record<string, ControlValue>): void {
      state.controls = controls;
    },
    onPitch(p: { midi: number | null; rms: number }): void {
      state.pitch = { midi: p.midi, rms: p.rms, at: now() };
    },
    /** The playing song's levels. Playback publishes zeros when it pauses or stops, so these never go stale. */
    onSongLevels(levels: { bands: number[] }): void {
      state.bands = levels.bands;
    },
    onTransport(tr: { bpm?: number; beatPhase?: number }): void {
      state.transport = { bpm: tr.bpm, beatPhase: tr.beatPhase };
    },
    onSignal,
    /** The next frame. An onset shows up in exactly one frame. */
    frame(): TdMessage {
      const frame = buildFrame(state, now());
      state.onsetPending = false;
      return frame;
    },
  };
}
export type Tracker = ReturnType<typeof createTracker>;
