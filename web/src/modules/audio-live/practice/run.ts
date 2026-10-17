// Follows one practice run: where the song was while the player played, and what the player played.
//
// CLOCKS. The playback module publishes `transport` about 15 times a second, each with the song position and the tempo
// factor. Every update is stored with the page-clock time (performance.now()) it arrived at. From those pairs we work out
// the page-clock time at which the run's start position played (the median over all updates, because the position moves in
// blocks of about 90 ms). The player's notes arrive as `performance` events whose time_sec counts from when the microphone
// started; adding that start time (originMs) puts them on the page clock too. Played time = page time - run start.
// A run is one stretch of steady playing: pausing, a seek, a loop wrap or a change of tempo or pitch ends it.
import type { TransportState } from '@/bus';
import type { PerformanceEvent } from '@/contracts';
import type { PlayedNote } from './compare';
import { PRACTICE } from './config';
import { median } from './math';

export type EndReason = 'finished' | 'paused' | 'stopped' | 'changed' | 'jumped';

export interface RunSummary {
  /** Song position (song seconds) where the run began. */
  startSec: number;
  /** Song position where it ended; notes at or after this were not due. */
  endSec: number;
  rate: number;
  pitchShift: number;
  /** Page-clock time (ms) at which the start position played. */
  runStartMs: number;
  endReason: EndReason;
  played: PlayedNote[];
}

interface Heard {
  pageMs: number;
  pitch?: number;
  durationSec?: number;
  confidence?: number;
}

/** Concert-pitch MIDI as a fraction from a note event (pitch is whole and cents_off the rest; a fractional pitch is used as it is). */
export function floatPitch(e: PerformanceEvent): number | undefined {
  if (e.pitch === undefined) return undefined;
  return Number.isInteger(e.pitch) ? e.pitch + (e.cents_off ?? 0) / 100 : e.pitch;
}

export class RunRecorder {
  readonly startSec: number;
  readonly rate: number;
  readonly pitchShift: number;
  private readonly anchors: Array<{ atMs: number; posSec: number }>;
  private readonly notes: Heard[] = [];
  private readonly onsets: number[] = [];
  private reason: EndReason | null = null;
  private lastEventAtMs = -Infinity;

  /** @param state the transport state when the run began (the song is playing). */
  constructor(
    state: TransportState,
    atMs: number,
    private readonly durationSec: number,
    private readonly cfg = PRACTICE.run,
  ) {
    this.startSec = state.positionSec;
    this.rate = state.tempo > 0 ? state.tempo : 1;
    this.pitchShift = state.pitch;
    this.anchors = [{ atMs, posSec: state.positionSec }];
  }

  get ended(): EndReason | null {
    return this.reason;
  }

  /** The page-clock time of the most recent note or onset that was added (-Infinity if none). */
  get lastEventMs(): number {
    return this.lastEventAtMs;
  }

  /** A transport update. Returns the reason the run ended, or null if it carries on. */
  transport(state: TransportState, atMs: number): EndReason | null {
    if (this.reason) return this.reason;
    const last = this.anchors[this.anchors.length - 1];
    if (!state.playing) return this.end(last.posSec >= this.durationSec - 0.5 ? 'finished' : 'paused');
    if (state.tempo !== this.rate || state.pitch !== this.pitchShift) return this.end('changed');
    const expectedPos = last.posSec + ((atMs - last.atMs) / 1000) * this.rate;
    if (Math.abs(state.positionSec - expectedPos) > this.cfg.jumpSec) return this.end('jumped');
    this.anchors.push({ atMs, posSec: state.positionSec });
    return null;
  }

  /** The person (or the app) stopped the run. */
  stop(): void {
    if (!this.reason) this.end(this.anchors[this.anchors.length - 1].posSec >= this.durationSec - 0.5 ? 'finished' : 'stopped');
  }

  private end(reason: EndReason): EndReason {
    this.reason = reason;
    return reason;
  }

  /** A note or onset from the microphone. `originMs` is the page-clock time of the microphone's time 0. */
  add(e: PerformanceEvent, originMs: number, nowMs: number): void {
    if (e.type === 'calibration' || !Number.isFinite(e.time_sec)) return;
    const pageMs = originMs + e.time_sec * 1000;
    this.lastEventAtMs = nowMs;
    if (e.type === 'onset') this.onsets.push(pageMs);
    else this.notes.push({ pageMs, pitch: floatPitch(e), durationSec: e.duration_sec, confidence: e.confidence });
  }

  /** Page-clock time at which the run's start position played (the middle of the updates, not the first one). */
  runStartMs(): number {
    return median(this.anchors.map((a) => a.atMs - ((a.posSec - this.startSec) / this.rate) * 1000)) + this.cfg.transportLagMs;
  }

  summary(): RunSummary {
    const reason = this.reason ?? 'stopped';
    const lastPos = this.anchors[this.anchors.length - 1].posSec;
    const endSec = reason === 'finished' ? Math.max(lastPos, this.durationSec) : reason === 'paused' || reason === 'stopped' ? Math.max(this.startSec, lastPos - this.cfg.pauseGraceSec) : lastPos;
    const runStartMs = this.runStartMs();
    return { startSec: this.startSec, endSec, rate: this.rate, pitchShift: this.pitchShift, runStartMs, endReason: reason, played: this.played(runStartMs) };
  }

  /** Notes take the time of the sharp energy attack found just before them, when there is one; leftover attacks count as timing-only sounds. */
  private played(runStartMs: number): PlayedNote[] {
    const cfg = this.cfg;
    const onsets = [...this.onsets].sort((a, b) => a - b);
    const used = new Set<number>();
    const out: PlayedNote[] = [];
    for (const n of [...this.notes].sort((a, b) => a.pageMs - b.pageMs)) {
      let pick = -1;
      onsets.forEach((o, i) => {
        if (used.has(i) || o < n.pageMs - cfg.onsetBeforeNoteMs || o > n.pageMs + cfg.onsetAfterNoteMs) return;
        if (pick < 0 || Math.abs(o - n.pageMs) < Math.abs(onsets[pick] - n.pageMs)) pick = i;
      });
      if (pick >= 0) used.add(pick);
      out.push({ timeSec: ((pick >= 0 ? onsets[pick] : n.pageMs) - runStartMs) / 1000, pitch: n.pitch, durationSec: n.durationSec, confidence: n.confidence });
    }
    onsets.forEach((o, i) => {
      if (!used.has(i)) out.push({ timeSec: (o - runStartMs) / 1000 });
    });
    return out.filter((p) => p.timeSec * 1000 >= -cfg.startSlackMs).sort((a, b) => a.timeSec - b.timeSec);
  }
}
