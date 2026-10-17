// The audio core: plays a pile of samples at any speed (0.5x to 1.5x) and any pitch (-12 to +12 semitones),
// each on its own. It only works on plain Float32Arrays, so it runs (and is tested) in Node as well as in the browser.
// The browser wrappers (output.ts, and the audio worklet built by worklet-source.ts) just ask it for the next block of sound.
// The code lives in engine-core.ts (kept self-contained so it can also be copied into the audio worklet); this file
// wires it to the soundtouchjs pipeline and gives it the name the rest of the module uses.
import { defineEngine, type EngineCore, type PcmSource } from './engine-core';
import { createPipeline } from './soundtouch-lib';

export type { EngineCore, LoopRegion, PcmSource } from './engine-core';

export type StretchEngine = EngineCore;

const makeEngine = defineEngine(createPipeline);

/** `new StretchEngine(source, speakerSampleRate)` */
export const StretchEngine: new (source: PcmSource, outSampleRate: number) => EngineCore = function StretchEngine(source: PcmSource, outSampleRate: number) {
  return makeEngine(source, outSampleRate);
} as never;
