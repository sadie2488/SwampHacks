// Turns "the sound engine was at position P when the audio clock said T" into "where is the song in what I hear right now".
// The engine runs a little ahead of the speakers (it makes a block, then the block plays), so reading its position
// directly is early by a block or more. Every report becomes an anchor: at audio-clock time `t` the song was at `sec`
// and moves `rate` song-seconds per second. Reading at the time the speakers are playing (clock now minus the
// device delay) walks along those anchors. Pure numbers, so it is tested without any browser.

export interface Anchor {
  /** Audio clock time (seconds) this anchor is about. */
  t: number;
  /** Song position (song seconds) at that time. */
  sec: number;
  /** Song seconds per real second after `t` (the speed while playing, 0 when stopped). */
  rate: number;
  /** How long after `t` the anchor may be trusted before we stop extrapolating (seconds). */
  maxAhead: number;
}

const MAX_BACK = 0.6; // never look further back than this before the first anchor
const KEEP = 6;

export class PositionClock {
  private anchors: Anchor[] = [];

  /** True once there is anything to read. */
  get active(): boolean {
    return this.anchors.length > 0;
  }

  /** Forget the past: the song is at `sec` and stays there until the next anchor says otherwise. */
  reset(sec: number): void {
    this.anchors = [{ t: -Infinity, sec, rate: 0, maxAhead: 0 }];
  }

  clear(): void {
    this.anchors = [];
  }

  add(anchor: Anchor): void {
    const last = this.anchors[this.anchors.length - 1];
    if (last && anchor.t < last.t) return; // late or repeated report
    this.anchors.push(anchor);
    if (this.anchors.length > KEEP) this.anchors.shift();
  }

  /** The song position at audio-clock time `x`. */
  read(x: number): number {
    const a = this.anchors;
    if (a.length === 0) return 0;
    let at: Anchor | null = null;
    for (let i = a.length - 1; i >= 0; i--) {
      if (a[i].t <= x) {
        at = a[i];
        break;
      }
    }
    let delta: number;
    if (at) {
      delta = Math.min(x - at.t, at.maxAhead);
    } else {
      at = a[0];
      delta = Math.max(x - at.t, -MAX_BACK);
    }
    return Math.max(0, at.sec + at.rate * delta);
  }
}

/** How long sound takes to get from the audio graph to the speakers, from what the browser tells us (0 if it does not). */
export function deviceDelaySec(ctx: { outputLatency?: number; baseLatency?: number }): number {
  const out = ctx.outputLatency;
  if (typeof out === 'number' && Number.isFinite(out) && out > 0) return Math.min(out, 0.5);
  const base = ctx.baseLatency;
  if (typeof base === 'number' && Number.isFinite(base) && base > 0) return Math.min(base, 0.5);
  return 0;
}

/**
 * The anchor for one block made by the script node: the block starts being heard at `playbackTime`, lasts `dur`
 * seconds, and the song goes from `from` to `to` across it. A block with a seek in it (position jumps) is not a
 * smooth run, so it is treated as "stopped at the new place".
 */
export function blockAnchor(playbackTime: number, dur: number, from: number, to: number): Anchor {
  const rate = (to - from) / dur;
  if (!(rate >= 0 && rate < 4)) return { t: playbackTime, sec: to, rate: 0, maxAhead: dur };
  return { t: playbackTime, sec: from, rate, maxAhead: dur };
}
