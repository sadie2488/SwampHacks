// Fake mode: made-up microphone data so the app (and tests) work without a microphone.
// It plays a list of notes as pitch frames and feeds them through the same Analyzer the real microphone uses,
// so notes, onsets, loudness and the hum-pitch slider all come out exactly as they would for real.
import twinkle from '@fixtures/song-analysis/twinkle.json';
import type { Stop } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { Analyzer } from './analyzer';
import { CONFIG } from './config';
import { busSink, type Sink } from './sink';

export interface HumNote {
  /** Concert-pitch MIDI. */
  pitch: number;
  onset_sec: number;
  duration_sec: number;
}

/** The melody part of the Twinkle demo song, in order. */
export function twinkleMelody(): HumNote[] {
  const song = twinkle as unknown as SongAnalysis;
  const part = song.parts.find((p) => p.kind === 'melody') ?? song.parts[0];
  return [...part.notes].sort((a, b) => a.onset_sec - b.onset_sec).map((n) => ({ pitch: n.pitch, onset_sec: n.onset_sec, duration_sec: n.duration_sec }));
}

/** Plays notes as pitch frames, one every hop. Call advanceTo(seconds) as time passes. */
export class FakeHum {
  private k = -1;
  private readonly hopSec: number;
  private readonly loopSec: number;

  constructor(
    private readonly notes: HumNote[],
    private readonly analyzer: Analyzer,
    private readonly loop = false,
    hopMs = CONFIG.pitch.hopMs,
  ) {
    this.hopSec = hopMs / 1000;
    const end = notes.reduce((m, n) => Math.max(m, n.onset_sec + n.duration_sec), 0);
    this.loopSec = end + 0.5; // a short rest before the tune starts again
  }

  /** Seconds the whole tune lasts (including the short rest at the end). */
  get lengthSec(): number {
    return this.loopSec;
  }

  advanceTo(tSec: number): void {
    // if the page was asleep for a long time, skip ahead instead of replaying thousands of frames
    if (tSec - (this.k + 1) * this.hopSec > 2) this.k = Math.floor((tSec - 0.5) / this.hopSec);
    while ((this.k + 1) * this.hopSec <= tSec + 1e-9) {
      this.k++;
      this.step(this.k * this.hopSec, (this.k - 1) * this.hopSec);
    }
  }

  private step(t: number, prev: number): void {
    // attacks: any note whose start falls in (prev, t]
    const loops = this.loop ? [Math.floor(Math.max(0, prev) / this.loopSec), Math.floor(t / this.loopSec)] : [0, 0];
    for (let l = loops[0]; l <= loops[1]; l++) {
      for (const n of this.notes) {
        const at = l * this.loopSec + n.onset_sec;
        if (at > prev && at <= t) this.analyzer.attack(at, 0.06, 0.9);
      }
    }
    const local = this.loop ? t % this.loopSec : t;
    const i = this.notes.findIndex((n) => local >= n.onset_sec && local < n.onset_sec + n.duration_sec);
    if (i < 0) {
      this.analyzer.frame(t, null, 0.1, 0.002);
      return;
    }
    const n = this.notes[i];
    const detuneCents = ((i * 37) % 21) - 10; // a little different from perfect on each note, but the same every run
    const midi = n.pitch + detuneCents / 100 + 0.1 * Math.sin(2 * Math.PI * 5.5 * t);
    const env = Math.min(1, (local - n.onset_sec) / 0.04) * Math.min(1, (n.onset_sec + n.duration_sec - local) / 0.06);
    this.analyzer.frame(t, midi, 0.95, 0.012 + 0.045 * Math.max(0, env));
  }
}

export interface FakeHumOptions {
  /** Keep repeating the tune (default false). */
  loop?: boolean;
  /** Emit everything straight away instead of in real time (for tests). Needs loop: false. */
  instant?: boolean;
  /** Where the readings go (default: the bus). */
  sink?: Sink;
  /** Page-clock time that matches the start of the tune (default: now). */
  originMs?: number;
}

/**
 * Pretend somebody hums these notes. Publishes pitch frames, performance events, audio.loudness, audio.hum.pitch and
 * audio.onset the same way the real microphone does. Returns a function that stops it.
 */
export function fakeHum(notes: HumNote[], opts: FakeHumOptions = {}): Stop {
  const analyzer = new Analyzer(opts.sink ?? busSink, opts.originMs ?? performance.now());
  const hum = new FakeHum(notes, analyzer, opts.loop ?? false);
  if (opts.instant && !opts.loop) {
    const end = hum.lengthSec + 0.3;
    for (let t = 1; t < end + 1; t += 1) hum.advanceTo(Math.min(t, end)); // in 1 s steps so none of it counts as "the page slept"
    analyzer.flush();
    return () => {};
  }
  const started = performance.now();
  const timer = setInterval(() => {
    hum.advanceTo((performance.now() - started) / 1000);
    if (!opts.loop && (performance.now() - started) / 1000 > hum.lengthSec + 0.3) stop();
  }, CONFIG.pitch.hopMs);
  let stopped = false;
  const stop: Stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    analyzer.flush();
  };
  return stop;
}
