// One shared AudioContext for the whole app (playback, create mode and the mic all use it).
// Browsers only allow audio after a click or key press, so call resumeAudio() inside such a handler.
let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  return ctx;
}

export async function resumeAudio(): Promise<AudioContext> {
  const c = getAudioContext();
  if (c.state !== 'running') await c.resume();
  return c;
}
