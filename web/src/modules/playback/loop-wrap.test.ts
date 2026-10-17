// A loop wrap used to be a hard cut: if the sound at the loop end and the loop start did not happen to match, it ticked.
// Now the last few milliseconds before the loop end are blended (equal power) with the sound just before the loop start.
import { describe, expect, it } from 'vitest';
import { StretchEngine } from './stretch-engine';
import { maxStep, noise, sine } from './test-utils';

const SR = 44100;
const BLOCK = 1024;

function makeEngine(samples: Float32Array) {
  return new StretchEngine({ sampleRate: SR, channels: [samples] }, SR);
}

function run(engine: StretchEngine, seconds: number) {
  const blocks = Math.ceil((seconds * SR) / BLOCK);
  const out = new Float32Array(blocks * BLOCK);
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  for (let b = 0; b < blocks; b++) {
    engine.render(L, R, BLOCK);
    out.set(L, b * BLOCK);
  }
  return out;
}

// A loop of 1.0005682 s is 440.25 cycles of a 440 Hz tone, so the loop ends a quarter of a cycle in: the tone is at its peak where the loop starts at zero (a hard cut jumps 0.5).
const LOOP_A = 1;
const LOOP_B = 2.0005682;
const loopFrames = Math.round(LOOP_B * SR) - Math.round(LOOP_A * SR);

describe('loop wrap on a tone', () => {
  const tone = sine(440, 6, SR);
  const naiveJump = Math.abs(tone[Math.round(LOOP_B * SR) - 1] - tone[Math.round(LOOP_A * SR)]);

  it('the test loop really would tick with a hard cut', () => {
    expect(naiveJump).toBeGreaterThan(0.2); // a clean 440 Hz tone steps by at most 0.031
  });

  it('has no tick on the straight route: the step at the wrap is close to the step anywhere else', () => {
    const e = makeEngine(tone);
    e.setLoop([LOOP_A, LOOP_B]);
    e.seek(LOOP_A);
    e.play();
    const out = run(e, 5);
    expect(e.route).toBe('direct');
    const steady = maxStep(out, 600, loopFrames - 600); // inside the first pass: no wrap in here
    let worstWrap = 0;
    for (let k = 1; k <= 4; k++) worstWrap = Math.max(worstWrap, maxStep(out, k * loopFrames - 400, k * loopFrames + 400));
    console.log(`loop wrap check (straight route): steady step ${steady.toFixed(4)}, worst step at a wrap ${worstWrap.toFixed(4)} (a hard cut here would jump ${naiveJump.toFixed(3)})`);
    expect(worstWrap).toBeLessThan(steady * 1.8);
  });

  it('has no tick through the stretcher either (speed 0.8)', () => {
    const e = makeEngine(tone);
    e.setTempo(0.8);
    e.setLoop([LOOP_A, LOOP_B]);
    e.seek(LOOP_A);
    e.play();
    const out = run(e, 6);
    expect(e.route).toBe('stretch');
    const steady = 0.5 * 2 * Math.PI * 440 / SR;
    const worst = maxStep(out, 600);
    console.log(`loop wrap check (stretcher, speed 0.8): worst step over 6 s with several wraps ${worst.toFixed(4)} (steady ${steady.toFixed(4)})`);
    expect(worst).toBeLessThan(steady * 2);
  });

  it('only touches the last few milliseconds: the rest of the loop is the song, bit for bit', () => {
    const song = noise(SR * 5, 11);
    const e = makeEngine(song);
    e.setLoop([LOOP_A, LOOP_B]);
    e.seek(LOOP_A);
    e.play();
    const out = run(e, 4);
    const start = Math.round(LOOP_A * SR);
    const fade = Math.round(0.007 * SR);
    let wrong = 0;
    for (let i = 600; i < 3 * loopFrames; i++) {
      const inLoop = i % loopFrames;
      if (inLoop >= loopFrames - fade - 2) continue; // the blend
      if (out[i] !== song[start + inLoop]) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it('the loop keeps its length: the position stays inside it and comes round at the same rate', () => {
    const e = makeEngine(tone);
    e.setLoop([LOOP_A, LOOP_B]);
    e.seek(LOOP_A);
    e.play();
    let lowest = Infinity;
    let highest = 0;
    for (let b = 0; b < (3 * loopFrames) / BLOCK; b++) {
      run(e, BLOCK / SR);
      lowest = Math.min(lowest, e.positionSec);
      highest = Math.max(highest, e.positionSec);
    }
    expect(lowest).toBeGreaterThanOrEqual(LOOP_A - 1e-9);
    expect(highest).toBeLessThanOrEqual(LOOP_B + 1e-9);
  });

  it('a loop that starts at the very beginning fades out at the wrap instead of ticking', () => {
    const short = sine(440, 2.0005682, SR);
    const e = makeEngine(short);
    e.setLoop([0, 2.0005682]);
    e.seek(0);
    e.play();
    const out = run(e, 6);
    const steady = 0.5 * 2 * Math.PI * 440 / SR;
    expect(maxStep(out, 600)).toBeLessThan(steady * 1.8);
  });
});
