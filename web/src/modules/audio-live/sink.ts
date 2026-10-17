// Where the finished readings go. The analyzer talks to a Sink so tests can record what it says,
// and the real one (busSink) publishes on the bus.
import { bus, sendSignal, type PitchFrame } from '@/bus';
import type { PerformanceEvent } from '@/contracts';

export interface Sink {
  /** A pitch frame (about 50 per second, midi is null when there is no clear pitch). */
  pitch(frame: PitchFrame): void;
  /** audio.loudness, 0..1. */
  loudness(value: number, tMs: number): void;
  /** audio.hum.pitch: value 0..1, midi is the raw number. */
  hum(value: number, midi: number, confidence: number, tMs: number): void;
  /** audio.onset. */
  onset(confidence: number, tMs: number): void;
  /** audio.snap or audio.clap. */
  hand(kind: 'snap' | 'clap', confidence: number, tMs: number): void;
  /** A note or onset for the feedback code. */
  performance(event: PerformanceEvent): void;
}

export const busSink: Sink = {
  pitch: (frame) => bus.emit('pitch', frame),
  loudness: (value, tMs) => sendSignal({ id: 'audio.loudness', kind: 'slider', value, t_ms: tMs }),
  hum: (value, midi, confidence, tMs) => sendSignal({ id: 'audio.hum.pitch', kind: 'slider', value, raw: midi, confidence, t_ms: tMs }),
  onset: (confidence, tMs) => sendSignal({ id: 'audio.onset', kind: 'moment', state: 'start', confidence, t_ms: tMs }),
  hand: (kind, confidence, tMs) => sendSignal({ id: `audio.${kind}`, kind: 'moment', state: 'start', confidence, t_ms: tMs }),
  performance: (event) => bus.emit('performance', event),
};
