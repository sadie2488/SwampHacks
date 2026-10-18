// Layers must stay in time with each other: a layer plays back over exactly what was heard while it was hummed.
// These follow the engine's numbers: Tone's 192 ticks per beat, 4/4, bar 0 is the count-in, bar 1 the loop top.
import { describe, expect, it } from 'vitest';
import { barToTicks, earlyTakeLoopBeats, LOOP_TOP_BAR, loopPositionAt, partStart, type PartStart } from './loop-grid';

const PPQ = 192;
const BAR = 4 * PPQ;
const bar = (n: number) => barToTicks(n, PPQ);
const MARGIN = Math.ceil(0.05 * (100 / 60) * PPQ); // what the engine uses at 100 bpm
/** A take's end is heard a little after its last bar line (tail plus output latency): about 0.2 s, 64 ticks at 100 bpm. */
const LATE = 64;

/** A part built while the loop clock runs, at tick `now`. */
const builtWhileRunning = (startBar: number, loopBeats: number, now: number): PartStart =>
  partStart({ anchorTicks: bar(startBar), loopTicks: loopBeats * PPQ, topTicks: bar(LOOP_TOP_BAR), running: true, nowTicks: now, marginTicks: MARGIN });
/** A part built while the clock is stopped (it will start from the loop top). */
const builtStopped = (startBar: number, loopBeats: number): PartStart =>
  partStart({ anchorTicks: bar(startBar), loopTicks: loopBeats * PPQ, topTicks: bar(LOOP_TOP_BAR), running: false, nowTicks: 0, marginTicks: MARGIN });

describe('loop grid', () => {
  it('a layer recorded from bar N plays back in phase with a layer started at bar N', () => {
    const early = builtWhileRunning(5, 8, bar(5) - MARGIN); // started right on bar 5
    const late = builtWhileRunning(5, 8, bar(7) + 0.3 * BAR); // built well after, part-way through a pass
    for (let t = late.startTicks; t < bar(40); t += 37) {
      expect(loopPositionAt(t, late, 8 * PPQ)).toBe(loopPositionAt(t, early, 8 * PPQ));
    }
    for (const b of [9, 11, 13, 21]) expect(loopPositionAt(bar(b), late, 8 * PPQ)).toBe(0);
  });

  it('the first take from idle comes back in at its next pass, with no extra silent bar', () => {
    // Record from idle: count-in bar 0, the take starts at bar 1 and runs 2 bars; its end is heard just after bar 3
    const first = builtWhileRunning(1, 8, bar(3) + LATE);
    expect(first.startTicks).toBeLessThan(bar(3) + PPQ); // sounding within the first beat of bar 3, not bar 4 or 5
    expect(first.offsetTicks).toBe(first.startTicks - bar(3)); // already in its second pass, from the right spot
    for (const b of [5, 7, 9]) expect(loopPositionAt(bar(b), first, 8 * PPQ)).toBe(0);
  });

  it('a second layer over the first stays in the same place over many loops and after a restart', () => {
    const first = builtWhileRunning(1, 8, bar(3) + LATE);
    // Next layer pressed half-way through bar 4: count-in on bar 5, take from bar 6 (the first layer's second bar)
    const second = builtWhileRunning(6, 8, bar(8) + LATE);
    for (let k = 0; k < 12; k++) {
      const t = bar(8) + k * 2 * BAR;
      expect(loopPositionAt(t, second, 8 * PPQ)).toBe(0); // its first bar ...
      expect(loopPositionAt(t, first, 8 * PPQ)).toBe(BAR); // ... over the first layer's second bar, as when it was hummed
    }
    // Stop and play again from the top: both are rebuilt and keep the same relation
    const firstAgain = builtStopped(1, 8);
    const secondAgain = builtStopped(6, 8);
    expect(firstAgain.startTicks).toBe(bar(1));
    expect(firstAgain.offsetTicks).toBe(0);
    for (let k = 0; k < 12; k++) {
      const t = bar(1) + k * BAR;
      expect(loopPositionAt(t, secondAgain, 8 * PPQ)).toBe((loopPositionAt(t, firstAgain, 8 * PPQ) + BAR) % (2 * BAR));
    }
  });

  it('a take ended early gets a whole number of bars, never zero', () => {
    const ms = (beats: number) => (beats * 60000) / 100;
    expect(earlyTakeLoopBeats(0, 100)).toBe(4);
    expect(earlyTakeLoopBeats(ms(0.3), 100)).toBe(4);
    expect(earlyTakeLoopBeats(ms(4), 100)).toBe(4);
    expect(earlyTakeLoopBeats(ms(5.2), 100)).toBe(4); // a beat past the bar line: the press was late
    expect(earlyTakeLoopBeats(ms(5.6), 100)).toBe(8); // more than that: the part-filled bar is kept
    expect(earlyTakeLoopBeats(ms(7.9), 100)).toBe(8);
    expect(earlyTakeLoopBeats(ms(10), 100)).toBe(12);
    for (let beats = 0; beats < 40; beats += 0.37) expect(earlyTakeLoopBeats(ms(beats), 100) % 4).toBe(0);
  });

  it('a take ended early stays on the bar grid with the other layers, loop after loop', () => {
    const first = builtWhileRunning(1, 8, bar(3) + LATE);
    // a take from bar 6 stopped by the fist after 1.3 bars
    const loopBeats = earlyTakeLoopBeats(1.3 * 4 * (60000 / 100), 100);
    expect(loopBeats).toBe(4);
    const short = builtWhileRunning(6, loopBeats, bar(7.3) + LATE);
    for (let b = 8; b < 60; b++) {
      expect(loopPositionAt(bar(b), short, loopBeats * PPQ)).toBe(0); // starts again on every bar line
      expect([0, BAR]).toContain(loopPositionAt(bar(b), first, 8 * PPQ));
    }
  });
});
