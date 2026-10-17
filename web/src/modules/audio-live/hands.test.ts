// Snaps, claps and double claps, and the everyday sounds that must NOT count as one (desk taps, keys, speech).
// All the sounds are made up (test-signals.ts); see the table in config.ts for what each one measures.
import { describe, expect, it } from 'vitest';
import { Analyzer } from './analyzer';
import { CONFIG } from './config';
import { classifyBurst, TransientDetector, type BurstFeatures, type TransientEvent } from './dsp';
import { describeBurst, MicPipeline } from './pipeline';
import { recordingSink } from './test-sink';
import { clapSound, deskTap, inPieces, keyClick, mix, noise, silence, snapSound, speechBurst } from './test-signals';

CONFIG.debug = false; // keep test output quiet

const RATES = [48000, 44100];
const SEEDS = [1, 2, 3, 4, 5, 6];

/** Run a recording through the whole live path and return what came out. */
function listen(signal: Float32Array, sr: number, opts: { playing?: boolean } = {}) {
  const { sink, log } = recordingSink();
  const analyzer = new Analyzer(sink, 0);
  const pipeline = new MicPipeline(sr, analyzer);
  if (opts.playing) pipeline.setSongPlaying(true);
  inPieces(signal, (p) => pipeline.push(p));
  analyzer.flush();
  return log;
}

/** Claps at these times (seconds), in a recording `seconds` long. */
function claps(times: number[], sr: number, seconds = Math.max(...times) + 1) {
  return mix(silence(seconds, sr), ...times.map((at, i) => clapSound({ seconds, at, sr, seed: i + 1 })));
}

function bursts(signal: Float32Array, sr: number, strictness = 1) {
  const det = new TransientDetector(sr);
  det.strictness = strictness;
  const ev: TransientEvent[] = [];
  inPieces(signal, (p) => ev.push(...det.push(p)));
  return ev.filter((e): e is Extract<TransientEvent, { type: 'burst' }> => e.type === 'burst');
}

for (const sr of RATES) {
  describe(`double clap at ${sr} Hz`, () => {
    it('two claps 0.4 s apart: two claps and one double clap, stamped at the second clap', () => {
      const log = listen(claps([0.8, 1.2], sr), sr);
      expect(log.hand.map((h) => h.kind)).toEqual(['clap', 'clap']);
      expect(log.doubleClap.length).toBe(1);
      expect(log.doubleClap[0].tMs).toBe(log.hand[1].tMs);
      expect(log.doubleClap[0].confidence).toBeGreaterThan(0.5);
    });

    it('claps 0.25 s and 0.65 s apart both count as a double clap', () => {
      expect(listen(claps([0.8, 1.05], sr), sr).doubleClap.length).toBe(1);
      expect(listen(claps([0.8, 1.45], sr), sr).doubleClap.length).toBe(1);
    });

    it('claps 1 s apart: two claps, no double clap', () => {
      const log = listen(claps([0.8, 1.8], sr), sr);
      expect(log.hand.map((h) => h.kind)).toEqual(['clap', 'clap']);
      expect(log.doubleClap).toEqual([]);
    });

    it('a run of four quick claps gives one double clap; after a pause, two more give another', () => {
      const log = listen(claps([0.8, 1.2, 1.6, 2.0, 3.5, 3.9], sr), sr);
      expect(log.hand.length).toBe(6);
      expect(log.doubleClap.map((d) => d.tMs)).toEqual([log.hand[1].tMs, log.hand[5].tMs]);
    });

    it('a clap followed by a snap is not a double clap', () => {
      const seconds = 2;
      const log = listen(mix(clapSound({ seconds, at: 0.8, sr }), snapSound({ seconds, at: 1.2, sr })), sr);
      expect(log.hand.map((h) => h.kind)).toEqual(['clap', 'snap']);
      expect(log.doubleClap).toEqual([]);
    });
  });

  describe(`snaps at ${sr} Hz`, () => {
    it('a snap with 20, 40 or 60 ms of room echo is a snap', () => {
      for (const echoMs of [20, 40, 60])
        for (const seed of SEEDS) {
          const found = bursts(snapSound({ seconds: 1.5, at: 0.8, sr, seed, echoMs }), sr);
          expect(found.map((b) => b.verdict.kind), `echo ${echoMs} ms, seed ${seed}`).toEqual(['snap']);
        }
    });

    it('the 40 ms echo makes the snap last longer than the old 25 ms limit', () => {
      const lengths = SEEDS.map((seed) => bursts(snapSound({ seconds: 1.5, at: 0.8, sr, seed }), sr)[0].features.burstMs);
      expect(Math.max(...lengths)).toBeGreaterThan(25);
    });

    it('a clap stays a clap', () => {
      for (const seed of SEEDS) expect(bursts(clapSound({ seconds: 1.5, at: 0.8, sr, seed }), sr).map((b) => b.verdict.kind), `seed ${seed}`).toEqual(['clap']);
    });
  });

  describe(`sounds that are not hands, at ${sr} Hz`, () => {
    const cases: Array<[string, (o: { seconds: number; at: number; sr: number; seed: number }) => Float32Array, RegExp]> = [
      ['a knuckle tap on the desk', deskTap, /thump|click/],
      ['a key press next to the mic', keyClick, /click/],
      ['a burst of breathy speech', speechBurst, /swells up/],
    ];
    for (const [what, make, why] of cases) {
      it(`ignores ${what}`, () => {
        for (const seed of SEEDS) {
          const found = bursts(make({ seconds: 1.5, at: 0.8, sr, seed }), sr);
          expect(found.length, `seed ${seed}: it is loud, so it is looked at`).toBe(1);
          expect(found[0].verdict.kind, `seed ${seed}`).toBe('other');
          expect(found[0].verdict.reason, `seed ${seed}`).toMatch(why);
        }
        const log = listen(make({ seconds: 1.5, at: 0.8, sr, seed: 1 }), sr);
        expect(log.hand).toEqual([]);
      });
    }

    it('ignores two desk taps in a row (no double clap)', () => {
      const seconds = 2;
      const log = listen(mix(deskTap({ seconds, at: 0.8, sr, seed: 1 }), deskTap({ seconds, at: 1.2, sr, seed: 2 })), sr);
      expect(log.hand).toEqual([]);
      expect(log.doubleClap).toEqual([]);
    });
  });

  describe(`stricter while the song plays, at ${sr} Hz`, () => {
    it('a clap that only just passes when the song is stopped is ignored while it plays', () => {
      // scale a clap so its peak lands at 0.052: above minPeakRms (0.04), below 0.04 x 1.6 = 0.064
      const peak = bursts(clapSound({ seconds: 1.5, at: 0.8, sr }), sr)[0].features.peakRms;
      const quiet = clapSound({ seconds: 1.5, at: 0.8, sr, amp: (0.7 * 0.052) / peak });
      expect(listen(quiet, sr).hand.map((h) => h.kind)).toEqual(['clap']);
      const [b] = bursts(quiet, sr, CONFIG.hand.playingStrictness);
      expect(b.verdict.reason).toMatch(/quiet/);
      expect(listen(quiet, sr, { playing: true }).hand).toEqual([]);
    });

    it('a clap over a loud background (jump between 5 and 8 times) counts when stopped, not while playing', () => {
      // the song coming back through the speakers, as steady noise
      const seconds = 1.5;
      const signal = mix(noise(seconds, sr, 0.06, 3), clapSound({ seconds, at: 0.8, sr }));
      const [b] = bursts(signal, sr);
      expect(b.features.jumpRatio).toBeGreaterThan(CONFIG.hand.minJumpRatio);
      expect(b.features.jumpRatio).toBeLessThan(CONFIG.hand.minJumpRatio * CONFIG.hand.playingStrictness);
      expect(listen(signal, sr).hand.map((h) => h.kind)).toEqual(['clap']);
      expect(listen(signal, sr, { playing: true }).hand).toEqual([]);
    });

    it('a normal clap in a quiet room still counts while the song plays', () => {
      expect(listen(claps([0.8, 1.2], sr), sr, { playing: true }).doubleClap.length).toBe(1);
    });
  });
}

describe('the hand-sound rule', () => {
  const clap: BurstFeatures = { centroidHz: 2000, hfRatio: 0.3, flatness: 0.1, burstMs: 30, peakRms: 0.05, jumpRatio: 6, attackMs: 0 };

  it('multiplies the loudness and jump it needs by the strictness', () => {
    expect(classifyBurst(clap).kind).toBe('clap');
    expect(classifyBurst(clap, CONFIG.hand, 1.6).kind).toBe('other');
    expect(classifyBurst({ ...clap, peakRms: 0.1 }, CONFIG.hand, 1.6).reason).toMatch(/jump/);
    expect(classifyBurst({ ...clap, peakRms: 0.1, jumpRatio: 20 }, CONFIG.hand, 1.6).kind).toBe('clap');
  });

  it('accepts a snap up to 80 ms long, centred at 2.8 kHz or higher with 45 % or more above 2.5 kHz', () => {
    const snap = { ...clap, centroidHz: 3000, hfRatio: 0.5, flatness: 0.2 };
    expect(classifyBurst({ ...snap, burstMs: 60 }).kind).toBe('snap');
    expect(classifyBurst({ ...snap, burstMs: 90 }).kind).toBe('clap');
    expect(classifyBurst({ ...snap, centroidHz: 2600 }).kind).toBe('clap');
    expect(classifyBurst({ ...snap, hfRatio: 0.4 }).kind).toBe('clap');
  });

  it('writes one short line per loud sound with every measurement and the verdict', () => {
    const line = describeBurst(classifyBurst(clap), clap);
    expect(line).not.toContain('\n');
    for (const part of ['CLAP', 'peak 0.050', 'jump 6.0', 'flat 0.100', 'len 30ms', 'attack 0ms', 'centre 2000Hz', 'high 30%']) expect(line).toContain(part);
    const strict = describeBurst(classifyBurst(clap, CONFIG.hand, 1.6), clap, 1.6);
    expect(strict).toMatch(/^IGNORED: too quiet/);
    expect(strict).toContain('song playing');
  });
});

describe('the double-clap timing', () => {
  function clapsAt(ms: number[]) {
    const { sink, log } = recordingSink();
    const a = new Analyzer(sink, 0);
    for (const t of ms) a.hand('clap', t / 1000, 0.8);
    return log.doubleClap.map((d) => d.tMs);
  }

  it('needs the second clap between 150 and 700 ms after the first', () => {
    expect(CONFIG.doubleClap).toMatchObject({ minGapMs: 150, maxGapMs: 700 });
    expect(clapsAt([1000, 1100])).toEqual([]); // too close: one clap and its echo
    expect(clapsAt([1000, 1150])).toEqual([1150]);
    expect(clapsAt([1000, 1700])).toEqual([1700]);
    expect(clapsAt([1000, 1750])).toEqual([]);
  });

  it('gives one double clap per run, then needs a pause longer than 700 ms', () => {
    expect(clapsAt([1000, 1400, 1800, 2200, 2600])).toEqual([1400]);
    expect(clapsAt([1000, 1400, 2200, 2600])).toEqual([1400, 2600]);
  });

  it('a snap does not count towards a double clap', () => {
    const { sink, log } = recordingSink();
    const a = new Analyzer(sink, 0);
    a.hand('clap', 1, 0.8);
    a.hand('snap', 1.3, 0.8);
    expect(log.doubleClap).toEqual([]);
  });
});
