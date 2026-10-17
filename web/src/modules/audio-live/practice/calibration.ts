// The clap check. The app plays a few steady clicks, the person claps along, and we measure how late the claps arrive.
// That lag (the microphone, the speakers and the detection together) is the ONE shared latency offset: it is
// subtracted from everything the player does later, so the player is compared with the song and not with the hardware.
//
// CLOCKS. Everything here is in milliseconds on the page clock (performance.now()), the same clock the
// audio.clap / audio.onset signals use for t_ms. The browser pieces turn each click's AudioContext time into that clock
// (see browser.ts); this file only does the matching and the arithmetic, so it runs in Node tests.
import { PRACTICE } from './config';
import { median, medianAbsDeviation } from './math';

export interface ClickMatch {
  /** When the click was due, page-clock ms. */
  expectedMs: number;
  /** When a clap or onset was heard, page-clock ms. */
  detectedMs: number;
  /** detected minus expected (positive = the clap was heard after the click). */
  offsetMs: number;
}

export interface CalibrationResult {
  ok: boolean;
  /** Median of (detected - expected) over the matches. Only when ok. */
  latencyOffsetMs?: number;
  matched: number;
  total: number;
  /** How scattered the matched claps were (median absolute deviation), in ms. */
  spreadMs?: number;
  /** Every match that was found (including ones that were not used because the check failed). */
  matches: ClickMatch[];
  /** Plain words for the person. */
  message: string;
}

export const CALIBRATION_PROBLEM = "I couldn't hear your claps clearly. Move closer to the microphone, clap sharply, and try again";
export const CALIBRATION_SCATTERED = 'Your claps were hard to line up with the clicks. Clap right on each click, and try again';

/** A clap is usually reported as both a clap and an onset: merge detections that are the same sound (the earliest time is kept). */
export function mergeDetections(times: number[], withinMs: number = PRACTICE.calibration.mergeHitsMs): number[] {
  const sorted = [...times].filter(Number.isFinite).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) if (out.length === 0 || t - out[out.length - 1] > withinMs) out.push(t);
  return out;
}

/**
 * Pair each click with the closest unused detection, closest pairs first, ignoring pairs further apart than maxApartMs.
 * Returns the pairs in click order.
 */
export function matchClicks(expectedMs: number[], detectedMs: number[], maxApartMs: number = PRACTICE.calibration.maxApartMs): ClickMatch[] {
  const pairs: Array<{ i: number; j: number; d: number }> = [];
  expectedMs.forEach((e, i) => detectedMs.forEach((d, j) => Math.abs(d - e) <= maxApartMs && pairs.push({ i, j, d: Math.abs(d - e) })));
  pairs.sort((a, b) => a.d - b.d || a.i - b.i);
  const usedClick = new Set<number>();
  const usedHit = new Set<number>();
  const matches: Array<ClickMatch & { i: number }> = [];
  for (const p of pairs) {
    if (usedClick.has(p.i) || usedHit.has(p.j)) continue;
    usedClick.add(p.i);
    usedHit.add(p.j);
    matches.push({ i: p.i, expectedMs: expectedMs[p.i], detectedMs: detectedMs[p.j], offsetMs: detectedMs[p.j] - expectedMs[p.i] });
  }
  return matches.sort((a, b) => a.i - b.i).map(({ expectedMs: e, detectedMs: d, offsetMs }) => ({ expectedMs: e, detectedMs: d, offsetMs }));
}

/**
 * The latency offset from the clicks that were due and the claps that were heard (both page-clock ms).
 * Needs at least two thirds of the clicks matched (4 of 6); the answer is the median offset.
 */
export function computeCalibration(expectedMs: number[], detectedMs: number[], opts: { maxApartMs?: number; minMatchFraction?: number; maxSpreadMs?: number } = {}): CalibrationResult {
  const cfg = PRACTICE.calibration;
  const total = expectedMs.length;
  const matches = matchClicks(expectedMs, mergeDetections(detectedMs), opts.maxApartMs ?? cfg.maxApartMs);
  const needed = Math.max(1, Math.ceil(total * (opts.minMatchFraction ?? cfg.minMatchFraction) - 1e-9));
  const base = { matched: matches.length, total, matches };
  if (matches.length < needed) return { ...base, ok: false, message: CALIBRATION_PROBLEM };
  const offsets = matches.map((m) => m.offsetMs);
  const spreadMs = medianAbsDeviation(offsets);
  if (spreadMs > (opts.maxSpreadMs ?? cfg.maxSpreadMs)) return { ...base, ok: false, spreadMs, message: CALIBRATION_SCATTERED };
  const latencyOffsetMs = median(offsets);
  return { ...base, ok: true, latencyOffsetMs, spreadMs, message: `Clap check done: about ${Math.round(latencyOffsetMs)} ms of lag will be taken into account` };
}

/** Page-clock time of each click, from the first click time and the tempo. */
export function clickTimesMs(firstMs: number, count: number = PRACTICE.calibration.clicks, bpm: number = PRACTICE.calibration.bpm): number[] {
  const interval = 60000 / bpm;
  return Array.from({ length: count }, (_, k) => firstMs + k * interval);
}

/** What the clap check needs from the browser (or from a test). */
export interface CalibrationEnv {
  /** Start the clicks. Resolves with the page-clock time (ms) at which each click will sound. */
  startClicks(count: number, bpm: number, leadInSec: number): Promise<number[]>;
  /** Be told about every clap or onset that is heard (page-clock ms). Returns a function that stops listening. */
  listen(onHit: (tMs: number) => void): () => void;
  /** The page clock now (ms). */
  now(): number;
  /** Wait; resolves early (with false) if the signal is aborted. */
  sleep(ms: number, signal?: AbortSignal): Promise<boolean>;
}

export interface RunOptions {
  count?: number;
  bpm?: number;
  leadInSec?: number;
  tailMs?: number;
  signal?: AbortSignal;
}

/** Play the clicks, listen, and work out the offset. Resolves with null if it was cancelled. */
export async function runCalibration(env: CalibrationEnv, opts: RunOptions = {}): Promise<CalibrationResult | null> {
  const cfg = PRACTICE.calibration;
  const count = opts.count ?? cfg.clicks;
  const hits: number[] = [];
  const stop = env.listen((t) => hits.push(t));
  try {
    const expected = await env.startClicks(count, opts.bpm ?? cfg.bpm, opts.leadInSec ?? cfg.leadInSec);
    if (opts.signal?.aborted) return null;
    const last = expected[expected.length - 1] ?? env.now();
    const finished = await env.sleep(Math.max(0, last - env.now()) + (opts.tailMs ?? cfg.tailMs), opts.signal);
    if (!finished || opts.signal?.aborted) return null;
    return computeCalibration(expected, hits);
  } finally {
    stop();
  }
}
