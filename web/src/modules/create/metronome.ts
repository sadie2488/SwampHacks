// Where the metronome clicks while a take is recorded. Pure: the sound engine turns these into transport events.
import { BEATS_PER_BAR } from './music';

export interface MetronomeTick {
  /** Transport position "bar:beat:0". */
  position: string;
  /** Beat 1 of a bar is louder. */
  accent: boolean;
  /** Beat number within the whole take, from 0. */
  index: number;
}

/** One click on every beat of the take: `bars` bars starting at loop-clock bar `goBar`. */
export function takeMetronome(goBar: number, bars: number): MetronomeTick[] {
  const ticks: MetronomeTick[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
      ticks.push({ position: `${goBar + bar}:${beat}:0`, accent: beat === 0, index: bar * BEATS_PER_BAR + beat });
    }
  }
  return ticks;
}

/** The number shown on screen for count-in click `beat` (0 to 3): "4, 3, 2, 1". */
export const countNumber = (beat: number): number => BEATS_PER_BAR - beat;
