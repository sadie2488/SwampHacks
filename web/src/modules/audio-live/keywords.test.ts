import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { countKeywords, KeywordGate, loneKeyword, matchKeywords, modeWords, SOUND_ALIKES } from './keywords';

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

  it('one phrase fires one command: the first word said', () => {
    const { gate } = make();
    gate.arm();
    expect(gate.accept(['higher and lower'], 0)).toEqual(['higher']);
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

// Create mode lets Start/Next through without the fist, but only when the word is said on its own.
describe('Create mode without the fist', () => {
  const make = () => {
    let now = 1000;
    const gate = new KeywordGate(() => now);
    return { gate, tick: (ms: number) => (now += ms) };
  };

  it('knows a word said alone (an "okay" in front and punctuation are fine)', () => {
    expect(loneKeyword('start')).toBe('start');
    expect(loneKeyword('  Next! ')).toBe('next');
    expect(loneKeyword('okay, start.')).toBe('start');
    expect(loneKeyword('OK next')).toBe('next');
    expect(loneKeyword("let's start")).toBeNull();
    expect(loneKeyword('next I will add drums')).toBeNull();
    expect(loneKeyword('okay')).toBeNull();
  });

  it('"start" alone fires', () => {
    const { gate } = make();
    expect(gate.accept(['start'], 0, true)).toEqual(['start']);
    expect(gate.accept(['Okay, next.'], 1, true)).toEqual(['next']);
  });

  it('narration does not fire', () => {
    const { gate } = make();
    expect(gate.accept(["let's start"], 0, true)).toEqual([]);
    expect(gate.accept(["next I'll add drums"], 1, true)).toEqual([]);
    expect(gate.accept(['none of this has reverb'], 2, true)).toEqual([]);
    expect(gate.accept(['turn the beat on'], 3, true)).toEqual([]);
  });

  it('waits for the final result, so "start" on the way to "start the drums" does not fire', () => {
    const { gate } = make();
    expect(gate.accept(['start'], 0, true, [false])).toEqual([]);
    expect(gate.accept(['start the drums'], 0, true, [true])).toEqual([]);
    expect(gate.accept(['next'], 1, true, [false])).toEqual([]);
    expect(gate.accept(['next'], 1, true, [true])).toEqual(['next']);
  });

  it('with the fist held, any phrase with the word still fires', () => {
    const { gate, tick } = make();
    gate.arm();
    expect(gate.accept(["let's start"], 0, true)).toEqual(['start']);
    expect(gate.accept(["next I'll add drums"], 1, true, [false])).toEqual(['next']);
    tick(1000);
    gate.disarm();
    expect(gate.accept(["let's start"], 2, true)).toEqual([]);
  });

  it('Play mode is unchanged: nothing without the fist, any phrase with it', () => {
    const { gate } = make();
    expect(gate.accept(['start'], 0)).toEqual([]);
    expect(gate.accept(['play'], 1)).toEqual([]);
    gate.arm();
    expect(gate.accept(['please play it'], 0, false, [false])).toEqual(['play']);
  });
});

describe('sound-alikes, guesses and modes', () => {
  const make = () => {
    let now = 1000;
    const gate = new KeywordGate(() => now);
    return { gate, tick: (ms: number) => (now += ms) };
  };

  it('every sound-alike maps to its word (and only in its own mode)', () => {
    let n = 0;
    for (const [word, alikes] of Object.entries(SOUND_ALIKES)) {
      const words = modeWords(CONFIG.keywords.createWords.includes(word));
      expect(words).toContain(word);
      for (const a of alikes) {
        n++;
        expect(matchKeywords(a, words), a).toEqual([word]);
        expect(matchKeywords(`${a.toUpperCase()}!`, words), a).toEqual([word]);
        expect(loneKeyword(a, words), a).toBe(word);
        expect(matchKeywords(a, modeWords(!CONFIG.keywords.createWords.includes(word))), a).toEqual([]);
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it('the listed mis-hearings all work', () => {
    const play = modeWords(false);
    const create = modeWords(true);
    const cases: [string, string, readonly string[]][] = [
      ['paws', 'pause', play], ['pores', 'pause', play], ['plate', 'play', play], ['played', 'play', play],
      ['slow', 'slower', play], ['fast', 'faster', play], ['hire', 'higher', play], ['lore', 'lower', play], ['lover', 'lower', play],
      ['text', 'next', create], ['necks', 'next', create], ['star', 'start', create], ['stark', 'start', create],
      ['beet', 'beat', create], ['bead', 'beat', create], ['base', 'bass', create], ['sense', 'synth', create], ['sin', 'synth', create],
      ['plug', 'pluck', create], ['river', 'reverb', create], ['the lay', 'delay', create], ['filtered', 'filter', create],
      ['pianos', 'piano', create], ['drum', 'drums', create],
    ];
    for (const [heard, word, words] of cases) expect(loneKeyword(heard, words), heard).toBe(word);
  });

  it('matches whole words only', () => {
    expect(matchKeywords('basement starfish texting', modeWords(true))).toEqual([]);
    expect(matchKeywords('display slowpoke', modeWords(false))).toEqual([]);
  });

  it('checks every guess of a finished phrase: a word only in guess 3 still fires', () => {
    const { gate } = make();
    gate.arm();
    expect(gate.accept([['nice weather', 'nice whether', 'pause the weather']], 0, false, [true])).toEqual(['pause']);
  });

  it('in Create without the fist, a guess 3 that is the word alone fires; narration in every guess does not', () => {
    const { gate } = make();
    expect(gate.accept([['stuff', 'stop', 'start']], 0, true, [true])).toEqual(['start']);
    expect(gate.accept([['lets', "let's", "let's start the drums"]], 1, true, [true])).toEqual([]);
  });

  it('a word from the other mode does nothing', () => {
    const { gate, tick } = make();
    gate.arm();
    expect(gate.accept(['start'], 0, false)).toEqual([]);
    expect(gate.accept(['drums'], 1, false)).toEqual([]);
    tick(1000);
    expect(gate.accept(['play'], 2, true)).toEqual([]);
    expect(gate.accept(['pause'], 3, true)).toEqual([]);
    gate.disarm();
    expect(gate.accept(['faster'], 4, true)).toEqual([]);
  });

  it('Create without the fist: "start" fires, "let\'s start the drums" does not; with the fist it does', () => {
    const { gate, tick } = make();
    expect(gate.accept(['start'], 0, true)).toEqual(['start']);
    tick(1000);
    expect(gate.accept(["let's start the drums"], 1, true)).toEqual([]);
    expect(gate.accept(['now star please'], 2, true)).toEqual(['start']); // lead-in, sound-alike and "please"
    tick(1000);
    gate.arm();
    expect(gate.accept(["let's start the drums"], 3, true)).toEqual(['start']);
  });

  it('"slower" as the top guess fires only slower, even with "lower" in guess 2', () => {
    const { gate } = make();
    gate.arm();
    expect(gate.accept([['slower', 'lower', 'slow her']], 0, false, [true])).toEqual(['slower']);
  });

  it('"pause" with "plays" in another guess fires only pause', () => {
    const { gate } = make();
    gate.arm();
    expect(gate.accept([['pause', 'plays', 'pose']], 0, false, [true])).toEqual(['pause']);
  });

  it('a word only in guess 3 fires exactly once (also when the final result repeats)', () => {
    const { gate, tick } = make();
    gate.arm();
    expect(gate.accept([['nice', 'mice', 'faster']], 0, false, [true])).toEqual(['faster']);
    tick(1000);
    expect(gate.accept([['nice', 'mice', 'faster']], 0, false, [true])).toEqual([]);
  });

  it('when the interim fired the top guess, the final result fires nothing more (not even another guess)', () => {
    const { gate, tick } = make();
    gate.arm();
    expect(gate.accept(['slower'], 0, false, [false])).toEqual(['slower']);
    tick(1000);
    expect(gate.accept([['lower', 'slower']], 0, false, [true])).toEqual([]);
  });

  it('when the interim fired nothing, the final result still fires one word', () => {
    const { gate } = make();
    gate.arm();
    expect(gate.accept(['nice'], 0, false, [false])).toEqual([]);
    expect(gate.accept([['nice play', 'nice pause']], 0, false, [true])).toEqual(['play']);
  });

  it('an interim then final result of one phrase fires once', () => {
    const { gate, tick } = make();
    gate.arm();
    expect(gate.accept(['paws'], 0, false, [false])).toEqual(['pause']);
    tick(1000); // past the cooldown, so only the "once per phrase" rule holds it back
    expect(gate.accept([['pause', 'paws', 'pores']], 0, false, [true])).toEqual([]);
    expect(gate.accept([['pause', 'pores']], 1, false, [true])).toEqual(['pause']); // the next phrase
  });

  it('interim results only use the best guess', () => {
    const { gate } = make();
    gate.arm();
    expect(gate.accept([['nice weather', 'play']], 0, false, [false])).toEqual([]);
  });

  it('plain talk fires nothing, in either mode, armed or not', () => {
    const { gate } = make();
    const talk = ['I like this song', 'this is so cool', 'can you hear me', 'thank you everyone'];
    talk.forEach((t, i) => expect(gate.accept([t], i, true)).toEqual([]));
    gate.arm();
    talk.forEach((t, i) => expect(gate.accept([t], 10 + i, true)).toEqual([]));
    talk.forEach((t, i) => expect(gate.accept([t], 20 + i, false)).toEqual([]));
  });

  it('logs one line per finished phrase with the guesses and the verdict', () => {
    const { gate } = make();
    const lines: string[] = [];
    gate.log = (l) => lines.push(l);
    gate.accept(['sta'], 0, true, [false]);
    gate.accept([['star', 'start', 'stark']], 0, true, [true]);
    gate.accept(["let's start"], 1, true, [true]);
    expect(lines).toEqual([
      '[speech] heard: "star" | alts: "start", "stark" -> start (said alone)',
      '[speech] heard: "let\'s start" | alts: - -> none (not said alone; hold the fist for phrases)',
    ]);
  });
});
