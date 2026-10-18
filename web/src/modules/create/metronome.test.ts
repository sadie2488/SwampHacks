import { describe, expect, it } from 'vitest';
import { countNumber, takeMetronome } from './metronome';

describe('take metronome', () => {
  it('clicks on every beat of the take, louder on beat 1 of each bar', () => {
    const ticks = takeMetronome(1, 2);
    expect(ticks).toHaveLength(8);
    expect(ticks.map((t) => t.position)).toEqual(['1:0:0', '1:1:0', '1:2:0', '1:3:0', '2:0:0', '2:1:0', '2:2:0', '2:3:0']);
    expect(ticks.filter((t) => t.accent).map((t) => t.position)).toEqual(['1:0:0', '2:0:0']);
    expect(ticks.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('starts at the bar the take starts on when the clock is already running', () => {
    expect(takeMetronome(6, 1).map((t) => t.position)).toEqual(['6:0:0', '6:1:0', '6:2:0', '6:3:0']);
  });

  it('counts down 4, 3, 2, 1 over the count-in bar', () => {
    expect([0, 1, 2, 3].map(countNumber)).toEqual([4, 3, 2, 1]);
  });
});
