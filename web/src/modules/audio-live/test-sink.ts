// A sink that remembers everything it was told, for tests in this folder.
import type { PitchFrame } from '@/bus';
import type { PerformanceEvent } from '@/contracts';
import type { Sink } from './sink';

export interface Recorded {
  pitch: PitchFrame[];
  loudness: Array<{ value: number; tMs: number }>;
  hum: Array<{ value: number; midi: number; confidence: number; tMs: number }>;
  onset: Array<{ confidence: number; tMs: number }>;
  hand: Array<{ kind: 'snap' | 'clap'; confidence: number; tMs: number }>;
  performance: PerformanceEvent[];
}

export function recordingSink(): { sink: Sink; log: Recorded } {
  const log: Recorded = { pitch: [], loudness: [], hum: [], onset: [], hand: [], performance: [] };
  const sink: Sink = {
    pitch: (frame) => log.pitch.push(frame),
    loudness: (value, tMs) => log.loudness.push({ value, tMs }),
    hum: (value, midi, confidence, tMs) => log.hum.push({ value, midi, confidence, tMs }),
    onset: (confidence, tMs) => log.onset.push({ confidence, tMs }),
    hand: (kind, confidence, tMs) => log.hand.push({ kind, confidence, tMs }),
    performance: (event) => log.performance.push(event),
  };
  return { sink, log };
}
