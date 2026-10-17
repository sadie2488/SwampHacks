// The text of the audio worklet module: the soundtouchjs library, the sound engine (engine-core.ts), the message logic
// (worklet-core.ts) and a tiny AudioWorkletProcessor shell, glued into one script that is loaded from an inline Blob URL.
// Same idea as audio-live/capture.ts: nothing for Vite to bundle, so it works the same in dev and in the built site.
//
// The engine and the message logic are written as normal TypeScript (and tested as such). Here their compiled text is
// copied into the script with Function.toString(), which only works because those functions are self-contained.
// selfTestWorkletSource() proves that on the real, built code before the page trusts the worklet with the sound.
import soundtouchSource from '../../../node_modules/soundtouchjs/dist/soundtouch.js?raw';
import { defineEngine } from './engine-core';
import { makePipelineFactory } from './soundtouch-lib';
import { defineWorkletCore, type FromWorklet, type ToWorklet } from './worklet-core';

export const WORKLET_NAME = 'playback-engine';

/** The library without its `export` line and its source-map comment (the pieces we need are plain classes at the top). */
function librarySource(): string {
  return soundtouchSource.replace(/^export\s*\{[\s\S]*?\};?\s*$/m, '').replace(/^\/\/# sourceMappingURL=.*$/m, '');
}

export function buildWorkletSource(): string {
  return `${librarySource()}
const __pipelineFactory = (${makePipelineFactory.toString()});
const __engineFactory = (${defineEngine.toString()});
const __coreFactory = (${defineWorkletCore.toString()});
const __createEngine = __engineFactory(__pipelineFactory({ RateTransposer, Stretch }));
const __createCore = __coreFactory(__createEngine);
class PlaybackEngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = __createCore({ post: (m) => this.port.postMessage(m), sampleRate: sampleRate, time: () => currentTime });
    this.port.onmessage = (e) => this.core.handle(e.data);
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (out && out[0]) this.core.render(out[0], out[1] || out[0], out[0].length);
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', PlaybackEngineProcessor);
`;
}

/** What a worklet script sees, made by hand so the script can be run (and tested) on the page or in Node. */
export interface FakeWorkletScope {
  /** Send a message to the processor, the way the page's port would. */
  send(message: ToWorklet): void;
  /** Ask it for one block of sound, the way the audio thread would. */
  render(frames: number): { left: Float32Array; right: Float32Array };
  /** Everything it has posted back so far. */
  readonly posted: FromWorklet[];
}

interface FakeNode {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown): void };
  process(inputs: unknown, outputs: Float32Array[][]): boolean;
}

/** Run the worklet script against pretend worklet globals. Throws if the script is broken. */
export function runWorkletSource(source: string, sampleRate: number): FakeWorkletScope {
  const posted: FromWorklet[] = [];
  let registered: (new () => FakeNode) | null = null;
  class FakeProcessor {
    port = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      postMessage: (m: unknown) => {
        posted.push(m as FromWorklet);
      },
    };
  }
  const register = (name: string, ctor: unknown) => {
    if (name !== WORKLET_NAME) throw new Error(`The worklet registered "${name}" instead of "${WORKLET_NAME}".`);
    registered = ctor as new () => FakeNode;
  };
  // currentTime is a plain number to the script, so the clock the worklet reports stays at 0 in a dry run; that is fine here.
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime', source)(FakeProcessor, register, sampleRate, 0);
  if (!registered) throw new Error('The worklet never registered its processor.');
  const node = new (registered as new () => FakeNode)();
  return {
    posted,
    send(message) {
      node.port.onmessage?.({ data: message });
    },
    render(frames) {
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      node.process([], [[left, right]]);
      return { left, right };
    },
  };
}

/**
 * Dry run on the real script text: load a short ramp, play it, and check that sound comes out, the position comes
 * back, and nothing throws. Returns a plain-English problem, or null when the script works.
 * (If the page's security rules forbid building a function from text, the dry run cannot happen and we say "fine":
 * the live watchdog in output.ts still catches a worklet that does nothing.)
 */
export function selfTestWorkletSource(source: string = buildWorkletSource()): string | null {
  const rate = 48000;
  let scope: FakeWorkletScope;
  try {
    scope = runWorkletSource(source, rate);
  } catch (e) {
    if (e instanceof EvalError) return null;
    return `The audio worklet script does not run: ${e instanceof Error ? e.message : String(e)}`;
  }
  try {
    const ramp = new Float32Array(rate);
    for (let i = 0; i < ramp.length; i++) ramp[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate);
    scope.send({ type: 'load', epoch: 1, sampleRate: rate, left: ramp, right: null });
    scope.send({ type: 'play' });
    let loudest = 0;
    for (let b = 0; b < 40; b++) {
      const { left } = scope.render(128);
      for (let i = 0; i < left.length; i++) loudest = Math.max(loudest, Math.abs(left[i]));
    }
    if (scope.posted.some((m) => m.type === 'error')) return 'The audio worklet reported an error while playing a test tone.';
    if (!scope.posted.some((m) => m.type === 'ready')) return 'The audio worklet did not say it was ready.';
    if (!(loudest > 0.1)) return 'The audio worklet made no sound for a test tone.';
    // and the stretcher route, which uses the part of the engine that is most likely to break when the build rewrites code
    scope.send({ type: 'tempo', value: 0.75 });
    scope.send({ type: 'pitch', value: 3 });
    loudest = 0;
    for (let b = 0; b < 120; b++) {
      const { left } = scope.render(128);
      for (let i = 0; i < left.length; i++) loudest = Math.max(loudest, Math.abs(left[i]));
    }
    if (scope.posted.some((m) => m.type === 'error')) return 'The audio worklet reported an error while stretching a test tone.';
    if (!(loudest > 0.1)) return 'The audio worklet made no sound while stretching a test tone.';
    return null;
  } catch (e) {
    return `The audio worklet script failed its test: ${e instanceof Error ? e.message : String(e)}`;
  }
}
