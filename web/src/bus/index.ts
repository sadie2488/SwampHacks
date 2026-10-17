// The event bus: how the modules talk to each other without importing each other's insides.
// Everything that crosses a module boundary is a typed topic below. Publish with bus.emit, listen with bus.on.
//
// WHO PUBLISHES WHAT (and who listens)
//   mode            shell        -> commands, create, touchdesigner      the current mode (learn | play | create)
//   songAudio       shell        -> playback                              decoded audio of an uploaded file
//   analysis        shell        -> playback, sheet, touchdesigner        the song-analysis result (fake or real)
//   transport       playback     -> shell, sheet, command lab, touchdesigner   what is playing right now
//   signal          vision, audio-live (and fixture replays) -> commands, command lab, create, touchdesigner
//   landmarks       vision       -> command lab (tracking overlay)
//   cameraStream    vision       -> command lab (shows the live camera; null when the camera is off)
//   pitch           audio-live   -> create, touchdesigner, command lab     frame-by-frame pitch of the mic (about 50 per second)
//   performance     audio-live   -> (feedback, later)                     detected notes and onsets
//   command         buttons (shell), commands engine, email -> everybody who reacts to a control
//   controls        the bus itself (see below) -> playback, create, touchdesigner, command lab   latest value of every control
//   fired           commands     -> command lab                          a mapping rule just fired (light it up)
//   issues          commands     -> command lab, shell                    mapping errors and warnings (friendly text)
//   td              touchdesigner -> (its own sender)                     the td-message frame being streamed
//   status          every module -> shell                                 idle | starting | running | error, with a plain message
//   enable          shell        -> vision, audio-live, touchdesigner     turn a device-using module on or off (needs a click first)
//
// STATE vs EVENTS: "controls" holds the current value of each control (tempo, pitch, volume, loop...). The bus updates it
// from every "command" event using one shared rule (see controls.ts), so modules just read "controls" for absolute values and
// use "command" only for triggers (playback.play, playback.pause, playback.toggle, create.layer.add, create.loop.stop).
//
// Autoplay rule: browsers only start audio after a click. Call resumeAudio() inside a click or key handler.
import { controlCatalog } from '@/contracts/catalogs';
import type { CommandEvent, CommandHow, CommandSource, Mode, PerformanceEvent, Signal, SongAnalysis, TdMessage } from '@/contracts';
import { defaultControls, nextControlValue, type ControlState } from './controls';

export type { ControlState } from './controls';
export { getAudioContext, resumeAudio } from './audio-context';
export type Stop = () => void;

export interface TransportState {
  loaded: boolean;
  songId?: string;
  playing: boolean;
  /** Where we are in the song, in song seconds at 1.0x tempo. */
  positionSec: number;
  durationSec: number;
  /** Playback speed factor (1 = original), without changing pitch. */
  tempo: number;
  /** Pitch shift in semitones. */
  pitch: number;
  volume: number;
  loop: boolean;
  loopSection: [number, number] | null;
  /** Beats per minute right now (song tempo x speed factor). */
  bpm?: number;
  /** Position inside the current beat, 0 to 1. */
  beatPhase?: number;
}
export interface PitchFrame {
  t_ms: number;
  /** Detected concert-pitch MIDI (may have a fraction), or null when there is no clear pitch. */
  midi: number | null;
  confidence: number;
  rms: number;
}
export interface Landmarks {
  t_ms: number;
  /** Size of the camera image these points refer to (points are 0-1 across the image). */
  width: number;
  height: number;
  hands: Array<{ handedness: 'Left' | 'Right'; points: Array<{ x: number; y: number; z: number }> }>;
  face?: { points: Array<{ x: number; y: number; z: number }> };
}
export interface EngineIssue {
  level: 'error' | 'warning';
  /** Where it is, e.g. "rule 3 (clap toggles play/pause)". */
  where: string;
  /** Friendly explanation a non-programmer can act on. */
  message: string;
}
export interface ModuleStatus {
  module: string;
  state: 'idle' | 'starting' | 'running' | 'error';
  message?: string;
}
export type EnableTarget = 'vision' | 'audio-live' | 'touchdesigner';

export interface Topics {
  mode: Mode;
  songAudio: { songId: string; buffer: AudioBuffer; fileName?: string };
  analysis: SongAnalysis;
  transport: TransportState;
  signal: Signal;
  landmarks: Landmarks;
  cameraStream: MediaStream | null;
  pitch: PitchFrame;
  performance: PerformanceEvent;
  command: CommandEvent;
  controls: ControlState;
  fired: { mapping: string; command: CommandEvent };
  issues: EngineIssue[];
  td: TdMessage;
  status: ModuleStatus;
  enable: { module: EnableTarget; on: boolean };
}

type Handler<V> = (value: V) => void;

export function createBus<T extends object>() {
  const handlers = new Map<keyof T, Set<Handler<never>>>();
  const lastValue = new Map<keyof T, unknown>();
  return {
    /** Publish a value. Handlers that throw don't stop the others. */
    emit<K extends keyof T>(topic: K, value: T[K]): void {
      lastValue.set(topic, value);
      for (const h of [...(handlers.get(topic) ?? [])]) {
        try {
          (h as Handler<T[K]>)(value);
        } catch (e) {
          console.error(`[bus] a "${String(topic)}" listener threw`, e);
        }
      }
    },
    /** Listen. Returns a function that stops listening. With { replay: true } you also get the latest value right away. */
    on<K extends keyof T>(topic: K, handler: Handler<T[K]>, opts: { replay?: boolean } = {}): Stop {
      let set = handlers.get(topic);
      if (!set) handlers.set(topic, (set = new Set()));
      set.add(handler as Handler<never>);
      if (opts.replay && lastValue.has(topic)) handler(lastValue.get(topic) as T[K]);
      return () => void set!.delete(handler as Handler<never>);
    },
    /** The most recent value published on a topic, or undefined. */
    last<K extends keyof T>(topic: K): T[K] | undefined {
      return lastValue.get(topic) as T[K] | undefined;
    },
    /** Forget everything (used by tests). */
    reset(): void {
      handlers.clear();
      lastValue.clear();
    },
  };
}

export const bus = createBus<Topics>();

// ---- controls: the bus keeps the current value of every control, updated from every command ----
let controlState: ControlState = defaultControls(controlCatalog.controls);
bus.emit('controls', controlState);
bus.on('command', (cmd) => {
  const next = nextControlValue(controlState[cmd.command], cmd);
  if (next === undefined) return;
  const prev = controlState[cmd.command];
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  controlState = { ...controlState, [cmd.command]: next };
  bus.emit('controls', controlState);
});
/** Put every control back to its default (used by tests and a "reset" button). */
export function resetControls(): void {
  controlState = defaultControls(controlCatalog.controls);
  bus.emit('controls', controlState);
}

// ---- helpers ----
/** Send a command, filling in version and time. Buttons use source "button". */
export function sendCommand(command: string, source: CommandSource, extra: { how?: CommandHow; value?: CommandEvent['value']; mode?: Mode; mapping?: string; signal?: string } = {}): void {
  bus.emit('command', { version: 1, command, source, t_ms: performance.now(), ...extra });
}

/** Publish a signal reading. Fills in version and time. */
export function sendSignal(s: Omit<Signal, 'version' | 't_ms'> & { t_ms?: number }): void {
  bus.emit('signal', { version: 1, t_ms: performance.now(), ...s });
}

/** Tell the shell how a module is doing, in plain words. */
export function reportStatus(module: string, state: ModuleStatus['state'], message?: string): void {
  bus.emit('status', { module, state, message });
}

/** True when the page was opened with ?fake=1: modules replay fixtures instead of using the camera or mic. */
export const isFakeMode = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).has('fake');

// Handy for the browser console and the lead's browser tests, e.g. window.__music.bus.last('transport')
if (typeof window !== 'undefined') (window as unknown as { __music?: unknown }).__music = { bus, sendCommand, sendSignal };
