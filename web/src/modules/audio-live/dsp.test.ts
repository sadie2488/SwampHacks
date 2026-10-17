import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { classifyBurst, detectPitch, fft, hzToMidi, levelFromRms, rms, spectralFeatures, TransientDetector, type TransientEvent } from './dsp';
import { clapSound, clickTrain, concat, inPieces, lowpass, mix, noise, silence, sine, snapSound, voice } from './test-signals';

const RATES = [48000, 44100];
const WINDOW = 2048;

/** Pitch of every 2048-sample window of a recording, stepping by 960 samples. */
function pitchTrack(signal: Float32Array, sr: number) {
  const out = [];
  for (let at = 0; at + WINDOW <= signal.length; at += 960) out.push(detectPitch(signal.slice(at, at + WINDOW), sr));
  return out;
}

function runDetector(signal: Float32Array, sr: number): TransientEvent[] {
  const det = new TransientDetector(sr);
  const events: TransientEvent[] = [];
  inPieces(signal, (p) => events.push(...det.push(p)));
  return events;
}
const onsets = (ev: TransientEvent[]) => ev.filter((e): e is Extract<TransientEvent, { type: 'onset' }> => e.type === 'onset');
const bursts = (ev: TransientEvent[]) => ev.filter((e): e is Extract<TransientEvent, { type: 'burst' }> => e.type === 'burst');
const kinds = (ev: TransientEvent[]) => bursts(ev).map((b) => b.verdict.kind);

describe('pitch detection', () => {
  for (const sr of RATES) {
    it.each([
      [261.6256, 60],
      [440, 69],
      [880, 81],
    ])(`at ${sr} Hz sampling, a %f Hz sine is found as MIDI %i (within 0.1)`, (hz, midi) => {
      const r = detectPitch(sine(hz, 0.1, sr).slice(0, WINDOW), sr);
      expect(r.midi).not.toBeNull();
      expect(Math.abs(r.midi! - midi)).toBeLessThan(0.1);
      expect(r.clarity).toBeGreaterThan(0.95);
    });
  }

  it('converts frequency to MIDI', () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 6);
    expect(hzToMidi(261.6256)).toBeCloseTo(60, 3);
  });

  it('follows a voice-like tone with vibrato to within a few tenths of a semitone', () => {
    const sr = 48000;
    const track = pitchTrack(voice([[1.2, 64]], sr), sr);
    const found = track.filter((t) => t.midi !== null);
    expect(found.length).toBeGreaterThanOrEqual(track.length * 0.9);
    for (const t of found) expect(Math.abs(t.midi! - 64)).toBeLessThan(0.5);
    const mean = found.reduce((s, t) => s + t.midi!, 0) / found.length;
    expect(Math.abs(mean - 64)).toBeLessThan(0.1);
  });

  it('follows a voice from one note to the next', () => {
    const sr = 48000;
    const track = pitchTrack(voice([[0.6, 57], [0.6, 62]], sr), sr);
    expect(Math.abs(track[3].midi! - 57)).toBeLessThan(0.5);
    expect(Math.abs(track[track.length - 3].midi! - 62)).toBeLessThan(0.5);
  });

  it('gives no pitch for silence', () => {
    const r = detectPitch(silence(0.1, 48000).slice(0, WINDOW), 48000);
    expect(r.midi).toBeNull();
    expect(r.clarity).toBe(0);
  });

  it('gives no pitch for a tone that is too quiet to trust', () => {
    expect(detectPitch(sine(440, 0.1, 48000, 0.001).slice(0, WINDOW), 48000).midi).toBeNull();
  });

  it('gives low confidence and no pitch for noise, including muffled rumbly noise', () => {
    const lp = lowpass(500, 48000);
    const muffled = noise(1, 48000, 0.5, 2).map((x) => lp(x) * 1.5);
    for (const sig of [noise(1, 48000, 0.2), muffled]) {
      for (const t of pitchTrack(sig, 48000)) {
        expect(t.midi).toBeNull();
        expect(t.clarity).toBeLessThan(0.7);
      }
    }
  });
});

describe('loudness scale', () => {
  it('goes from 0 (silent) up to 1 (very loud) without going backwards', () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(1e-5)).toBe(0);
    expect(levelFromRms(1)).toBe(1);
    let last = -1;
    for (const r of [0.001, 0.003, 0.01, 0.03, 0.1, 0.3]) {
      const v = levelFromRms(r);
      expect(v).toBeGreaterThan(last);
      last = v;
    }
  });
  it('measures rms', () => {
    expect(rms(sine(440, 0.1, 48000, 1))).toBeCloseTo(Math.SQRT1_2, 2);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe('spectrum', () => {
  it('FFT puts a pure tone in the right place', () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 16 * i) / n);
    fft(re, im);
    const mag = Array.from(re, (r, k) => Math.hypot(r, im[k]));
    expect(mag.indexOf(Math.max(...mag.slice(0, n / 2)))).toBe(16);
  });
  it('a tone has its centre where it should and is not noise-like; noise is the opposite', () => {
    const tone = spectralFeatures(sine(1000, 0.03, 48000), 48000);
    expect(tone.centroidHz).toBeGreaterThan(900);
    expect(tone.centroidHz).toBeLessThan(1150);
    expect(tone.flatness).toBeLessThan(0.02);
    const hiss = spectralFeatures(noise(0.03, 48000), 48000);
    expect(hiss.flatness).toBeGreaterThan(0.2);
    expect(hiss.hfRatio).toBeGreaterThan(0.5);
  });
});

describe('attacks (onsets)', () => {
  for (const sr of RATES) {
    it(`finds every click in a click train at ${sr} Hz, close to when it happened`, () => {
      const sig = clickTrain(4, 0.5, sr, 0.8, 0.5); // clicks at 0.5, 1.0, ... 3.5
      const found = onsets(runDetector(sig, sr)).map((o) => o.sample / sr);
      expect(found.length).toBe(7);
      found.forEach((t, k) => expect(Math.abs(t - (0.5 + 0.5 * k))).toBeLessThan(0.008));
    });
  }

  it('does not fire for a steady tone, only for the moment it starts', () => {
    const sr = 48000;
    const sig = concat(silence(0.6, sr), sine(330, 2, sr, 0.3));
    const found = onsets(runDetector(sig, sr));
    expect(found.length).toBe(1);
    expect(Math.abs(found[0].sample / sr - 0.6)).toBeLessThan(0.01);
  });

  it('ignores quiet room noise', () => {
    expect(onsets(runDetector(noise(3, 48000, 0.005), 48000))).toEqual([]);
  });

  it('works the same however the samples are cut into pieces', () => {
    const sr = 48000;
    const sig = clickTrain(3, 0.7, sr);
    const a = onsets(runDetector(sig, sr)).map((o) => o.sample);
    const det = new TransientDetector(sr);
    const b: number[] = [];
    for (let i = 0; i < sig.length; i += 7) b.push(...onsets(det.push(sig.subarray(i, i + 7))).map((o) => o.sample));
    expect(b).toEqual(a);
  });

  it('keeps time correctly after samples were lost', () => {
    const sr = 48000;
    const det = new TransientDetector(sr);
    det.push(silence(0.5, sr));
    det.skip(sr); // one second went missing
    const found = onsets(det.push(clickTrain(1, 5, sr, 0.8, 0.2)));
    expect(found.length).toBe(1);
    expect(found[0].sample / sr).toBeCloseTo(1.5 + 0.2, 1);
  });
});

// Limits of snap vs clap (read this before trusting it):
//  - These are computer-made bursts of filtered noise. A real finger snap or clap differs with the mic, the room,
//    how far away the hands are, and the person. The thresholds in config.ts are a first guess, to be tuned live.
//  - It separates "short and bright" from "longer and broader" only. A snap with a low thump, or a flat-handed clap
//    with little sizzle, can land on the wrong side. The cooldown means two hand sounds closer than ~250 ms count as one.
//  - Other short noisy sounds can pass as a clap: a hard "t" or "k" spoken near the mic, a keyboard clack, a door.
//  - Tonal sounds (singing, humming, instruments) are rejected because they are not noise-like.
describe('snap versus clap', () => {
  for (const sr of RATES) {
    describe(`at ${sr} Hz`, () => {
      it('calls a short bright burst a snap', () => {
        for (const seed of [1, 2, 3, 4, 5]) {
          const sig = snapSound({ seconds: 1.5, at: 0.8, sr, seed });
          const ev = runDetector(sig, sr);
          expect(onsets(ev).length, `seed ${seed}`).toBe(1);
          expect(kinds(ev), `seed ${seed}`).toEqual(['snap']);
        }
      });

      it('calls a broader, longer burst a clap', () => {
        for (const seed of [1, 2, 3, 4, 5]) {
          const sig = clapSound({ seconds: 1.5, at: 0.8, sr, seed });
          const ev = runDetector(sig, sr);
          expect(onsets(ev).length, `seed ${seed}`).toBe(1);
          expect(kinds(ev), `seed ${seed}`).toEqual(['clap']);
        }
      });

      it('puts the snap higher and shorter than the clap', () => {
        const snap = bursts(runDetector(snapSound({ seconds: 1.5, at: 0.8, sr }), sr))[0].features;
        const clap = bursts(runDetector(clapSound({ seconds: 1.5, at: 0.8, sr }), sr))[0].features;
        expect(snap.centroidHz).toBeGreaterThan(clap.centroidHz);
        expect(snap.burstMs).toBeLessThan(clap.burstMs);
        expect(snap.hfRatio).toBeGreaterThan(clap.hfRatio);
      });

      it('counts two claps half a second apart as two, and one clap with a quick echo as one', () => {
        const two = mix(clapSound({ seconds: 2, at: 0.6, sr }), clapSound({ seconds: 2, at: 1.1, sr, seed: 9 }));
        expect(kinds(runDetector(two, sr))).toEqual(['clap', 'clap']);
        const echo = mix(clapSound({ seconds: 2, at: 0.6, sr }), clapSound({ seconds: 2, at: 0.75, sr, amp: 0.5, seed: 9 }));
        expect(kinds(runDetector(echo, sr)).filter((k) => k !== 'other')).toEqual(['clap']);
      });

      it('does not call a hummed note a snap or clap, but still hears the attack', () => {
        const sig = concat(silence(0.6, sr), voice([[1, 60]], sr, { amp: 0.4 }));
        const ev = runDetector(sig, sr);
        expect(onsets(ev).length).toBe(1);
        expect(kinds(ev).filter((k) => k !== 'other')).toEqual([]);
      });

      it('does not call a long hiss a snap or clap', () => {
        const sig = concat(silence(0.6, sr), noise(1, sr, 0.3));
        expect(kinds(runDetector(sig, sr)).filter((k) => k !== 'other')).toEqual([]);
      });

      it('ignores bursts that are too quiet', () => {
        const sig = clapSound({ seconds: 1.5, at: 0.8, sr, amp: 0.02 });
        expect(kinds(runDetector(sig, sr)).filter((k) => k !== 'other')).toEqual([]);
      });
    });
  }

  it('explains its decisions in plain words', () => {
    const f = { centroidHz: 800, hfRatio: 0.1, flatness: 0.001, burstMs: 40, peakRms: 0.3, jumpRatio: 20 };
    expect(classifyBurst(f).reason).toMatch(/tonal/);
    expect(classifyBurst({ ...f, flatness: 0.3, burstMs: 400 }).reason).toMatch(/too long/);
    expect(classifyBurst({ ...f, flatness: 0.3, peakRms: 0.001 }).reason).toMatch(/quiet/);
    expect(classifyBurst({ ...f, flatness: 0.3 }).kind).toBe('clap');
    expect(classifyBurst({ ...f, flatness: 0.3, centroidHz: 4500, hfRatio: 0.8, burstMs: 10 }).kind).toBe('snap');
  });

  it('keeps all the thresholds in the config', () => {
    expect(CONFIG.hand.snap.maxBurstMs).toBeLessThan(CONFIG.hand.clapMaxBurstMs);
  });
});
