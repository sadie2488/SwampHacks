// How often segmentNotes finds the right notes in made-up hums of untrained singers (60 hums per kind, 50 frames per second).
// A found note is right when its pitch is exactly the meant pitch and it starts within the scenario's tolerance (120 ms unless noted).
// Run with HUM_REPORT=1 to print the table (before = all the cleanups switched off, after = the defaults).
import { describe, expect, it } from 'vitest';
import { measure, SCENARIOS, type Measured } from './hum-scenarios';
import { segmentNotes, type SegmentOptions } from './segment-notes';

const before: SegmentOptions = { fixOctaves: false, correctTuning: false, dropGlides: false };
const finder = (opts: SegmentOptions) => (frames: Parameters<typeof segmentNotes>[0]) => segmentNotes(frames, { quantize: false, ...opts });

const results = SCENARIOS.map((scenario) => ({ scenario, before: measure(scenario, finder(before)), after: measure(scenario, finder({})) }));
const byName = (name: string) => results.find((r) => r.scenario.name.startsWith(name))!;
const mean = (pick: (m: Measured) => number, which: 'before' | 'after') => results.reduce((a, r) => a + pick(r[which]), 0) / results.length;

if (process.env.HUM_REPORT) {
  const f = (m: Measured) => `P=${m.precision.toFixed(3)} R=${m.recall.toFixed(3)}`;
  console.log(
    ['scenario'.padEnd(36) + 'before'.padEnd(20) + 'after'.padEnd(20) + 'after, tune only (a whole-tune shift of a semitone or two does not count)']
      .concat(results.map((r) => r.scenario.name.padEnd(36) + f(r.before).padEnd(20) + f(r.after).padEnd(20) + `P=${r.after.precisionShifted.toFixed(3)} R=${r.after.recallShifted.toFixed(3)}`))
      .concat([`mean of scenarios`.padEnd(36) + `P=${mean((m) => m.precision, 'before').toFixed(3)} R=${mean((m) => m.recall, 'before').toFixed(3)}`.padEnd(20) + `P=${mean((m) => m.precision, 'after').toFixed(3)} R=${mean((m) => m.recall, 'after').toFixed(3)}`])
      .join('\n'),
  );
}

describe('note-level precision and recall on made-up hums', () => {
  it('is clearly better overall than without the cleanups', () => {
    expect(mean((m) => m.precision, 'after')).toBeGreaterThan(0.95);
    expect(mean((m) => m.recall, 'after')).toBeGreaterThan(0.95);
    expect(mean((m) => m.precision, 'after')).toBeGreaterThan(mean((m) => m.precision, 'before') + 0.04);
    expect(mean((m) => m.recall, 'after')).toBeGreaterThan(mean((m) => m.recall, 'before') + 0.03);
  });

  it('is never worse than without the cleanups on any kind of hum', () => {
    for (const r of results) {
      expect(r.after.precision, r.scenario.name).toBeGreaterThanOrEqual(r.before.precision - 0.01);
      expect(r.after.recall, r.scenario.name).toBeGreaterThanOrEqual(r.before.recall - 0.01);
    }
  });

  it('is perfect on a clean hum and holds up with vibrato, dropouts and repeated notes', () => {
    expect(byName('clean').after).toMatchObject({ precision: 1, recall: 1 });
    for (const name of ['vibrato', 'dropouts', 'repeated']) {
      expect(byName(name).after.precision, name).toBeGreaterThan(0.98);
      expect(byName(name).after.recall, name).toBeGreaterThan(0.97);
    }
  });

  it('almost never invents notes for octave errors (it did for about 3 in 10 before)', () => {
    expect(byName('octave').before.precision).toBeLessThan(0.75);
    expect(byName('octave').after.precision).toBeGreaterThan(0.98);
    expect(byName('octave').after.recall).toBeGreaterThan(0.98);
  });

  it('gets the tune right for flat, sharp and drifting singers', () => {
    for (const name of ['flat singer (-30', 'flat singer (-40', 'sharp', 'drifts']) {
      const r = byName(name);
      expect(r.after.precisionShifted, name).toBeGreaterThan(0.97);
      expect(r.after.recallShifted, name).toBeGreaterThan(0.97);
      expect(r.after.precision, name).toBeGreaterThan(r.before.precision + 0.03);
      expect(r.after.recall, name).toBeGreaterThan(r.before.recall + 0.03);
    }
  });

  it('keeps long slides from making notes', () => {
    expect(byName('long slides').after.precision).toBeGreaterThan(byName('long slides').before.precision + 0.03);
    expect(byName('long slides').after.precision).toBeGreaterThan(0.97);
  });

  it('asking for 100 ms of stable pitch instead of 80 changes very little here, so 80 stays the default', () => {
    const strict = SCENARIOS.map((s) => measure(s, finder({ minNoteMs: 100 })));
    const meanOf = (pick: (m: Measured) => number) => strict.reduce((a, m) => a + pick(m), 0) / strict.length;
    expect(Math.abs(meanOf((m) => m.precision) - mean((m) => m.precision, 'after'))).toBeLessThan(0.01);
    expect(Math.abs(meanOf((m) => m.recall) - mean((m) => m.recall, 'after'))).toBeLessThan(0.01);
  });
});
