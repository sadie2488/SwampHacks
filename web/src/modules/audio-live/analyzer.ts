// Takes the raw findings (pitch frames, attacks, snaps and claps) and produces everything the rest of the app sees:
// smoothed loudness, the hum-pitch slider, notes and onsets for the feedback code. It does not care whether the
// findings came from the real microphone or from fake mode, so both go through exactly the same code.
import { CONFIG } from './config';
import { clamp01, levelFromRms } from './dsp';
import { NoteTracker } from './notes';
import type { Sink } from './sink';

/** When to send next, on a fixed grid, so "every 50 ms" averages 20 per second even though frames are 20 ms apart. */
function nextOnGrid(next: number, nowMs: number, everyMs: number): number {
  const n = (Number.isFinite(next) ? next : nowMs) + everyMs;
  return n <= nowMs ? nowMs + everyMs : n; // fell behind (a gap): start the grid again
}

export class Analyzer {
  private readonly tracker: NoteTracker;
  private loud = 0;
  private nextLoudMs = -Infinity;
  private nextHumMs = -Infinity;
  private recentMidi: number[] = [];
  private lastOnsetSec = -Infinity;

  /** @param originMs the page-clock time (performance.now()) that matches time 0 of this session. */
  constructor(
    private readonly sink: Sink,
    private readonly originMs: number,
    private readonly cfg = CONFIG,
  ) {
    this.tracker = new NoteTracker(
      {
        onNoteStart: (startSec, rms) => this.attack(startSec, rms, 0.7, 'pitch'),
        onNote: (n) =>
          this.sink.performance({
            version: 1,
            type: 'note',
            time_sec: Math.max(0, n.startSec),
            pitch: n.pitch,
            cents_off: n.centsOff,
            duration_sec: n.durationSec,
            loudness: levelFromRms(n.peakRms, this.cfg.loudness),
            confidence: clamp01(n.confidence),
          }),
      },
      cfg.note,
      cfg.pitch.hopMs,
    );
  }

  private ms(tSec: number): number {
    return Math.max(0, this.originMs + tSec * 1000);
  }

  /** One pitch frame. tSec = seconds since the session started (the end of the window that was analysed). */
  frame(tSec: number, midi: number | null, clarity: number, rms: number): void {
    const tMs = this.ms(tSec);
    this.sink.pitch({ t_ms: tMs, midi, confidence: clamp01(clarity), rms });

    // loudness: quick to rise, slower to fall, sent about 20 times a second
    const l = this.cfg.loudness;
    const target = levelFromRms(rms, l);
    this.loud += (target - this.loud) * (target > this.loud ? l.attack : l.release);
    if (tMs >= this.nextLoudMs - 1e-6) {
      this.nextLoudMs = nextOnGrid(this.nextLoudMs, tMs, l.emitEveryMs);
      this.sink.loudness(clamp01(this.loud), tMs);
    }

    // hum pitch: only while there is a clear pitch, median of the last few to remove single jumps
    if (midi === null) this.recentMidi.length = 0;
    else {
      const h = this.cfg.hum;
      this.recentMidi.push(midi);
      if (this.recentMidi.length > h.medianOf) this.recentMidi.shift();
      if (tMs >= this.nextHumMs - 1e-6) {
        this.nextHumMs = nextOnGrid(this.nextHumMs, tMs, h.emitEveryMs);
        const sorted = [...this.recentMidi].sort((a, b) => a - b);
        const med = sorted[sorted.length >> 1];
        this.sink.hum(clamp01((med - h.lowMidi) / (h.highMidi - h.lowMidi)), med, clamp01(clarity), tMs);
      }
    }

    this.tracker.push(tSec, midi, clarity, rms);
  }

  /** A sudden jump in loudness was heard at tSec. */
  attack(tSec: number, rms: number, confidence: number, source: 'energy' | 'pitch' = 'energy'): void {
    const o = this.cfg.onset;
    const minGap = (source === 'energy' ? o.refractoryMs : o.mergeWithPitchMs) / 1000;
    if (tSec - this.lastOnsetSec < minGap) return;
    this.lastOnsetSec = Math.max(this.lastOnsetSec, tSec);
    if (source === 'energy') this.tracker.split(tSec);
    this.sink.onset(clamp01(confidence), this.ms(tSec));
    this.sink.performance({ version: 1, type: 'onset', time_sec: Math.max(0, tSec), loudness: levelFromRms(rms, this.cfg.loudness), confidence: clamp01(confidence) });
  }

  /** A snap or a clap, with the time its attack was heard. */
  hand(kind: 'snap' | 'clap', tSec: number, confidence: number): void {
    this.sink.hand(kind, clamp01(confidence), this.ms(tSec));
  }

  /** The mic stopped: finish the note that is still sounding. */
  flush(): void {
    this.tracker.flush();
  }
}
