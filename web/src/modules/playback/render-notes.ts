// Turns a song analysis (its note events) into sound, so the built-in demo song can play without any audio file.
// renderNotesToSamples is the testable core and works on plain Float32Arrays; renderNotesToBuffer wraps the
// result in a Web Audio buffer for the browser. All parts are mixed; the bass part sits quieter.
import type { Note, Part, SongAnalysis } from '@/contracts';

const ATTACK_SEC = 0.012;
const RELEASE_SEC = 0.09;
const DECAY_SEC = 0.35; // how fast a held note settles from its first bright moment to its steady level
const SUSTAIN = 0.72;
const BASE_GAIN = 0.22;

/** How loud each kind of part is, so the melody stays on top and the bass stays underneath. */
function partGain(part: Part): number {
  switch (part.kind) {
    case 'bass':
      return 0.5;
    case 'harmony':
      return 0.7;
    case 'drums':
      return 0.6;
    default:
      return 1;
  }
}

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Add one soft tone (a sine with two quieter overtones) with a gentle attack, a settling decay and a short release. */
function addTone(out: Float32Array, sampleRate: number, note: Note, gain: number, bass: boolean): void {
  const freq = midiToHz(note.pitch);
  const dur = Math.max(0.03, note.duration_sec);
  const start = Math.max(0, Math.round(note.onset_sec * sampleRate));
  const end = Math.min(out.length, Math.round((note.onset_sec + dur + RELEASE_SEC) * sampleRate));
  const w = (2 * Math.PI * freq) / sampleRate;
  const amp = BASE_GAIN * gain * (note.velocity ?? 0.7);
  const h2 = bass ? 0.4 : 0.26;
  const h3 = bass ? 0.12 : 0.08;
  const attack = Math.min(ATTACK_SEC, dur / 4);
  for (let i = start; i < end; i++) {
    const t = (i - start) / sampleRate;
    let env: number;
    if (t < attack) env = t / attack;
    else if (t <= dur) env = SUSTAIN + (1 - SUSTAIN) * Math.exp(-(t - attack) / DECAY_SEC);
    else env = (SUSTAIN + (1 - SUSTAIN) * Math.exp(-(dur - attack) / DECAY_SEC)) * Math.max(0, 1 - (t - dur) / RELEASE_SEC);
    const p = w * (i - start);
    out[i] += amp * env * (Math.sin(p) + h2 * Math.sin(2 * p) + h3 * Math.sin(3 * p));
  }
}

/** A short burst of noise for drum notes (the same noise every time, so renders are repeatable). */
function addNoise(out: Float32Array, sampleRate: number, note: Note, gain: number): void {
  const start = Math.max(0, Math.round(note.onset_sec * sampleRate));
  const end = Math.min(out.length, start + Math.round(0.07 * sampleRate));
  const amp = BASE_GAIN * gain * (note.velocity ?? 0.7);
  let seed = 12345 + note.pitch;
  let prev = 0;
  for (let i = start; i < end; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const bright = noise - prev * 0.6; // takes some of the low rumble out
    prev = noise;
    out[i] += amp * bright * Math.exp(-(i - start) / (0.018 * sampleRate));
  }
}

/** Mono samples for the whole song, as long as the analysis says it is (or a little longer if a note runs past that). */
export function renderNotesToSamples(analysis: SongAnalysis, sampleRate: number): Float32Array<ArrayBuffer> {
  let lastEnd = 0;
  for (const part of analysis.parts) {
    for (const n of part.notes) {
      if (Number.isFinite(n.onset_sec) && Number.isFinite(n.duration_sec)) lastEnd = Math.max(lastEnd, n.onset_sec + n.duration_sec);
    }
  }
  const seconds = Math.max(analysis.duration_sec || 0, lastEnd + RELEASE_SEC);
  const out = new Float32Array(Math.max(1, Math.ceil(seconds * sampleRate)));
  for (const part of analysis.parts) {
    const gain = partGain(part);
    for (const note of part.notes) {
      if (!Number.isFinite(note.pitch) || !Number.isFinite(note.onset_sec) || !Number.isFinite(note.duration_sec)) continue;
      if (part.kind === 'drums') addNoise(out, sampleRate, note, gain);
      else addTone(out, sampleRate, note, gain, part.kind === 'bass');
    }
  }
  // Keep it comfortably below clipping even when many notes stack up.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.9) {
    const k = 0.9 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
  return out;
}

/** The same sound as a Web Audio buffer (one channel) ready to play in the browser. */
export function renderNotesToBuffer(analysis: SongAnalysis, sampleRate: number): AudioBuffer {
  const samples = renderNotesToSamples(analysis, sampleRate);
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: samples.length, sampleRate });
  buffer.copyToChannel(samples, 0);
  return buffer;
}
