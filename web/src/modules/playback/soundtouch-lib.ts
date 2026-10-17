// soundtouchjs ships no type declarations, so this file describes the small part we use and nothing else.
// @ts-ignore -- no declaration file in the package
import * as lib from 'soundtouchjs';

/** A pile of interleaved stereo frames (left, right, left, right ...) used by the library. */
export interface FifoBuffer {
  readonly frameCount: number;
  putSamples(samples: Float32Array, position?: number, numFrames?: number): void;
  receiveSamples(output: Float32Array, numFrames?: number): void;
  clear(): void;
}

interface RateTransposerCore {
  rate: number;
  inputBuffer: FifoBuffer;
  outputBuffer: FifoBuffer;
  process(): void;
  clear(): void;
}
interface StretchCore {
  tempo: number;
  inputBuffer: FifoBuffer;
  outputBuffer: FifoBuffer;
  setParameters(sampleRate: number, sequenceMs: number, seekWindowMs: number, overlapMs: number): void;
  process(): void;
  clear(): void;
}

/**
 * The two soundtouchjs building blocks wired in a FIXED order: resample (changes pitch and speed together),
 * then time-stretch (changes speed only). Giving the stretch the opposite tempo puts the speed back, so
 * pitch and speed are independent. The ready-made SoundTouch class swaps the order when the pitch crosses
 * zero, and that swap makes a loud click while playing, which is why we wire it ourselves.
 */
export interface StretchPipeline {
  readonly input: FifoBuffer;
  readonly output: FifoBuffer;
  /** Overall: how many input frames are used up per output frame (the tempo, times any sample-rate ratio). */
  setSpeed(speed: number): void;
  /** First stage only: input frames per output frame of the resampler (sample-rate ratio times the pitch factor). */
  setResample(ratio: number): void;
  process(): void;
  clear(): void;
}

export function createPipeline(sampleRate: number): StretchPipeline {
  const { RateTransposer, Stretch } = lib as {
    RateTransposer: new (createBuffers: boolean) => RateTransposerCore;
    Stretch: new (createBuffers: boolean) => StretchCore;
  };
  const transposer = new RateTransposer(true);
  const stretch = new Stretch(true);
  stretch.inputBuffer = transposer.outputBuffer;
  stretch.setParameters(sampleRate, 0, 0, 8);
  let speed = 1;
  let resample = 1;
  const apply = () => {
    transposer.rate = resample;
    stretch.tempo = speed / resample;
  };
  return {
    input: transposer.inputBuffer,
    output: stretch.outputBuffer,
    setSpeed(s) {
      speed = s;
      apply();
    },
    setResample(r) {
      resample = r;
      apply();
    },
    process() {
      transposer.process();
      stretch.process();
    },
    clear() {
      transposer.clear();
      stretch.clear();
    },
  };
}

// Pieces used only by the Node proof test (the ready-made SoundTouch + SimpleFilter route from the package's own docs).
interface SoundTouchCore {
  tempo: number;
  pitchSemitones: number;
}
export const SimpleFilterClass = (lib as { SimpleFilter: new (source: unknown, pipe: unknown) => { extract(target: Float32Array, numFrames: number): number } }).SimpleFilter;
export const WebAudioBufferSourceClass = (lib as { WebAudioBufferSource: new (buffer: unknown) => unknown }).WebAudioBufferSource;
export const SoundTouchClass = (lib as { SoundTouch: new () => SoundTouchCore }).SoundTouch;
