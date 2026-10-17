import { describe, expect, it } from 'vitest';
import { blockAnchor, deviceDelaySec, PositionClock } from './position-clock';

describe('PositionClock', () => {
  it('reads nothing until it has been told something', () => {
    const c = new PositionClock();
    expect(c.active).toBe(false);
    expect(c.read(5)).toBe(0);
  });

  it('walks along a report at the playing speed', () => {
    const c = new PositionClock();
    c.add({ t: 10, sec: 4, rate: 1.5, maxAhead: 0.3 });
    expect(c.read(10)).toBe(4);
    expect(c.read(10.2)).toBeCloseTo(4.3, 9);
  });

  it('stops extrapolating when the next report is late', () => {
    const c = new PositionClock();
    c.add({ t: 10, sec: 4, rate: 1, maxAhead: 0.3 });
    expect(c.read(12)).toBeCloseTo(4.3, 9);
  });

  it('moves smoothly from one report to the next, with no jump when the new one arrives', () => {
    const c = new PositionClock();
    c.add({ t: 10, sec: 4, rate: 1, maxAhead: 0.3 });
    c.add({ t: 10.066, sec: 4.066, rate: 1, maxAhead: 0.3 });
    // asking about a moment between the two uses the older report (the newer one is about a later moment)
    expect(c.read(10.03)).toBeCloseTo(4.03, 9);
    expect(c.read(10.07)).toBeCloseTo(4.07, 9);
  });

  it('reading in the past (the sound is still on its way to the speakers) gives the earlier place', () => {
    const c = new PositionClock();
    c.add({ t: 10, sec: 4, rate: 1, maxAhead: 0.3 });
    c.add({ t: 10.066, sec: 4.066, rate: 1, maxAhead: 0.3 });
    c.add({ t: 10.133, sec: 4.133, rate: 1, maxAhead: 0.3 });
    expect(c.read(10.133 - 0.05)).toBeCloseTo(4.083, 3);
  });

  it('a stopped report holds the position', () => {
    const c = new PositionClock();
    c.add({ t: 10, sec: 4, rate: 1, maxAhead: 0.3 });
    c.add({ t: 10.066, sec: 4.066, rate: 0, maxAhead: 0.3 });
    expect(c.read(11)).toBeCloseTo(4.066, 9);
  });

  it('reset puts the position somewhere at once and ignores older reports', () => {
    const c = new PositionClock();
    c.add({ t: 10, sec: 4, rate: 1, maxAhead: 0.3 });
    c.reset(20);
    expect(c.read(10.1)).toBe(20);
    expect(c.read(99)).toBe(20);
    c.add({ t: 11, sec: 20.5, rate: 1, maxAhead: 0.3 });
    expect(c.read(11.1)).toBeCloseTo(20.6, 9);
    expect(c.read(10.9)).toBe(20); // before the first report after the reset
  });

  it('ignores a late report (older than one it already has)', () => {
    const c = new PositionClock();
    c.add({ t: 10.1, sec: 4.1, rate: 1, maxAhead: 0.3 });
    c.add({ t: 10, sec: 99, rate: 1, maxAhead: 0.3 });
    expect(c.read(10.1)).toBe(4.1);
  });

  it('never goes below zero or far before the first report', () => {
    const c = new PositionClock();
    c.add({ t: 10, sec: 0.1, rate: 1, maxAhead: 0.3 });
    expect(c.read(9)).toBe(0);
    c.add({ t: 20, sec: 5, rate: 1, maxAhead: 0.3 });
    const d = new PositionClock();
    d.add({ t: 20, sec: 5, rate: 1, maxAhead: 0.3 });
    expect(d.read(0)).toBeCloseTo(4.4, 9); // at most 0.6 s back
  });
});

describe('deviceDelaySec', () => {
  it('prefers the output latency, then the base latency, then nothing', () => {
    expect(deviceDelaySec({ outputLatency: 0.04, baseLatency: 0.01 })).toBe(0.04);
    expect(deviceDelaySec({ outputLatency: 0, baseLatency: 0.01 })).toBe(0.01);
    expect(deviceDelaySec({ baseLatency: 0.02 })).toBe(0.02);
    expect(deviceDelaySec({})).toBe(0);
    expect(deviceDelaySec({ outputLatency: NaN })).toBe(0);
    expect(deviceDelaySec({ outputLatency: 7 })).toBe(0.5);
  });
});

describe('blockAnchor', () => {
  it('a normal block runs from where it started to where it ended', () => {
    const a = blockAnchor(3, 0.1, 5, 5.1);
    expect(a).toMatchObject({ t: 3, sec: 5, maxAhead: 0.1 });
    expect(a.rate).toBeCloseTo(1, 9);
  });
  it('a stopped block stays put', () => {
    expect(blockAnchor(3, 0.1, 5, 5)).toMatchObject({ sec: 5, rate: 0 });
  });
  it('a block with a seek in it counts as stopped at the new place', () => {
    expect(blockAnchor(3, 0.1, 5, 12)).toMatchObject({ sec: 12, rate: 0 });
    expect(blockAnchor(3, 0.1, 5, 1)).toMatchObject({ sec: 1, rate: 0 });
  });
});
