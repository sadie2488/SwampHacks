import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { countKeywords, KeywordGate, matchKeywords } from './keywords';

describe('matching words', () => {
  it('finds each of the six keywords, in any capitals', () => {
    for (const w of CONFIG.keywords.words) {
      expect(matchKeywords(w)).toEqual([w]);
      expect(matchKeywords(w.toUpperCase() + '!')).toEqual([w]);
    }
  });
  it('only matches whole words', () => {
    expect(matchKeywords('player')).toEqual([]);
    expect(matchKeywords('displayed pausing slowers')).toEqual([]);
    expect(matchKeywords('please play it')).toEqual(['play']);
  });
  it('lists keywords in the order they were said, once each', () => {
    expect(matchKeywords('Faster, faster, then pause and play')).toEqual(['faster', 'pause', 'play']);
    expect(countKeywords('faster faster pause').get('faster')).toBe(2);
  });
  it('finds nothing in other speech', () => {
    expect(matchKeywords('hello there, nice weather')).toEqual([]);
    expect(matchKeywords('')).toEqual([]);
  });
});

describe('arming', () => {
  const make = () => {
    let now = 1000;
    const gate = new KeywordGate(() => now);
    return { gate, tick: (ms: number) => (now += ms) };
  };

  it('accepts nothing until armed', () => {
    const { gate } = make();
    expect(gate.armed).toBe(false);
    expect(gate.accept(['play'], 0)).toEqual([]);
  });

  it('accepts words while armed and nothing after letting go', () => {
    const { gate, tick } = make();
    expect(gate.arm()).toBe(true);
    expect(gate.arm()).toBe(false);
    expect(gate.accept(['pause'], 0)).toEqual(['pause']);
    tick(2000);
    expect(gate.disarm()).toBe(true);
    expect(gate.disarm()).toBe(false);
    expect(gate.accept(['play'], 1)).toEqual([]);
    tick(2000);
    expect(gate.accept(['faster'], 2)).toEqual([]);
  });

  it('does not repeat a word as an interim result grows, but does accept the next sentence', () => {
    const { gate, tick } = make();
    gate.arm();
    expect(gate.accept(['pla'], 0)).toEqual([]);
    expect(gate.accept(['play'], 0)).toEqual(['play']);
    tick(50);
    expect(gate.accept(['play it'], 0)).toEqual([]);
    expect(gate.accept(['play it please'], 0)).toEqual([]);
    tick(2000);
    expect(gate.accept(['play it please', 'play'], 0)).toEqual(['play']); // result 1 is a new sentence
  });

  it('holds back the same word for a short cooldown', () => {
    const { gate, tick } = make();
    gate.arm();
    expect(gate.accept(['slower'], 0)).toEqual(['slower']);
    tick(300);
    expect(gate.accept(['slower'], 1)).toEqual([]);
    tick(CONFIG.keywords.cooldownMs);
    expect(gate.accept(['slower'], 2)).toEqual(['slower']);
  });

  it('lets different words through at once', () => {
    const { gate } = make();
    gate.arm();
    expect(gate.accept(['higher and lower'], 0)).toEqual(['higher', 'lower']);
  });

  it('forgets earlier results when a new listening session starts (numbering restarts from 0)', () => {
    const { gate, tick } = make();
    gate.arm();
    expect(gate.accept(['play'], 0)).toEqual(['play']);
    tick(2000);
    gate.newSession();
    expect(gate.accept(['play'], 0)).toEqual(['play']);
  });

  it('starts fresh each time it is armed', () => {
    const { gate, tick } = make();
    gate.arm();
    gate.accept(['pause'], 0);
    gate.disarm();
    tick(2000);
    gate.arm();
    expect(gate.accept(['pause'], 0)).toEqual(['pause']);
  });

  it('can allow a short grace period after letting go, if configured', () => {
    let now = 0;
    const gate = new KeywordGate(() => now, { ...CONFIG.keywords, graceAfterReleaseMs: 300 });
    gate.arm();
    gate.disarm();
    now = 200;
    expect(gate.accept(['play'], 0)).toEqual(['play']);
    now = 900;
    expect(gate.accept(['pause'], 1)).toEqual([]);
  });
});
