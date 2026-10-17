// The key requirement, proven with numbers: change the speed WITHOUT changing the pitch, and change the pitch
// WITHOUT changing the speed, each on its own. A 440 Hz tone goes in; we measure the frequency and the length coming out.
// Part 1 runs the soundtouchjs core the documented way. Part 2 runs the same cases through our own engine (what the app uses).
import { describe, expect, it } from 'vitest';
import { StretchEngine } from './stretch-engine';
import { SimpleFilterClass, SoundTouchClass, WebAudioBufferSourceClass } from './soundtouch-lib';
import { activeRange, dominantFreq, sine, zeroCrossingFreq } from './test-utils';

const SR = 44100;
const IN_SEC = 4;
const input = sine(440, IN_SEC, SR);

interface Case {
  name: string;
  tempo: number;
  semis: number;
}
const cases: Case[] = [
  { name: 'tempo 0.5', tempo: 0.5, semis: 0 },
  { name: 'tempo 1.5', tempo: 1.5, semis: 0 },
  { name: 'pitch +12', tempo: 1, semis: 12 },
  { name: 'pitch -12', tempo: 1, semis: -12 },
  { name: 'tempo 0.5 + pitch +12', tempo: 0.5, semis: 12 },
  { name: 'tempo 1.5 + pitch -12', tempo: 1.5, semis: -12 },
  { name: 'tempo 0.8 + pitch +7', tempo: 0.8, semis: 7 },
];

function viaLibrary(tempo: number, semis: number): Float32Array {
  const st = new SoundTouchClass();
  st.tempo = tempo;
  st.pitchSemitones = semis;
  const source = new WebAudioBufferSourceClass({ numberOfChannels: 1, getChannelData: () => input });
  const filter = new SimpleFilterClass(source, st);
  const chunks: Float32Array[] = [];
  const buf = new Float32Array(4096 * 2);
  for (;;) {
    const got = filter.extract(buf, 4096);
    if (got === 0) break;
    const left = new Float32Array(got);
    for (let i = 0; i < got; i++) left[i] = buf[2 * i];
    chunks.push(left);
  }
  const out = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function viaEngine(tempo: number, semis: number): Float32Array {
  const engine = new StretchEngine({ sampleRate: SR, channels: [input] }, SR);
  engine.setTempo(tempo);
  engine.setPitchSemitones(semis);
  engine.seek(0); // start from the very beginning with the settings already in place
  engine.play();
  const L = new Float32Array(2048);
  const R = new Float32Array(2048);
  const out: number[] = [];
  let guard = 0;
  while (!engine.ended && guard++ < 2000) {
    engine.render(L, R, L.length);
    for (let i = 0; i < L.length; i++) out.push(L[i]);
  }
  return Float32Array.from(out);
}

function measure(out: Float32Array, want: number) {
  const [first, last] = activeRange(out);
  const span = last - first;
  const a = first + Math.floor(span * 0.25);
  const b = first + Math.floor(span * 0.75);
  return {
    zc: zeroCrossingFreq(out, SR, a, b),
    fft: dominantFreq(out, SR, want * 0.7, want * 1.4, a, Math.min(b, a + SR / 4)),
    sec: span / SR,
  };
}

const rows: string[] = [];

describe('soundtouchjs core: tempo and pitch are independent', () => {
  for (const c of cases) {
    it(c.name, () => {
      const wantFreq = 440 * 2 ** (c.semis / 12);
      const m = measure(viaLibrary(c.tempo, c.semis), wantFreq);
      // The ready-made SimpleFilter never plays the last part of its input (its buffers are never flushed), so the
      // length comes out a little short or off; the exact length check is on our engine below, which flushes properly.
      const wantSec = IN_SEC / c.tempo;
      rows.push(`library | ${c.name.padEnd(24)} | zero-crossing ${m.zc.toFixed(1)} Hz | spectrum ${m.fft.toFixed(1)} Hz | want ${wantFreq.toFixed(1)} Hz | length ${m.sec.toFixed(2)} s (want ${wantSec.toFixed(2)})`);
      expect(Math.abs(m.zc / wantFreq - 1)).toBeLessThan(0.01);
      expect(Math.abs(m.fft / wantFreq - 1)).toBeLessThan(0.01);
      expect(m.sec / wantSec).toBeGreaterThan(0.85);
      expect(m.sec / wantSec).toBeLessThan(1.04);
    });
  }
});

describe('our engine (the one the app uses): tempo and pitch are independent', () => {
  for (const c of cases) {
    it(c.name, () => {
      const wantFreq = 440 * 2 ** (c.semis / 12);
      const m = measure(viaEngine(c.tempo, c.semis), wantFreq);
      const wantSec = IN_SEC / c.tempo;
      rows.push(`engine  | ${c.name.padEnd(24)} | zero-crossing ${m.zc.toFixed(1)} Hz | spectrum ${m.fft.toFixed(1)} Hz | want ${wantFreq.toFixed(1)} Hz | length ${m.sec.toFixed(2)} s (want ${wantSec.toFixed(2)})`);
      expect(Math.abs(m.zc / wantFreq - 1)).toBeLessThan(0.01);
      expect(Math.abs(m.fft / wantFreq - 1)).toBeLessThan(0.01);
      expect(Math.abs(m.sec / wantSec - 1)).toBeLessThan(0.015);
    });
  }

  it('prints the measured numbers', () => {
    console.log('\nMEASURED (input: 4.00 s of 440 Hz at 44100 Hz)\n' + rows.join('\n'));
    expect(rows.length).toBeGreaterThan(0);
  });
});
