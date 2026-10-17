// At speed exactly 1.0 and pitch exactly 0 the stretcher is skipped and the song is copied straight through.
// Moving away from that and back is a short crossfade that must not click or dip.
import { describe, expect, it } from 'vitest';
import { StretchEngine } from './stretch-engine';
import { maxStep, noise, rms, sine, zeroCrossingFreq } from './test-utils';

const SR = 44100;
const BLOCK = 512;

function makeEngine(left: Float32Array, right?: Float32Array, rate = SR) {
  return new StretchEngine({ sampleRate: rate, channels: right ? [left, right] : [left] }, SR);
}

/** Render this many seconds; returns both channels and the song position (in samples) before each block. */
function run(engine: StretchEngine, seconds: number) {
  const blocks = Math.ceil((seconds * SR) / BLOCK);
  const l = new Float32Array(blocks * BLOCK);
  const r = new Float32Array(blocks * BLOCK);
  const before: number[] = [];
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  for (let b = 0; b < blocks; b++) {
    before.push(Math.round(engine.positionSec * SR));
    engine.render(L, R, BLOCK);
    l.set(L, b * BLOCK);
    r.set(R, b * BLOCK);
  }
  return { l, r, before };
}

/** True if every sample of the block equals the song sample at the position the engine had before it. */
function blockIsExact(song: Float32Array, out: Float32Array, block: number, start: number): boolean {
  for (let i = 0; i < BLOCK; i++) if (out[block * BLOCK + i] !== song[start + i]) return false;
  return true;
}

describe('straight route at neutral settings', () => {
  it('plays the song bit for bit on both channels', () => {
    const left = noise(SR * 3, 1);
    const right = noise(SR * 3, 2);
    const e = makeEngine(left, right);
    e.seek(0);
    e.play();
    const { l, r } = run(e, 2);
    expect(e.route).toBe('direct');
    let wrong = 0;
    for (let i = 400; i < l.length; i++) if (l[i] !== left[i] || r[i] !== right[i]) wrong++; // the first 256 samples fade in
    expect(wrong).toBe(0);
  });

  it('copies a mono song to both sides', () => {
    const song = noise(SR * 2, 3);
    const e = makeEngine(song);
    e.seek(0);
    e.play();
    const { l, r } = run(e, 1);
    let wrong = 0;
    for (let i = 400; i < l.length; i++) if (l[i] !== song[i] || r[i] !== song[i]) wrong++;
    expect(wrong).toBe(0);
  });

  it('stays exact after a seek, a pause and a resume', () => {
    const song = noise(SR * 6, 4);
    const e = makeEngine(song);
    e.play();
    run(e, 0.5);
    e.seek(3.21);
    const afterSeek = run(e, 0.5);
    const lastBlock = afterSeek.before.length - 1;
    expect(blockIsExact(song, afterSeek.l, lastBlock, afterSeek.before[lastBlock])).toBe(true);
    expect(afterSeek.before[lastBlock]).toBeGreaterThan(3.21 * SR);
    e.pause();
    run(e, 0.3);
    e.play();
    const resumed = run(e, 0.5);
    expect(blockIsExact(song, resumed.l, resumed.before.length - 1, resumed.before[resumed.before.length - 1])).toBe(true);
  });

  it('reports the position exactly (no lead to add)', () => {
    const e = makeEngine(noise(SR * 3, 5));
    e.seek(0);
    e.play();
    const { before } = run(e, 1);
    for (let b = 1; b < before.length; b++) expect(before[b] - before[b - 1]).toBe(BLOCK);
  });

  it('is not used when the file is at another sample rate than the speakers (it has to be resampled)', () => {
    const e = makeEngine(sine(440, 2, 22050), undefined, 22050);
    e.seek(0);
    e.play();
    run(e, 0.5);
    expect(e.route).toBe('stretch');
  });

  it('is left as soon as the speed or pitch is not exactly neutral, and used again when both are back to neutral', () => {
    const e = makeEngine(sine(440, 12, SR));
    e.seek(0);
    e.play();
    run(e, 0.3);
    expect(e.route).toBe('direct');
    e.setPitchSemitones(0.01);
    run(e, 0.3);
    expect(e.route).toBe('stretch');
    e.setPitchSemitones(0);
    run(e, 1);
    expect(e.route).toBe('direct');
    e.setTempo(1.001);
    run(e, 0.3);
    expect(e.route).toBe('stretch');
    e.setTempo(1);
    run(e, 1);
    expect(e.route).toBe('direct');
  });
});

describe('moving between the straight route and the stretcher', () => {
  it('speeding up and slowing back down makes no click and no dip, and ends up exact again', () => {
    const song = sine(440, 14, SR);
    const e = makeEngine(song);
    e.seek(0);
    e.play();
    const a = run(e, 0.5);
    e.setTempo(1.5);
    const b = run(e, 1.5);
    e.setTempo(1);
    const c = run(e, 1.5);
    const all = new Float32Array(a.l.length + b.l.length + c.l.length);
    all.set(a.l, 0);
    all.set(b.l, a.l.length);
    all.set(c.l, a.l.length + b.l.length);
    const steady = maxStep(a.l, SR / 4, a.l.length); // a clean 440 Hz tone at this volume steps at most about 0.031
    const whole = maxStep(all, SR / 4);
    // the level never sags: every 5 ms stretch of the whole run is a full-strength tone (rms 0.354)
    let quietest = Infinity;
    for (let at = 8000; at + 220 < all.length; at += 110) quietest = Math.min(quietest, rms(all, at, at + 220));
    console.log(`switch check: steady step ${steady.toFixed(4)}, biggest step over the whole run ${whole.toFixed(4)}, quietest 5 ms ${quietest.toFixed(3)}`);
    expect(whole).toBeLessThan(steady * 1.6);
    expect(quietest).toBeGreaterThan(0.354 * 0.85);
    // at 1.5x the tone keeps its pitch
    expect(zeroCrossingFreq(b.l, SR, SR / 2, b.l.length)).toBeGreaterThan(440 * 0.99);
    expect(zeroCrossingFreq(b.l, SR, SR / 2, b.l.length)).toBeLessThan(440 * 1.01);
    // and the last stretch is the song itself again, bit for bit
    expect(e.route).toBe('direct');
    const lastBlock = c.before.length - 1;
    expect(blockIsExact(song, c.l, lastBlock, c.before[lastBlock])).toBe(true);
  });

  it('a pitch change away from neutral and back also stays smooth, and lands exact', () => {
    const song = sine(330, 14, SR);
    const e = makeEngine(song);
    e.seek(0);
    e.play();
    const a = run(e, 0.5);
    e.setPitchSemitones(7);
    const b = run(e, 1.5);
    e.setPitchSemitones(0);
    const c = run(e, 1.5);
    const steadyUp = 0.5 * 2 * Math.PI * 330 * 2 ** (7 / 12) / SR;
    expect(maxStep(a.l, SR / 4)).toBeLessThan(0.5 * 2 * Math.PI * 330 / SR * 1.05);
    expect(maxStep(b.l)).toBeLessThan(steadyUp * 1.6);
    expect(maxStep(c.l)).toBeLessThan(steadyUp * 1.6);
    expect(e.route).toBe('direct');
    const lastBlock = c.before.length - 1;
    expect(blockIsExact(song, c.l, lastBlock, c.before[lastBlock])).toBe(true);
  });

  it('lines the two routes up on real-sounding music (a chord with a beat), without a jump in the song position', () => {
    // 3 notes plus a click on every beat, so there is something to line up against
    const n = SR * 14;
    const song = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      song[i] = 0.2 * Math.sin(2 * Math.PI * 196 * t) + 0.15 * Math.sin(2 * Math.PI * 247 * t) + 0.12 * Math.sin(2 * Math.PI * 392 * t) + (i % (SR / 2) < 300 ? 0.3 * Math.sin(i * 0.9) * (1 - (i % (SR / 2)) / 300) : 0);
    }
    const e = makeEngine(song);
    e.seek(0);
    e.play();
    const a = run(e, 1);
    e.setTempo(0.75);
    const b = run(e, 2);
    e.setTempo(1);
    const c = run(e, 2);
    const all = [...a.before, ...b.before, ...c.before];
    let worstJump = 0;
    for (let i = 1; i < all.length; i++) worstJump = Math.max(worstJump, Math.abs(all[i] - all[i - 1] - BLOCK * (i > a.before.length && i <= a.before.length + b.before.length ? 0.75 : 1)));
    console.log(`music switch check: biggest position surprise ${((worstJump / SR) * 1000).toFixed(1)} ms`);
    expect(worstJump / SR).toBeLessThan(0.06);
    expect(e.route).toBe('direct');
  });

  it('survives a storm of speed, pitch, loop, seek, pause and resume changes: always finite, never louder than the song, always inside it', () => {
    const song = noise(SR * 20, 21, 0.5);
    const e = makeEngine(song, noise(SR * 20, 22, 0.5));
    let seed = 12345;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const L = new Float32Array(300);
    const R = new Float32Array(300);
    e.seek(0);
    e.play();
    const routes = new Set<string>();
    for (let step = 0; step < 400; step++) {
      const what = Math.floor(rand() * 8);
      if (what === 0) e.setTempo([1, 1, 0.5, 0.75, 1.25, 1.5][Math.floor(rand() * 6)]);
      else if (what === 1) e.setPitchSemitones([0, 0, 0, 3, -5, 12, -12][Math.floor(rand() * 7)]);
      else if (what === 2) e.setLoop(rand() < 0.5 ? null : [rand() * 5, 5.2 + rand() * 6]);
      else if (what === 3) e.seek(rand() * 19);
      else if (what === 4) e.pause();
      else if (what === 5) e.play();
      for (let k = 0; k < 1 + Math.floor(rand() * 12); k++) {
        e.render(L, R, 300);
        for (let i = 0; i < 300; i++) {
          if (!Number.isFinite(L[i]) || !Number.isFinite(R[i]) || Math.abs(L[i]) > 1 || Math.abs(R[i]) > 1) throw new Error(`bad sample ${L[i]} ${R[i]} at step ${step}`);
        }
        expect(e.positionSec).toBeGreaterThanOrEqual(0);
        expect(e.positionSec).toBeLessThanOrEqual(e.durationSec);
        routes.add(e.route);
      }
    }
    expect(routes.size).toBe(2); // both routes were used
    // and after all that it still settles: neutral settings give the straight route and an exact copy again
    e.setLoop(null);
    e.setTempo(1);
    e.setPitchSemitones(0);
    e.seek(2);
    e.play();
    const r = run(e, 1);
    expect(e.route).toBe('direct');
    const lastBlock = r.before.length - 1;
    expect(blockIsExact(song, r.l, lastBlock, r.before[lastBlock])).toBe(true);
  });

  it('works on a short song and at the very start, and never makes silence or noise out of nothing', () => {
    const e = makeEngine(sine(440, 3, SR));
    e.seek(0);
    e.play();
    e.setTempo(1.5);
    const r = run(e, 1.2);
    expect(rms(r.l, SR / 2, r.l.length)).toBeGreaterThan(0.3);
    expect(maxStep(r.l, 300)).toBeLessThan(0.06);
    expect(Number.isFinite(e.positionSec)).toBe(true);
  });
});
