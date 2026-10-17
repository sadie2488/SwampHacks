// The engine in motion: position, changes while playing, pause and resume, looping, the end of the song, jumping around.
import { describe, expect, it } from 'vitest';
import { StretchEngine } from './stretch-engine';
import { dominantFreq, maxStep, rms, sine, zeroCrossingFreq } from './test-utils';

const SR = 44100;
const BLOCK = 2048;

/** A song whose pitch changes every second: 200, 300, 400, 500 ... Hz, so we can tell WHERE in the song we are by listening. */
function stepSong(seconds: number): Float32Array {
  const out = new Float32Array(seconds * SR);
  for (let s = 0; s < seconds; s++) out.set(sine(200 + 100 * s, 1, SR), s * SR);
  return out;
}

function makeEngine(samples: Float32Array, rate = SR) {
  return new StretchEngine({ sampleRate: rate, channels: [samples] }, SR);
}

/** Render this many seconds and hand back the left channel plus the song position after each block. */
function run(engine: StretchEngine, seconds: number) {
  const left: Float32Array[] = [];
  const positions: number[] = [];
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  for (let done = 0; done < seconds * SR; done += BLOCK) {
    engine.render(L, R, BLOCK);
    left.push(L.slice());
    positions.push(engine.positionSec);
  }
  const out = new Float32Array(left.length * BLOCK);
  left.forEach((b, i) => out.set(b, i * BLOCK));
  return { out, positions };
}

describe('position', () => {
  for (const tempo of [0.5, 1, 1.5]) {
    it(`advances ${tempo} song seconds per real second at tempo ${tempo}`, () => {
      const e = makeEngine(sine(440, 20, SR));
      e.setTempo(tempo);
      e.seek(0);
      e.play();
      const { positions } = run(e, 2);
      expect(positions[positions.length - 1]).toBeGreaterThan(2 * tempo - 0.2);
      expect(positions[positions.length - 1]).toBeLessThan(2 * tempo + 0.1);
    });
  }

  it('does not move while paused, and seeking while paused moves it at once', () => {
    const e = makeEngine(sine(440, 10, SR));
    run(e, 0.2);
    expect(e.positionSec).toBe(0);
    e.seek(4.5);
    expect(e.positionSec).toBeCloseTo(4.5, 3);
    run(e, 0.5);
    expect(e.positionSec).toBeCloseTo(4.5, 3);
  });
});

describe('changing speed and pitch while playing', () => {
  it('speeding up never makes the position jump and keeps the pitch', () => {
    const e = makeEngine(sine(440, 30, SR));
    e.seek(0);
    e.play();
    const before = run(e, 1);
    e.setTempo(1.5);
    const after = run(e, 2);
    const all = [...before.positions, ...after.positions];
    let biggestJump = 0;
    for (let i = 1; i < all.length; i++) {
      expect(all[i]).toBeGreaterThanOrEqual(all[i - 1]);
      biggestJump = Math.max(biggestJump, all[i] - all[i - 1]);
    }
    expect(biggestJump).toBeLessThan((BLOCK / SR) * 1.5 * 1.15); // never more than a block at the new speed
    const tail = after.out.length;
    expect(zeroCrossingFreq(after.out, SR, tail - SR, tail)).toBeGreaterThan(440 * 0.99);
    expect(zeroCrossingFreq(after.out, SR, tail - SR, tail)).toBeLessThan(440 * 1.01);
    expect(after.positions[after.positions.length - 1] - before.positions[before.positions.length - 1]).toBeGreaterThan(2 * 1.5 - 0.35);
  });

  it('a speed change makes no click', () => {
    const e = makeEngine(sine(440, 30, SR));
    e.seek(0);
    e.play();
    const a = run(e, 1);
    e.setTempo(0.5);
    const b = run(e, 1.5);
    const steady = maxStep(a.out, SR / 2, a.out.length); // after the start fade, before the change
    const changing = maxStep(b.out);
    console.log(`click check, speed change: biggest step steady ${steady.toFixed(4)}, during change ${changing.toFixed(4)}`);
    expect(changing).toBeLessThan(Math.max(steady * 2.5, 0.08));
  });

  it('a pitch change glides to the new pitch without a click', () => {
    const e = makeEngine(sine(440, 30, SR));
    e.seek(0);
    e.play();
    const a = run(e, 1);
    e.setPitchSemitones(12);
    const b = run(e, 1.5);
    const n = b.out.length;
    expect(zeroCrossingFreq(b.out, SR, n - SR / 2, n)).toBeGreaterThan(880 * 0.99);
    expect(zeroCrossingFreq(b.out, SR, n - SR / 2, n)).toBeLessThan(880 * 1.01);
    const steady = maxStep(a.out, SR / 2, a.out.length);
    const changing = maxStep(b.out);
    console.log(`click check, pitch +12: biggest step steady ${steady.toFixed(4)}, during change ${changing.toFixed(4)}`);
    expect(changing).toBeLessThan(0.15); // a clean 880 Hz tone at this volume steps at most about 0.063
    expect(Math.abs(b.positions[b.positions.length - 1] - a.positions[a.positions.length - 1] - 1.5)).toBeLessThan(0.25); // pitch does not change speed
  });

  it('sliding the pitch down through zero stays smooth', () => {
    const e = makeEngine(sine(440, 30, SR));
    e.setPitchSemitones(3);
    e.seek(0);
    e.play();
    run(e, 0.5);
    e.setPitchSemitones(-3);
    const b = run(e, 1);
    console.log(`click check, pitch +3 to -3: biggest step ${maxStep(b.out).toFixed(4)}`);
    expect(maxStep(b.out)).toBeLessThan(0.15);
    expect(rms(b.out, SR / 2, b.out.length)).toBeGreaterThan(0.25);
  });
});

describe('pause and resume', () => {
  it('fades out cleanly, stays silent and frozen, and carries on from the same place', () => {
    const e = makeEngine(sine(440, 30, SR));
    e.seek(0);
    e.play();
    run(e, 1);
    e.pause();
    const fade = run(e, 0.5);
    expect(maxStep(fade.out)).toBeLessThan(0.08);
    expect(rms(fade.out, BLOCK * 2, fade.out.length)).toBe(0);
    const frozen = e.positionSec;
    run(e, 1);
    expect(e.positionSec).toBe(frozen);
    e.play();
    const resumed = run(e, 1);
    expect(resumed.positions[0]).toBeGreaterThanOrEqual(frozen);
    expect(resumed.positions[0] - frozen).toBeLessThan(0.1);
    expect(zeroCrossingFreq(resumed.out, SR, BLOCK, resumed.out.length)).toBeGreaterThan(440 * 0.99);
    expect(maxStep(resumed.out)).toBeLessThan(0.08);
  });
});

describe('seeking', () => {
  it('jumps to the right part of the song, playing or not', () => {
    const e = makeEngine(stepSong(8));
    e.seek(5.2); // the 700 Hz second
    e.play();
    const a = run(e, 0.6);
    expect(dominantFreq(a.out, SR, 600, 800, BLOCK * 2, BLOCK * 2 + SR / 4)).toBeCloseTo(700, -1);
    e.seek(1.2); // the 300 Hz second, while playing
    const b = run(e, 0.6);
    expect(e.positionSec).toBeGreaterThan(1.2);
    expect(e.positionSec).toBeLessThan(2);
    expect(dominantFreq(b.out, SR, 250, 350, BLOCK * 4, BLOCK * 4 + SR / 4)).toBeCloseTo(300, -1);
    expect(maxStep(b.out)).toBeLessThan(0.15); // faded, no click
  });
});

describe('looping', () => {
  it('keeps going round inside the loop section', () => {
    const e = makeEngine(stepSong(8));
    e.setLoop([2, 3]); // the 400 Hz second
    e.seek(2);
    e.play();
    const r = run(e, 6);
    for (const p of r.positions.slice(2)) {
      expect(p).toBeGreaterThan(1.9);
      expect(p).toBeLessThan(3.05);
    }
    const n = r.out.length;
    expect(dominantFreq(r.out, SR, 350, 450, n - SR, n - SR + SR / 4)).toBeCloseTo(400, -1);
    expect(e.ended).toBe(false);
  });

  it('loops the whole song when given the whole song, and stops looping when switched off', () => {
    const e = makeEngine(sine(440, 2, SR));
    e.setLoop([0, 2]);
    e.seek(0);
    e.play();
    const r = run(e, 5);
    expect(e.ended).toBe(false);
    expect(Math.max(...r.positions)).toBeLessThanOrEqual(2);
    expect(rms(r.out, SR * 4, SR * 5)).toBeGreaterThan(0.25);
    e.setLoop(null);
    run(e, 3);
    expect(e.ended).toBe(true);
  });

  it('a silly tiny loop section falls back to the whole song', () => {
    const e = makeEngine(sine(440, 3, SR));
    e.setLoop([1, 1.01]);
    e.seek(0);
    e.play();
    run(e, 1.5);
    expect(e.positionSec).toBeGreaterThan(1.2);
  });
});

describe('the end of the song', () => {
  it('stops itself, tells us once, goes silent, and can start again from the top', () => {
    const e = makeEngine(sine(440, 2, SR));
    let told = 0;
    e.onEnded = () => told++;
    e.seek(0);
    e.play();
    const r = run(e, 3);
    expect(e.ended).toBe(true);
    expect(told).toBe(1);
    expect(e.positionSec).toBeGreaterThan(1.9);
    expect(rms(r.out, Math.floor(SR * 2.2), r.out.length)).toBe(0);
    run(e, 1);
    expect(told).toBe(1);
    e.play(); // after the end, play starts from the top
    run(e, 0.5);
    expect(e.ended).toBe(false);
    expect(e.positionSec).toBeLessThan(0.6);
    expect(e.positionSec).toBeGreaterThan(0.3);
  });
});

describe('a file at a different sample rate than the speakers', () => {
  it('still comes out at the right pitch and length', () => {
    const e = makeEngine(sine(440, 2, 22050), 22050);
    expect(e.durationSec).toBeCloseTo(2, 3);
    e.seek(0);
    e.play();
    const r = run(e, 1.5);
    expect(zeroCrossingFreq(r.out, SR, SR * 0.3, SR * 1.2)).toBeGreaterThan(440 * 0.99);
    expect(zeroCrossingFreq(r.out, SR, SR * 0.3, SR * 1.2)).toBeLessThan(440 * 1.01);
    expect(r.positions[r.positions.length - 1]).toBeGreaterThan(1.3);
    expect(r.positions[r.positions.length - 1]).toBeLessThan(1.6);
  });
});
