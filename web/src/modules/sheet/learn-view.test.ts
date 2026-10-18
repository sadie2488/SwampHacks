import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '@/bus';
import { learnView, setLetters } from './learn-view';

describe('the shared "show letters" switch', () => {
  beforeEach(() => bus.emit('learnView', { letters: false }));

  it('starts off and turns on everywhere with one call', () => {
    expect(learnView().letters).toBe(false);
    setLetters(true);
    expect(learnView().letters).toBe(true);
    expect(bus.last('learnView')).toEqual({ letters: true });
  });

  it('tells both sides (the sheet checkbox and the Learn pill) and stays quiet when nothing changes', () => {
    const seen: boolean[] = [];
    const off = bus.on('learnView', (v) => seen.push(v.letters));
    setLetters(true);
    setLetters(true);
    setLetters(false);
    off();
    expect(seen).toEqual([true, false]);
  });
});
