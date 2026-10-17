// Does transport.positionSec match what is heard? A click track goes through the engine; for every click we compare the
// moment it is heard with the song position the engine reports at that moment.
//
// Measured with the same click track (44.1 kHz, a click every 0.5 s, error = reported position minus the click's song time).
//
//                          BEFORE (engine reported its plain count)      AFTER (this test, every run)
//   speed 1.0,  pitch  0     mean  -8.0 ms, worst  8.3 ms                  mean  0.0 ms, worst  0.0 ms  (straight route: exact)
//   speed 0.5,  pitch  0     mean -50.1 ms, worst 63.8 ms                  mean -14.1 ms, worst 27.9 ms
//   speed 0.75, pitch  0     mean -24.6 ms, worst 34.6 ms                  mean  -3.2 ms, worst 13.2 ms
//   speed 1.5,  pitch  0     mean +17.0 ms, worst 40.9 ms                  mean  +2.0 ms, worst 25.9 ms
//   speed 1.0,  pitch +5     mean -32.7 ms, worst 46.0 ms                  mean  -4.1 ms, worst 17.4 ms
//   speed 0.75, pitch -5     mean  -5.9 ms, worst  6.5 ms                  mean  0.0 ms, worst  0.5 ms
//
// What is left is the stretcher itself: it repeats or skips whole pieces of about 100 ms, so the sound sits a few tens of
// milliseconds either side of a straight line and no single number can follow it exactly. The mean is what we fix.
import { describe, expect, it } from 'vitest';
import { StretchEngine } from './stretch-engine';
import { clickPositionErrors, clickTrack } from './test-utils';

const SR = 44100;

const cases: Array<{ tempo: number; semis: number; meanLimitMs: number; worstLimitMs: number }> = [
  { tempo: 1, semis: 0, meanLimitMs: 0.5, worstLimitMs: 1 }, // straight route: exact
  { tempo: 0.5, semis: 0, meanLimitMs: 15, worstLimitMs: 40 },
  { tempo: 0.75, semis: 0, meanLimitMs: 12, worstLimitMs: 30 },
  { tempo: 1.5, semis: 0, meanLimitMs: 12, worstLimitMs: 30 },
  { tempo: 1, semis: 5, meanLimitMs: 12, worstLimitMs: 30 },
  { tempo: 0.75, semis: -5, meanLimitMs: 8, worstLimitMs: 20 },
];

function measure(tempo: number, semis: number) {
  const { samples, times } = clickTrack(SR, 30, 0.5);
  const engine = new StretchEngine({ sampleRate: SR, channels: [samples] }, SR);
  engine.setTempo(tempo);
  engine.setPitchSemitones(semis);
  engine.seek(0);
  engine.play();
  const errors = clickPositionErrors(engine, SR, tempo, times).slice(2); // skip the start-up
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const worst = Math.max(...errors.map(Math.abs));
  return { n: errors.length, mean: mean * 1000, worst: worst * 1000 };
}

describe('the reported position matches what is heard', () => {
  for (const c of cases) {
    it(`speed ${c.tempo}, pitch ${c.semis}`, () => {
      const m = measure(c.tempo, c.semis);
      console.log(`position check, speed ${c.tempo} pitch ${c.semis}: ${m.n} clicks, mean error ${m.mean.toFixed(1)} ms, worst ${m.worst.toFixed(1)} ms`);
      expect(m.n).toBeGreaterThan(10);
      expect(Math.abs(m.mean)).toBeLessThan(c.meanLimitMs);
      expect(m.worst).toBeLessThan(c.worstLimitMs);
    });
  }
});
