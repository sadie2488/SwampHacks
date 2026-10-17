// A pretend hum, so Create mode can be tried without a microphone: a short rising three-note melody over about 2 seconds,
// sent as pitch frames (about 50 per second) just like the real pitch detector would.
import type { PitchFrame } from '@/bus';

export const FAKE_FRAME_MS = 20;

/** G3, C4, G4: low, middle, high, so the "drums" instrument gets a kick, a snare and a hat out of it. */
export const FAKE_MELODY = [
  { midi: 55, ms: 600 },
  { midi: 60, ms: 600 },
  { midi: 67, ms: 700 },
];
const GAP_MS = 50;

/** The whole fake hum as frames, with times starting at startMs. Slight vibrato and wobble, a short silence between notes. */
export function fakeHumFrames(startMs = 0): PitchFrame[] {
  const frames: PitchFrame[] = [];
  let t = 0;
  let wobble = 0;
  const push = (midi: number | null) => {
    frames.push({ t_ms: startMs + t, midi, confidence: midi === null ? 0.1 : 0.92, rms: midi === null ? 0.002 : 0.12 });
    t += FAKE_FRAME_MS;
  };
  FAKE_MELODY.forEach((note, i) => {
    const count = Math.round(note.ms / FAKE_FRAME_MS);
    for (let k = 0; k < count; k++) {
      wobble = (wobble * 7 + 13) % 11; // fixed pseudo-random wobble so the fake hum is the same every time
      const vibrato = Math.sin((2 * Math.PI * 5.5 * (k * FAKE_FRAME_MS)) / 1000) * 0.25;
      push(note.midi + vibrato + (wobble - 5) * 0.012);
    }
    if (i < FAKE_MELODY.length - 1) for (let k = 0; k < GAP_MS / FAKE_FRAME_MS; k++) push(null);
  });
  push(null);
  return frames;
}

/**
 * Play the fake hum in real time: `emit` gets each frame when its time comes (t_ms is set to the real time).
 * Returns a function that cancels what has not been sent yet.
 */
export function playFakeHum(emit: (frame: PitchFrame) => void, onDone?: () => void): () => void {
  const frames = fakeHumFrames(0);
  const began = performance.now();
  let next = 0;
  const timer = setInterval(() => {
    const elapsed = performance.now() - began;
    while (next < frames.length && frames[next].t_ms <= elapsed) {
      emit({ ...frames[next], t_ms: began + frames[next].t_ms });
      next++;
    }
    if (next >= frames.length) {
      clearInterval(timer);
      onDone?.();
    }
  }, FAKE_FRAME_MS / 2);
  return () => clearInterval(timer);
}
