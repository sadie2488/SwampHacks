// Gets raw samples out of a microphone stream and hands them on in order.
// First choice: a tiny AudioWorklet that sends every sample (loaded from an inline blob, so Vite has nothing to bundle).
// Fallback: polling an AnalyserNode about 50 times a second. If the worklet can't load or sends nothing, the fallback is used.
export interface Capture {
  kind: 'worklet' | 'analyser';
  stop(): void;
}
/** `lostBefore` = samples missed just before this chunk (only the polling fallback can miss some). */
export type OnSamples = (chunk: Float32Array, lostBefore: number) => void;

const WORKLET_NAME = 'audio-live-mic-tap';
const WORKLET_SOURCE = `
class MicTap extends AudioWorkletProcessor {
  constructor() { super(); this.size = 512; this.buf = new Float32Array(this.size); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', MicTap);
`;

// A processor name can only be registered once per AudioContext
const loaded = new WeakMap<BaseAudioContext, Promise<void>>();
function loadWorklet(ctx: AudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loaded.set(ctx, p);
  }
  return p;
}

const POLL_MS = 20;
const ANALYSER_SIZE = 8192; // about 170 ms of audio, so a late poll doesn't lose samples

export async function startCapture(ctx: AudioContext, stream: MediaStream, onSamples: OnSamples, watchdogMs = 1500): Promise<Capture> {
  const source = ctx.createMediaStreamSource(stream);
  let mode: Capture['kind'] = 'worklet';
  let stopWorklet = () => {};
  let stopPolling = () => {};
  let gotData = false;

  const useAnalyser = () => {
    stopWorklet();
    mode = 'analyser';
    const analyser = ctx.createAnalyser();
    analyser.fftSize = ANALYSER_SIZE;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser); // not connected to the speakers, so the mic never feeds back
    const buf = new Float32Array(ANALYSER_SIZE);
    let lastTime = ctx.currentTime;
    const timer = setInterval(() => {
      const now = ctx.currentTime;
      const elapsed = Math.round((now - lastTime) * ctx.sampleRate);
      if (elapsed <= 0) return;
      lastTime = now;
      analyser.getFloatTimeDomainData(buf);
      const n = Math.min(elapsed, ANALYSER_SIZE);
      onSamples(buf.slice(ANALYSER_SIZE - n), elapsed - n);
    }, POLL_MS);
    stopPolling = () => {
      clearInterval(timer);
      try {
        source.disconnect(analyser);
      } catch {
        // already disconnected
      }
    };
  };

  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!ctx.audioWorklet) throw new Error('AudioWorklet is not available');
    await loadWorklet(ctx);
    const node = new AudioWorkletNode(ctx, WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const mute = ctx.createGain(); // some browsers only run a node that leads to the output; this keeps it silent
    mute.gain.value = 0;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      gotData = true;
      onSamples(e.data, 0);
    };
    source.connect(node);
    node.connect(mute).connect(ctx.destination);
    let released = false;
    stopWorklet = () => {
      if (released) return;
      released = true;
      node.port.onmessage = null;
      try {
        source.disconnect(node);
        node.disconnect();
        mute.disconnect();
      } catch {
        // already disconnected
      }
    };
    watchdog = setTimeout(() => {
      if (!gotData && mode === 'worklet') {
        console.warn('[audio-live] the audio worklet sent no samples; switching to the polling fallback');
        useAnalyser();
      }
    }, watchdogMs);
  } catch (e) {
    console.warn('[audio-live] audio worklet unavailable, using the polling fallback', e);
    useAnalyser();
  }

  return {
    get kind() {
      return mode;
    },
    stop() {
      clearTimeout(watchdog);
      stopWorklet();
      stopPolling();
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
    },
  };
}
