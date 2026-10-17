// The clap check with scripted clicks and claps, and once with the real microphone code fed a recording of claps.
import { describe, expect, it, vi } from 'vitest';
import { Analyzer } from '../analyzer';
import { CONFIG } from '../config';
import { MicPipeline } from '../pipeline';
import { recordingSink } from '../test-sink';
import { clapSound, inPieces, mix, silence } from '../test-signals';
import { CALIBRATION_PROBLEM, CALIBRATION_SCATTERED, clickTimesMs, computeCalibration, matchClicks, mergeDetections, runCalibration, type CalibrationEnv } from './calibration';

const CLICKS = clickTimesMs(10_000); // six clicks at 90 BPM, 666.7 ms apart, from page time 10 s
const OFFSET = 120;
const claps = (offset: number, jitter: number[] = [0, 0, 0, 0, 0, 0]) => CLICKS.map((c, k) => c + offset + jitter[k]);

describe('click times', () => {
  it('are 60000 / 90 ms apart', () => {
    expect(CLICKS).toHaveLength(6);
    expect(CLICKS[1] - CLICKS[0]).toBeCloseTo(666.667, 2);
    expect(CLICKS[5] - CLICKS[0]).toBeCloseTo(3333.33, 1);
  });
});

describe('matching claps to clicks', () => {
  it('pairs each click with its closest clap and ignores anything further than 400 ms', () => {
    // 450 ms before the first click and 450 ms after the last one are too far; 390 ms before the first click is not
    const m = matchClicks(CLICKS, [CLICKS[0] - 450, CLICKS[1] + 100, CLICKS[5] + 450, 99_999]);
    expect(m.map((x) => Math.round(x.offsetMs))).toEqual([100]);
    expect(matchClicks(CLICKS, [CLICKS[0] - 390]).map((x) => Math.round(x.offsetMs))).toEqual([-390]);
  });
  it('never uses one clap for two clicks', () => {
    const m = matchClicks([1000, 1300], [1150]);
    expect(m).toHaveLength(1);
    expect(m[0].expectedMs).toBe(1000); // the closer click (150 ms vs 150 ms: the earlier click wins the tie)
  });
  it('merges a clap and an onset that are the same sound', () => {
    expect(mergeDetections([100, 104, 900, 903, 1500])).toEqual([100, 900, 1500]);
  });
});

describe('the latency offset', () => {
  it('is the lag when every clap is exactly that late', () => {
    const r = computeCalibration(CLICKS, claps(OFFSET));
    expect(r.ok).toBe(true);
    expect(r.latencyOffsetMs).toBeCloseTo(120, 6);
    expect(r.matched).toBe(6);
    expect(r.spreadMs).toBe(0);
  });

  it('is within a few ms when the claps wobble by 15 ms either way', () => {
    const r = computeCalibration(CLICKS, claps(OFFSET, [15, -12, 8, -15, 10, -6]));
    expect(r.ok).toBe(true);
    expect(Math.abs(r.latencyOffsetMs! - 120)).toBeLessThanOrEqual(5);
  });

  it('can be negative (clapping ahead of the click)', () => {
    const r = computeCalibration(CLICKS, claps(-40));
    expect(r.latencyOffsetMs).toBeCloseTo(-40, 6);
  });

  it('shrugs off outliers: a clap 380 ms late, a clap 350 ms early, stray noises far away', () => {
    const detected = [...claps(OFFSET, [0, 380 - OFFSET, 3, -350 - OFFSET, -4, 2]), CLICKS[0] - 2500, CLICKS[5] + 4000, 123456];
    const r = computeCalibration(CLICKS, detected);
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(6);
    expect(Math.abs(r.latencyOffsetMs! - 120)).toBeLessThanOrEqual(5);
  });

  it('ignores claps more than 400 ms from their click', () => {
    const r = computeCalibration(CLICKS, [CLICKS[0] - 500, ...claps(OFFSET).slice(0, 4), CLICKS[5] + 520]);
    expect(r.matched).toBe(4);
    expect(r.ok).toBe(true);
    expect(r.latencyOffsetMs).toBeCloseTo(120, 6);
  });

  it('counts a clap that was also reported as an onset only once', () => {
    const both = [...claps(OFFSET), ...claps(OFFSET + 3)];
    const r = computeCalibration(CLICKS, both);
    expect(r.matched).toBe(6);
    expect(r.latencyOffsetMs).toBeCloseTo(120, 6);
  });

  it('works with 4 of 6 clicks clapped', () => {
    const r = computeCalibration(CLICKS, claps(OFFSET).slice(0, 4));
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(4);
  });

  it('asks to try again, in plain words, with 3 of 6 claps (or none)', () => {
    for (const detected of [claps(OFFSET).slice(0, 3), [], [CLICKS[2] + 1000]]) {
      const r = computeCalibration(CLICKS, detected);
      expect(r.ok).toBe(false);
      expect(r.latencyOffsetMs).toBeUndefined();
      expect(r.message).toBe(CALIBRATION_PROBLEM);
    }
    expect(CALIBRATION_PROBLEM).toBe("I couldn't hear your claps clearly. Move closer to the microphone, clap sharply, and try again");
  });

  it('does not trust claps that are all over the place', () => {
    const r = computeCalibration(CLICKS, claps(0, [-300, 350, -250, 300, -380, 330]));
    expect(r.ok).toBe(false);
    expect(r.message).toBe(CALIBRATION_SCATTERED);
  });

  it('needs two thirds of however many clicks are played', () => {
    const eight = clickTimesMs(0, 8);
    expect(computeCalibration(eight, eight.slice(0, 5).map((c) => c + 50)).ok).toBe(false);
    expect(computeCalibration(eight, eight.slice(0, 6).map((c) => c + 50)).ok).toBe(true);
  });
});

/** A pretend browser: the clicks sound at 10 s, the claps arrive 120 ms after each, and time jumps ahead when we wait. */
function fakeEnv(opts: { hits: (clicks: number[]) => number[]; abortAfterClicks?: AbortController }) {
  let now = 9_000;
  let onHit: ((t: number) => void) | null = null;
  const stopListening = vi.fn();
  let clicks: number[] = [];
  const env: CalibrationEnv = {
    startClicks: async (count, bpm, leadInSec) => {
      clicks = clickTimesMs(now + leadInSec * 1000, count, bpm);
      opts.abortAfterClicks?.abort();
      return clicks;
    },
    listen: (cb) => {
      onHit = cb;
      return stopListening;
    },
    now: () => now,
    sleep: async (ms, signal) => {
      now += ms;
      if (signal?.aborted) return false;
      for (const t of opts.hits(clicks)) onHit?.(t);
      return true;
    },
  };
  return { env, stopListening, clicks: () => clicks };
}

describe('running the clap check', () => {
  it('plays 6 clicks at about 90 BPM, listens, and reports the offset', async () => {
    const { env, stopListening, clicks } = fakeEnv({ hits: (c) => c.map((t) => t + 120) });
    const r = await runCalibration(env);
    expect(r!.ok).toBe(true);
    expect(r!.latencyOffsetMs).toBeCloseTo(120, 6);
    expect(clicks()).toHaveLength(6);
    expect(clicks()[1] - clicks()[0]).toBeCloseTo(666.667, 2);
    expect(stopListening).toHaveBeenCalledTimes(1);
  });
  it('reports a plain problem when nothing is heard', async () => {
    const { env } = fakeEnv({ hits: () => [] });
    const r = await runCalibration(env);
    expect(r!.ok).toBe(false);
    expect(r!.message).toBe(CALIBRATION_PROBLEM);
  });
  it('stops quietly when cancelled', async () => {
    const abort = new AbortController();
    const { env, stopListening } = fakeEnv({ hits: (c) => c.map((t) => t + 120), abortAfterClicks: abort });
    expect(await runCalibration(env, { signal: abort.signal })).toBeNull();
    expect(stopListening).toHaveBeenCalledTimes(1);
  });
});

describe('with the real microphone code', () => {
  // Claps are placed 120 ms after each click in a recording and run through the same pipeline the microphone uses.
  // This measures how late the clap detection itself is (it adds to the offset the person sees).
  CONFIG.debug = false;
  for (const sr of [48000, 44100]) {
    it(`finds the 120 ms lag at ${sr} Hz to within a few ms`, () => {
      const originMs = 50_000; // the page-clock time the microphone started
      const firstClickSec = 1.5; // since the microphone started
      const clickSec = clickTimesMs(firstClickSec * 1000).map((ms) => ms / 1000);
      const seconds = clickSec[5] + 2;
      const parts = clickSec.map((c, k) => clapSound({ seconds, at: c + 0.12, sr, seed: 3 + k }));
      const recording = mix(silence(seconds, sr), ...parts);

      const { sink, log } = recordingSink();
      const pipeline = new MicPipeline(sr, new Analyzer(sink, originMs));
      inPieces(recording, (p) => pipeline.push(p));

      const hits = [...log.hand.map((h) => h.tMs), ...log.onset.map((o) => o.tMs)];
      const expected = clickSec.map((c) => originMs + c * 1000);
      const r = computeCalibration(expected, hits);
      console.log(`[measured] ${sr} Hz: ${log.hand.length} claps and ${log.onset.length} onsets heard, matched ${r.matched}/6, offset ${r.latencyOffsetMs?.toFixed(1)} ms (true lag 120), spread ${r.spreadMs?.toFixed(1)} ms`);
      expect(r.ok).toBe(true);
      expect(r.matched).toBe(6);
      expect(r.latencyOffsetMs!).toBeGreaterThanOrEqual(115);
      expect(r.latencyOffsetMs!).toBeLessThanOrEqual(135);
    });
  }
});
