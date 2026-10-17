// Turns the stream of pitch frames into notes: "a stable pitch that held for at least about 80 ms".
import { CONFIG } from './config';

export interface TrackedNote {
  /** When the note began, seconds since the mic started. */
  startSec: number;
  durationSec: number;
  /** Nearest whole concert-pitch MIDI note. */
  pitch: number;
  /** How far the real pitch was from that note, in cents (-50..50). */
  centsOff: number;
  /** Loudest RMS level while the note was held. */
  peakRms: number;
  /** Average pitch clarity, 0..1. */
  confidence: number;
}

interface Run {
  startSec: number;
  lastSec: number;
  mids: number[];
  sum: number;
  peakRms: number;
  clarSum: number;
  announced: boolean;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class NoteTracker {
  private run: Run | null = null;
  private pending: Run | null = null;
  private readonly hopSec: number;

  constructor(
    private readonly cb: {
      /** A pitch has now held long enough to be a note (called once per note, a little after it really began). */
      onNoteStart?: (startSec: number, rms: number) => void;
      /** A note ended. */
      onNote: (note: TrackedNote) => void;
    },
    private readonly cfg = CONFIG.note,
    hopMs = CONFIG.pitch.hopMs,
  ) {
    this.hopSec = hopMs / 1000;
  }

  /** Feed one pitch frame. `midi` is null when there is no clear pitch. */
  push(tSec: number, midi: number | null, clarity: number, rms: number): void {
    const maxGapSec = this.cfg.maxGapMs / 1000;
    if (this.run && tSec - this.run.lastSec - this.hopSec > maxGapSec + 1e-9) this.end();
    if (midi === null) {
      this.pending = null;
      return;
    }
    const run = this.run;
    if (!run) {
      this.run = this.newRun(tSec, midi, clarity, rms);
      this.pending = null;
      return;
    }
    if (Math.abs(midi - run.sum / run.mids.length) <= this.cfg.toleranceSemitones) {
      this.add(run, tSec, midi, clarity, rms);
      this.pending = null;
      this.maybeAnnounce(run);
      return;
    }
    // a different pitch: only switch once it has held for a few frames in a row
    const p = this.pending;
    if (p && Math.abs(midi - p.sum / p.mids.length) <= this.cfg.toleranceSemitones) this.add(p, tSec, midi, clarity, rms);
    else this.pending = this.newRun(tSec, midi, clarity, rms);
    if (this.pending && this.pending.mids.length >= this.cfg.switchFrames) {
      const next = this.pending;
      this.end();
      this.run = next;
      this.pending = null;
      this.maybeAnnounce(next);
    }
  }

  /**
   * A new attack was heard at tSec (a sudden jump in loudness). If a note is already sounding, it ends here, so the same
   * pitch sung twice ("la la") counts as two notes even though the pitch never changed.
   */
  split(tSec: number): void {
    if (this.run && this.run.startSec < tSec - this.hopSec / 2) {
      this.end();
      this.pending = null;
    }
  }

  /** The mic stopped: finish whatever note is still sounding. */
  flush(): void {
    this.end();
    this.pending = null;
  }

  private newRun(tSec: number, midi: number, clarity: number, rms: number): Run {
    return { startSec: tSec, lastSec: tSec, mids: [midi], sum: midi, peakRms: rms, clarSum: clarity, announced: false };
  }

  private add(r: Run, tSec: number, midi: number, clarity: number, rms: number): void {
    r.lastSec = tSec;
    r.mids.push(midi);
    r.sum += midi;
    r.peakRms = Math.max(r.peakRms, rms);
    r.clarSum += clarity;
  }

  private durationOf(r: Run): number {
    return r.lastSec - r.startSec + this.hopSec;
  }

  private maybeAnnounce(r: Run): void {
    if (!r.announced && this.durationOf(r) >= this.cfg.minNoteMs / 1000 - 1e-9) {
      r.announced = true;
      this.cb.onNoteStart?.(r.startSec, r.peakRms);
    }
  }

  private end(): void {
    const r = this.run;
    this.run = null;
    if (!r || this.durationOf(r) < this.cfg.minNoteMs / 1000 - 1e-9) return;
    const mid = median(r.mids);
    const pitch = Math.round(mid);
    this.cb.onNote({
      startSec: r.startSec,
      durationSec: this.durationOf(r),
      pitch,
      centsOff: Math.max(-50, Math.min(50, (mid - pitch) * 100)),
      peakRms: r.peakRms,
      confidence: r.clarSum / r.mids.length,
    });
  }
}
