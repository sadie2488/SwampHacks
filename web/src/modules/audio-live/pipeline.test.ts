import { describe, expect, it } from 'vitest';
import { Analyzer } from './analyzer';
import { CONFIG } from './config';
import { MicPipeline } from './pipeline';
import { recordingSink } from './test-sink';
import { clapSound, concat, inPieces, mix, silence, snapSound, voice } from './test-signals';

/** Half a second of quiet, a hummed C, a gap, a hummed E, a clap, then a snap. */
CONFIG.debug = false; // the pipeline explains each loud sound in the console; keep test output quiet

function session(sr: number) {
  const hum = concat(silence(0.5, sr), voice([[0.6, 60]], sr), silence(0.4, sr), voice([[0.6, 64]], sr), silence(0.5, sr));
  const total = hum.length / sr + 2.5;
  const withHands = mix(concat(hum, silence(2.5, sr)), clapSound({ seconds: total, at: 3.1, sr }), snapSound({ seconds: total, at: 4.3, sr }));
  return { signal: withHands, seconds: total };
}

function run(sr: number) {
  const { sink, log } = recordingSink();
  const analyzer = new Analyzer(sink, 10_000);
  const pipeline = new MicPipeline(sr, analyzer);
  const { signal, seconds } = session(sr);
  inPieces(signal, (p) => pipeline.push(p));
  analyzer.flush();
  return { log, seconds, pipeline };
}

for (const sr of [48000, 44100]) {
  describe(`the live signal path at ${sr} Hz`, () => {
    const { log, seconds, pipeline } = run(sr);

    it('keeps its own clock from the samples it was given', () => {
      expect(pipeline.timeSec).toBeCloseTo(seconds, 2);
    });

    it('makes about 50 pitch frames a second with increasing times', () => {
      expect(log.pitch.length).toBeGreaterThan(seconds * 50 - 5);
      expect(log.pitch.length).toBeLessThan(seconds * 50 + 2);
      for (let i = 1; i < log.pitch.length; i++) expect(log.pitch[i].t_ms).toBeGreaterThan(log.pitch[i - 1].t_ms);
    });

    it('hears the two hummed notes as performance notes', () => {
      const notes = log.performance.filter((e) => e.type === 'note');
      expect(notes.map((n) => n.pitch)).toEqual([60, 64]);
      expect(Math.abs(notes[0].time_sec! - 0.5)).toBeLessThan(0.12);
      expect(Math.abs(notes[1].time_sec! - 1.5)).toBeLessThan(0.12);
      for (const n of notes) {
        expect(n.duration_sec).toBeGreaterThan(0.45);
        expect(n.duration_sec).toBeLessThan(0.8);
        expect(Math.abs(n.cents_off!)).toBeLessThan(15);
        expect(n.loudness).toBeGreaterThan(0);
        expect(n.loudness).toBeLessThanOrEqual(1);
      }
    });

    it('sends the hum-pitch slider only while a clear pitch is heard', () => {
      expect(log.hum.length).toBeGreaterThan(20);
      for (const h of log.hum) {
        expect(h.value).toBeGreaterThanOrEqual(0);
        expect(h.value).toBeLessThanOrEqual(1);
        expect(h.value).toBeCloseTo((h.midi - 36) / 60, 6);
        expect(Math.min(Math.abs(h.midi - 60), Math.abs(h.midi - 64))).toBeLessThan(0.6);
      }
      // nothing during the long quiet stretch at the end
      expect(Math.max(...log.hum.map((h) => h.tMs))).toBeLessThan(10_000 + 2.4 * 1000);
    });

    it('sends loudness about 20 times a second, between 0 and 1, louder when there is sound', () => {
      expect(log.loudness.length).toBeGreaterThan(seconds * 20 - 4);
      expect(log.loudness.length).toBeLessThan(seconds * 20 + 2);
      for (const l of log.loudness) {
        expect(l.value).toBeGreaterThanOrEqual(0);
        expect(l.value).toBeLessThanOrEqual(1);
      }
      const at = (sec: number) => log.loudness.reduce((best, l) => (Math.abs(l.tMs - 10_000 - sec * 1000) < Math.abs(best.tMs - 10_000 - sec * 1000) ? l : best)).value;
      expect(at(0.3)).toBeLessThan(0.05);
      expect(at(0.9)).toBeGreaterThan(0.3);
    });

    it('finds one onset for each hummed note, the clap and the snap (and no extras)', () => {
      expect(log.onset.length).toBe(4);
      const secs = log.onset.map((o) => (o.tMs - 10_000) / 1000);
      expect(Math.abs(secs[0] - 0.5)).toBeLessThan(0.12);
      expect(Math.abs(secs[1] - 1.5)).toBeLessThan(0.12);
      expect(Math.abs(secs[2] - 3.1)).toBeLessThan(0.02);
      expect(Math.abs(secs[3] - 4.3)).toBeLessThan(0.02);
      const onsetEvents = log.performance.filter((e) => e.type === 'onset');
      expect(onsetEvents.length).toBe(4);
    });

    it('calls the clap a clap and the snap a snap, stamped with when they happened', () => {
      expect(log.hand.map((h) => h.kind)).toEqual(['clap', 'snap']);
      expect(Math.abs((log.hand[0].tMs - 10_000) / 1000 - 3.1)).toBeLessThan(0.02);
      expect(Math.abs((log.hand[1].tMs - 10_000) / 1000 - 4.3)).toBeLessThan(0.02);
    });
  });
}

describe('the live signal path when samples go missing', () => {
  it('moves its clock on by the number of lost samples', () => {
    const { sink } = recordingSink();
    const p = new MicPipeline(48000, new Analyzer(sink, 0));
    p.push(silence(0.5, 48000));
    p.push(silence(0.1, 48000), 48000);
    expect(p.timeSec).toBeCloseTo(1.6, 3);
  });

  it('still finds notes afterwards', () => {
    const sr = 48000;
    const { sink, log } = recordingSink();
    const p = new MicPipeline(sr, new Analyzer(sink, 0));
    p.push(silence(0.5, sr));
    p.push(voice([[0.5, 67]], sr), sr * 2);
    p.push(silence(0.3, sr));
    expect(log.hum.length).toBeGreaterThan(10);
    expect(Math.abs(log.hum[log.hum.length - 1].midi - 67)).toBeLessThan(0.5);
  });
});
