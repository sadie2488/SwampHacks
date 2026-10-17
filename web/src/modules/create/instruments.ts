// The five instrument sounds, built from Tone.js synths (no sample files), and the three effects.
import * as Tone from 'tone';
import { drumPartForPitch, midiToHz, type EffectId, type InstrumentId } from './music';

export interface InstrumentVoice {
  /** Connect this to whatever comes next (effect or volume). */
  node: Tone.ToneAudioNode;
  /** Play one note at the audio time `time` (seconds on the audio clock). Velocity is 0 to 1. */
  play(pitch: number, durationSec: number, time: number, velocity: number): void;
  /** Cut any note that is still sounding. */
  silence(): void;
  dispose(): void;
}

const safePlay = (fn: () => void) => {
  try {
    fn();
  } catch {
    // Tone refuses two notes at exactly the same moment on one synth; skipping one is fine
  }
};

function polyVoice(synth: Tone.PolySynth<any>, transpose = 0): InstrumentVoice {
  synth.maxPolyphony = 8;
  return {
    node: synth,
    play: (pitch, dur, time, vel) => safePlay(() => synth.triggerAttackRelease(midiToHz(pitch + transpose), Math.max(0.05, dur), time, vel)),
    silence: () => safePlay(() => synth.releaseAll()),
    dispose: () => void synth.dispose(),
  };
}

/** Piano: a soft electric-piano sound (FM synthesis) that rings and fades. */
function piano(): InstrumentVoice {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 14,
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.7, sustain: 0.08, release: 1.2 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.5 },
  });
  synth.volume.value = -8;
  return polyVoice(synth);
}

/** Synth: a bright, slightly wide sawtooth lead. */
function synth(): InstrumentVoice {
  const s = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 25 },
    envelope: { attack: 0.03, decay: 0.2, sustain: 0.6, release: 0.5 },
  });
  s.volume.value = -14;
  return polyVoice(s);
}

/** Bass: a round, low square wave, an octave below what was hummed. */
function bass(): InstrumentVoice {
  const s = new Tone.MonoSynth({
    oscillator: { type: 'square' },
    filter: { Q: 2, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.01, decay: 0.25, sustain: 0.45, release: 0.3 },
    filterEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.15, release: 0.5, baseFrequency: 120, octaves: 3 },
  });
  s.volume.value = -6;
  return {
    node: s,
    play: (pitch, dur, time, vel) => safePlay(() => s.triggerAttackRelease(midiToHz(Math.max(24, pitch - 12)), Math.max(0.05, dur), time, vel)),
    silence: () => safePlay(() => s.triggerRelease()),
    dispose: () => void s.dispose(),
  };
}

/** Pluck: a plucked string (it plays one note at a time and fades by itself). */
function pluck(): InstrumentVoice {
  const s = new Tone.PluckSynth({ attackNoise: 1.2, dampening: 3500, resonance: 0.96 });
  s.volume.value = -2;
  return {
    node: s,
    play: (pitch, _dur, time) => safePlay(() => s.triggerAttack(midiToHz(pitch), time)),
    silence: () => {},
    dispose: () => void s.dispose(),
  };
}

/** Drums: a hummed pitch picks the drum (low = kick, middle = snare, high = hat), so any melody becomes a beat. */
function drums(): InstrumentVoice {
  const out = new Tone.Gain(1);
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.2 } }).connect(out);
  kick.volume.value = -2;
  const snareFilter = new Tone.Filter(1500, 'highpass').connect(out);
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 } }).connect(snareFilter);
  snare.volume.value = -8;
  const hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.06, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }).connect(out);
  hat.volume.value = -22;
  return {
    node: out,
    play: (pitch, _dur, time, vel) =>
      safePlay(() => {
        const part = drumPartForPitch(pitch);
        if (part === 'kick') kick.triggerAttackRelease(50, '16n', time, vel);
        else if (part === 'snare') snare.triggerAttackRelease('16n', time, vel);
        else hat.triggerAttackRelease(250, '32n', time, vel);
      }),
    silence: () => {},
    dispose: () => {
      kick.dispose();
      snare.dispose();
      snareFilter.dispose();
      hat.dispose();
      out.dispose();
    },
  };
}

export function createInstrument(id: InstrumentId): InstrumentVoice {
  switch (id) {
    case 'synth':
      return synth();
    case 'bass':
      return bass();
    case 'pluck':
      return pluck();
    case 'drums':
      return drums();
    default:
      return piano();
  }
}

/** An effect to put between an instrument and its volume, or null for "none". */
export function createEffect(id: EffectId): Tone.ToneAudioNode | null {
  switch (id) {
    case 'reverb':
      return new Tone.Reverb({ decay: 2.2, preDelay: 0.01, wet: 0.35 });
    case 'delay':
      return new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.35, wet: 0.35 });
    case 'filter':
      // a filter that sweeps open and closed once per bar
      return new Tone.AutoFilter({ frequency: '1m', baseFrequency: 250, octaves: 3.5, wet: 1 }).start();
    default:
      return null;
  }
}
