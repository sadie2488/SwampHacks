import { describe, expect, it } from 'vitest';
import { beatPhaseAt } from './beats';

const beats = [0, 0.6, 1.2, 1.8];

describe('beatPhaseAt', () => {
  it('is 0 on a beat and 0.5 halfway to the next', () => {
    expect(beatPhaseAt(0.6, beats, 100)).toBeCloseTo(0, 6);
    expect(beatPhaseAt(0.9, beats, 100)).toBeCloseTo(0.5, 6);
    expect(beatPhaseAt(1.5, beats, 100)).toBeCloseTo(0.5, 6);
  });

  it('keeps counting after the last beat and before the first', () => {
    expect(beatPhaseAt(2.1, beats, 100)).toBeCloseTo(0.5, 6);
    expect(beatPhaseAt(0.2, [0.5, 1.1, 1.7], 100)).toBeCloseTo(0.5, 6); // half a beat before the first beat
  });

  it('follows uneven beats', () => {
    expect(beatPhaseAt(1.0, [0, 0.5, 1.5], 100)).toBeCloseTo(0.5, 6);
  });

  it('falls back to the tempo when there is no beat list, and to nothing when there is no tempo either', () => {
    expect(beatPhaseAt(0.3, undefined, 100)).toBeCloseTo(0.5, 6);
    expect(beatPhaseAt(0.3, [], 100)).toBeCloseTo(0.5, 6);
    expect(beatPhaseAt(0.3, undefined, undefined)).toBeUndefined();
  });

  it('always stays between 0 and 1', () => {
    for (let t = -1; t < 5; t += 0.137) {
      const p = beatPhaseAt(t, beats, 100)!;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
