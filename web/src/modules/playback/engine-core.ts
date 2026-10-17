// The sound engine itself: plays a pile of samples at any speed (0.5x to 1.5x) and any pitch (-12 to +12 semitones),
// each on its own. It only works on plain Float32Arrays, so it runs (and is tested) in Node, on the page, and inside
// the audio worklet.
//
// Three things it does beyond "ask the stretcher for the next block":
//  - Neutral bypass: at speed exactly 1.0 and pitch exactly 0 the stretcher is skipped and the song is copied straight
//    through, sample for sample. Moving in and out of it is a short, lined-up crossfade (no click, no dip).
//  - Loop wrap: the last few milliseconds before the loop end are blended (equal power) with the sound just before the
//    loop start, so the wrap has no tick.
//  - Position: the stretcher plays a little ahead of its plain "input used up" count. positionSec adds that lead back
//    in, so it matches what is heard.
//
// IMPORTANT: defineEngine() is also copied as TEXT into the audio worklet (see worklet-source.ts). Keep it self-contained:
// no imports at run time, no class fields or private "#" names (those turn into helper calls when the build lowers the
// code), nothing from outside the function except plain JavaScript.
import type { StretchPipeline } from './soundtouch-lib';

export interface PcmSource {
  sampleRate: number;
  /** One array per channel (mono or stereo; extra channels are ignored). */
  channels: Float32Array[];
}

/** Where to wrap, in song seconds. null means no looping. */
export type LoopRegion = [number, number] | null;

export interface EngineCore {
  readonly durationSec: number;
  /** Called once from inside render() when a song that is not looping has played to its end. */
  onEnded: (() => void) | null;
  readonly ended: boolean;
  readonly running: boolean;
  /** Where in the song the sound you hear right now comes from (song seconds). */
  readonly positionSec: number;
  /** Which route the sound takes: straight from the song ('direct') or through the stretcher ('stretch'). */
  readonly route: 'direct' | 'stretch';
  setTempo(t: number): void;
  setPitchSemitones(s: number): void;
  setLoop(region: LoopRegion): void;
  play(): void;
  pause(): void;
  /** Jump to a place in the song (song seconds). If sound is playing it fades out first, jumps, and fades back in. */
  seek(sec: number): void;
  /** Fill left and right with the next `frames` samples (silence when paused). */
  render(left: Float32Array, right: Float32Array, frames: number): void;
}

export type CreateEngine = (source: PcmSource, outSampleRate: number) => EngineCore;

export function defineEngine(createPipeline: (sampleRate: number) => StretchPipeline): CreateEngine {
  const FEED_FRAMES = 1024; // how much song we hand the stretcher at a time
  const STEP_FRAMES = 256; // speed and pitch are nudged this often (about every 6 ms)
  const FADE_FRAMES = 256; // start, stop and seek fade over this many samples so there is no click
  const SWITCH_FRAMES = 256; // moving between the straight route and the stretcher is a crossfade this long (about 6 ms)
  const GLIDE_SEC = 0.05; // speed and pitch glide to a new value over about this long
  const LEAD_SEC = 0.02; // the position lead follows its measured value over about this long
  const MIN_LOOP_SEC = 0.1;
  const LOOP_FADE_SEC = 0.007; // the loop wrap crossfade
  const SEARCH_SEC = 0.03; // how far each way to look when lining the two routes up

  /** A run of the input that came from one unbroken stretch of the song (a loop wrap starts a new one). */
  interface Segment {
    /** Count of input samples fed before this run began. */
    inStart: number;
    /** Song sample this run began at. */
    src: number;
    /** Song sample this run stopped at (set when the next run starts). */
    endSrc: number;
  }
  /** A read pointer into the song. */
  interface Reader {
    pos: number;
  }
  interface Fade {
    /** true: the stretcher is fading out and the straight route in. false: the other way round. */
    toDirect: boolean;
    done: number;
    len: number;
  }

  return function createEngine(source: PcmSource, outRate: number): EngineCore {
    const left = source.channels[0];
    if (!left) throw new Error('The song has no audio channels.');
    const right = source.channels[1] ?? left;
    const total = left.length;
    const srcRate = source.sampleRate;
    const durationSec = total / srcRate;
    const pipe = createPipeline(outRate);
    // The straight route can only copy; it cannot change the sample rate.
    const canBypass = srcRate === outRate;
    const searchFrames = Math.round(SEARCH_SEC * srcRate);
    const startup = pipe.startupFrames();
    const warmFrames = startup + 32;
    const maxShift = searchFrames + startup; // the furthest the stretcher's output can sit from where we expect it
    const tapeFrames = warmFrames + maxShift + SWITCH_FRAMES;

    let loopOn = false;
    let loopStart = 0;
    let loopEnd = 0;
    let loopFade = 0;
    let fadeA = new Float32Array(0); // loop wrap crossfade gains: what stays, and what comes in from before the loop start
    let fadeB = new Float32Array(0);

    let tempoTarget = 1;
    let tempoNow = 1;
    let pitchTarget = 0;
    let pitchNow = 0;

    // The stretcher route. "fed" counts song samples that went into the stretcher, "consumed" counts how many came out
    // the other end (output samples times speed). Together with the segments that gives where the stretcher is.
    const stretchReader: Reader = { pos: 0 }; // next song sample to hand to the stretcher
    let fed = 0;
    let consumed = 0;
    let segments: Segment[] = [{ inStart: 0, src: 0, endSrc: Infinity }];
    let lead = 0; // how far the heard sound runs ahead of "consumed", in song samples

    // The straight route.
    const directReader: Reader = { pos: 0 };

    let route: 'direct' | 'stretch' = canBypass ? 'direct' : 'stretch'; // who owns the position when no crossfade is running
    let fade: Fade | null = null;

    let wantRunning = false;
    let pendingSeek: number | null = null;
    let gain = 0;
    let endedFlag = false;

    // Sound the stretcher already made but we have not played yet (it is made ahead of time to line the routes up).
    const stash = new Float32Array(tapeFrames * 2);
    let stashStart = 0;
    let stashEnd = 0;

    const feedBuf = new Float32Array(FEED_FRAMES * 2);
    const pullBuf = new Float32Array(STEP_FRAMES * 2);
    const directBuf = new Float32Array(STEP_FRAMES * 2);
    const stepL = new Float32Array(STEP_FRAMES);
    const stepR = new Float32Array(STEP_FRAMES);
    const refMono = new Float32Array(SWITCH_FRAMES);
    const candMono = new Float32Array(Math.max(2 * searchFrames, maxShift) + SWITCH_FRAMES);

    const noWrap = () => {};

    // ---- reading the song (with the loop wrap blend) ----
    function setLoopTables(): void {
      const fadeLen = Math.max(0, Math.min(Math.round(LOOP_FADE_SEC * srcRate), Math.floor((loopEnd - loopStart) / 2)));
      if (fadeLen === loopFade) return;
      loopFade = fadeLen;
      fadeA = new Float32Array(fadeLen);
      fadeB = new Float32Array(fadeLen);
      for (let i = 0; i < fadeLen; i++) {
        const t = ((i + 0.5) / fadeLen) * (Math.PI / 2);
        fadeA[i] = Math.cos(t);
        fadeB[i] = Math.sin(t);
      }
    }

    /**
     * Copy up to maxN frames from reader.pos into dst (interleaved, from frame dstFrame). Never crosses the loop end
     * or the song end. The last few milliseconds before the loop end are blended with the sound before the loop start.
     */
    function readChunk(r: Reader, dst: Float32Array, dstFrame: number, maxN: number): number {
      const heading = loopOn && r.pos < loopEnd;
      const limit = heading ? loopEnd : total;
      const n = Math.min(maxN, limit - r.pos);
      if (n <= 0) return 0;
      const pos = r.pos;
      for (let k = 0; k < n; k++) {
        dst[2 * (dstFrame + k)] = left[pos + k];
        dst[2 * (dstFrame + k) + 1] = right[pos + k];
      }
      if (heading && loopFade > 0) {
        const zoneStart = loopEnd - loopFade;
        for (let k = Math.max(0, zoneStart - pos); k < n; k++) {
          const i = pos + k - zoneStart;
          const from = loopStart - loopFade + i; // the sound just before the loop start (nothing there: silence)
          const a = fadeA[i];
          const b = fadeB[i];
          const o = 2 * (dstFrame + k);
          dst[o] = a * dst[o] + (from >= 0 ? b * left[from] : 0);
          dst[o + 1] = a * dst[o + 1] + (from >= 0 ? b * right[from] : 0);
        }
      }
      return n;
    }

    /** Fill n frames from the reader, wrapping at the loop end, or padding with silence after the end. */
    function readFrames(r: Reader, dst: Float32Array, n: number, onWrap: (atFrame: number, from: number) => void): void {
      let i = 0;
      while (i < n) {
        // Wrap at the loop end if we are heading for it from below; a playhead already past it runs on to the song's end.
        const limit = loopOn && r.pos < loopEnd ? loopEnd : total;
        if (r.pos >= limit) {
          if (!loopOn) {
            dst.fill(0, 2 * i, 2 * n);
            return;
          }
          onWrap(i, r.pos);
          r.pos = loopStart;
          continue;
        }
        const took = readChunk(r, dst, i, n - i);
        r.pos += took;
        i += took;
        if (loopOn && r.pos === loopEnd) {
          onWrap(i, r.pos);
          r.pos = loopStart;
        }
      }
    }

    function noteWrap(atFrame: number, from: number): void {
      segments[segments.length - 1].endSrc = from;
      segments.push({ inStart: fed + atFrame, src: loopStart, endSrc: Infinity });
    }

    // ---- the stretcher route ----
    function inputPerOutput(): number {
      return tempoNow * (srcRate / outRate);
    }

    function applyParams(): void {
      const rate = srcRate / outRate;
      pipe.setResample(rate * 2 ** (pitchNow / 12));
      pipe.setSpeed(tempoNow * rate);
    }

    function snapParams(): void {
      if (tempoNow === tempoTarget && pitchNow === pitchTarget) return;
      tempoNow = tempoTarget;
      pitchNow = pitchTarget;
      applyParams();
    }

    function glideParams(frames: number): void {
      if (tempoNow === tempoTarget && pitchNow === pitchTarget) return;
      const a = 1 - Math.exp(-frames / (outRate * GLIDE_SEC));
      const step = (now: number, target: number, eps: number) => (Math.abs(target - now) < eps ? target : now + (target - now) * a);
      tempoNow = step(tempoNow, tempoTarget, 0.002);
      pitchNow = step(pitchNow, pitchTarget, 0.02);
      applyParams();
    }

    function feed(n: number): void {
      readFrames(stretchReader, feedBuf, n, noteWrap);
      pipe.input.putSamples(feedBuf, 0, n);
      fed += n;
    }

    /** Take n frames out of the stretcher into dst (from frame dstFrame). False if it could not make that many. */
    function pullRaw(dst: Float32Array, dstFrame: number, n: number): boolean {
      const out = pipe.output;
      let guard = 64;
      while (out.frameCount < n && guard-- > 0) {
        feed(FEED_FRAMES);
        pipe.process();
      }
      if (out.frameCount < n) return false;
      out.receiveSamples(dstFrame === 0 ? dst : dst.subarray(2 * dstFrame), n);
      return true;
    }

    /** Get n sound frames into pullBuf: first what was made ahead of time, then fresh from the stretcher. Returns how many are real. */
    function pull(n: number): number {
      let have = 0;
      const ahead = Math.min(n, stashEnd - stashStart);
      if (ahead > 0) {
        pullBuf.set(stash.subarray(2 * stashStart, 2 * (stashStart + ahead)), 0);
        stashStart += ahead;
        have = ahead;
        if (stashStart >= stashEnd) stashStart = stashEnd = 0;
      }
      if (have < n && pullRaw(pullBuf, have, n - have)) have = n;
      return have;
    }

    /** Make sure at least n frames are waiting in the stash. False if the stretcher could not make them. */
    function fillStash(n: number): boolean {
      if (stashEnd === stashStart) stashStart = stashEnd = 0;
      else if (stashEnd + n > tapeFrames) {
        // Make room: slide what is left to the front.
        stash.copyWithin(0, 2 * stashStart, 2 * stashEnd);
        stashEnd -= stashStart;
        stashStart = 0;
      }
      while (stashEnd - stashStart < n) {
        const take = Math.min(n - (stashEnd - stashStart), STEP_FRAMES);
        if (!pullRaw(pullBuf, 0, take)) return false;
        stash.set(pullBuf.subarray(0, 2 * take), 2 * stashEnd);
        stashEnd += take;
      }
      return true;
    }

    /** Start the stretcher fresh at a song sample. */
    function primeStretch(frame: number): void {
      stretchReader.pos = frame;
      fed = 0;
      consumed = 0;
      segments = [{ inStart: 0, src: frame, endSrc: Infinity }];
      stashStart = stashEnd = 0;
      lead = 0;
      pipe.clear();
      applyParams();
    }

    function updateLead(frames: number): void {
      const a = 1 - Math.exp(-frames / (outRate * LEAD_SEC));
      lead += (pipe.leadFrames() - lead) * a;
    }

    /** The song sample the stretcher is at, if `extra` more input samples had been used up. */
    function stretchFrames(extra: number): number {
      const s = segments;
      const c = consumed + extra;
      let i = 0;
      while (i + 1 < s.length && s[i + 1].inStart <= c) i++;
      // The estimate can run a little ahead near a loop wrap; it can never be past what was really fed.
      const limit = i + 1 < s.length ? s[i].endSrc : Math.min(stretchReader.pos, total);
      return Math.min(s[i].src + (c - s[i].inStart), limit, total);
    }

    function prune(): void {
      const s = segments;
      let i = 0;
      while (i + 1 < s.length && s[i + 1].inStart <= consumed) i++;
      if (i > 0) s.splice(0, i);
    }

    // ---- lining two routes up ----
    /**
     * Where in `cand` (positions 0..shiftMax) does `ref` fit best? Normalised correlation, coarse then fine, leaning a
     * little towards `prefer`. Returns `prefer` when there is nothing to line up (silence, or no real match).
     */
    function bestAlign(ref: Float32Array, refLen: number, cand: Float32Array, shiftMax: number, prefer: number): number {
      let refEnergy = 0;
      for (let k = 0; k < refLen; k++) refEnergy += ref[k] * ref[k];
      if (refEnergy < 1e-9) return prefer;
      const score = (s: number, step: number) => {
        let dot = 0;
        let energy = 1e-12;
        for (let k = 0; k < refLen; k += step) {
          const c = cand[s + k];
          dot += ref[k] * c;
          energy += c * c;
        }
        return dot / Math.sqrt(energy * refEnergy);
      };
      const lean = (s: number) => (0.05 * Math.abs(s - prefer)) / Math.max(1, shiftMax);
      let best = prefer;
      let bestScore = -Infinity;
      for (let s = 0; s <= shiftMax; s += 2) {
        const v = score(s, 2) - lean(s);
        if (v > bestScore) {
          bestScore = v;
          best = s;
        }
      }
      let fineBest = best;
      let fineScore = -Infinity;
      for (let s = Math.max(0, best - 2); s <= Math.min(shiftMax, best + 2); s++) {
        const v = score(s, 1) - lean(s);
        if (v > fineScore) {
          fineScore = v;
          fineBest = s;
        }
      }
      return fineScore < 0.2 ? prefer : fineBest;
    }

    // Run the line-up search once on made-up numbers, so the very first real switch is not slowed down by the script
    // engine warming up (a slow first switch could be heard as a hiccup).
    for (let k = 0; k < SWITCH_FRAMES; k++) refMono[k] = Math.sin(k * 0.3);
    for (let j = 0; j < candMono.length; j++) candMono[j] = Math.sin(j * 0.3);
    bestAlign(refMono, SWITCH_FRAMES, candMono, maxShift, searchFrames);

    /** The straight route is about to take over from the stretcher: find where in the song the stretcher's sound really is. */
    function beginToDirect(): void {
      const len = SWITCH_FRAMES;
      if (!fillStash(len)) {
        // The stretcher cannot say; cut over where it thinks it is.
        directReader.pos = Math.round(stretchFrames(lead));
        route = 'direct';
        stashStart = stashEnd = 0;
        return;
      }
      const expected = Math.round(stretchFrames(lead));
      const from = expected - searchFrames;
      for (let k = 0; k < len; k++) refMono[k] = stash[2 * (stashStart + k)];
      const span = 2 * searchFrames + len;
      for (let j = 0; j < span; j++) {
        const f = from + j;
        candMono[j] = f >= 0 && f < total ? left[f] : 0;
      }
      const shift = bestAlign(refMono, len, candMono, 2 * searchFrames, searchFrames);
      directReader.pos = Math.min(Math.max(from + shift, 0), total);
      fade = { toDirect: true, done: 0, len };
    }

    /** The stretcher is about to take over from the straight route: start it a little early, then find where its sound lines up. */
    function beginToStretch(): void {
      const p0 = directReader.pos;
      tempoNow = 1;
      pitchNow = 0;
      primeStretch(Math.max(0, p0 - startup - searchFrames));
      const tape = stash;
      let ok = true;
      for (let at = 0; ok && at < tapeFrames; at += STEP_FRAMES) {
        const n = Math.min(STEP_FRAMES, tapeFrames - at);
        ok = pullRaw(pullBuf, 0, n);
        if (ok) tape.set(pullBuf.subarray(0, 2 * n), 2 * at);
      }
      if (!ok) {
        // Could not make the sound ahead of time: start the stretcher where the straight route is and accept a tiny seam.
        primeStretch(p0);
        route = 'stretch';
        return;
      }
      // What the straight route would play next, to line the stretcher up with.
      const probe: Reader = { pos: p0 };
      readFrames(probe, directBuf, SWITCH_FRAMES, noWrap);
      for (let k = 0; k < SWITCH_FRAMES; k++) refMono[k] = directBuf[2 * k];
      const span = maxShift + SWITCH_FRAMES;
      for (let j = 0; j < span; j++) candMono[j] = tape[2 * (warmFrames + j)];
      const shift = bestAlign(refMono, SWITCH_FRAMES, candMono, maxShift, searchFrames);
      stashStart = warmFrames + shift;
      stashEnd = tapeFrames;
      consumed += stashStart * inputPerOutput();
      // Now we know exactly how far ahead of its plain count the stretcher is: start from that.
      lead = Math.min(Math.max(p0 - stretchFrames(0), -0.2 * srcRate), 0.2 * srcRate);
      fade = { toDirect: false, done: 0, len: SWITCH_FRAMES };
    }

    function finishFade(): void {
      if (fade === null) return;
      route = fade.toDirect ? 'direct' : 'stretch';
      if (fade.toDirect) stashStart = stashEnd = 0;
      fade = null;
    }

    /** While nothing can be heard, switch routes at once (no crossfade needed). */
    function settleWhileSilent(): void {
      snapParams();
      finishFade();
      if (!canBypass) return;
      const neutral = tempoNow === 1 && pitchNow === 0;
      if (neutral && route === 'stretch') {
        directReader.pos = Math.min(Math.max(Math.round(stretchFrames(lead)), 0), total);
        route = 'direct';
        stashStart = stashEnd = 0;
      } else if (!neutral && route === 'direct') {
        route = 'stretch';
        primeStretch(directReader.pos);
      }
    }

    /** While sound is playing: start a crossfade to the other route if the settings call for it. */
    function updateRoute(): void {
      if (!canBypass) return;
      const neutralTarget = tempoTarget === 1 && pitchTarget === 0;
      if (route === 'direct') {
        if (!neutralTarget) beginToStretch();
      } else if (neutralTarget && tempoNow === 1 && pitchNow === 0) {
        beginToDirect();
      }
    }

    // ---- one step of sound (n <= STEP_FRAMES frames into stepL / stepR, before the volume fade) ----
    function produce(n: number): void {
      const f = fade;
      if (f === null) {
        if (route === 'direct') {
          readFrames(directReader, directBuf, n, noWrap);
          for (let i = 0; i < n; i++) {
            stepL[i] = directBuf[2 * i];
            stepR[i] = directBuf[2 * i + 1];
          }
        } else {
          glideParams(n);
          const got = pull(n);
          for (let i = 0; i < n; i++) {
            const ok = i < got;
            stepL[i] = ok ? pullBuf[2 * i] : 0;
            stepR[i] = ok ? pullBuf[2 * i + 1] : 0;
          }
          consumed += n * inputPerOutput();
          updateLead(n);
          prune();
        }
        return;
      }
      // Both routes at once: the straight one and the stretcher (which is at neutral settings for the whole crossfade).
      const got = pull(n);
      readFrames(directReader, directBuf, n, noWrap);
      for (let i = 0; i < n; i++) {
        const at = f.done + i;
        const w = at >= f.len ? 1 : (at + 0.5) / f.len; // how much of the route we are moving TO
        const sOk = i < got;
        const s0 = sOk ? pullBuf[2 * i] : 0;
        const s1 = sOk ? pullBuf[2 * i + 1] : 0;
        const d0 = directBuf[2 * i];
        const d1 = directBuf[2 * i + 1];
        if (f.toDirect) {
          stepL[i] = s0 + (d0 - s0) * w;
          stepR[i] = s1 + (d1 - s1) * w;
        } else {
          stepL[i] = d0 + (s0 - d0) * w;
          stepR[i] = d1 + (s1 - d1) * w;
        }
      }
      consumed += n * inputPerOutput();
      prune();
      f.done += n;
      if (f.done >= f.len) finishFade();
    }

    // ---- the song position ----
    function nominalFrames(): number {
      return route === 'direct' ? Math.min(directReader.pos, total) : stretchFrames(0);
    }

    function reportedFrames(): number {
      if (pendingSeek !== null) return pendingSeek;
      return route === 'direct' ? Math.min(directReader.pos, total) : stretchFrames(lead);
    }

    function doSeek(frame: number): void {
      pendingSeek = null;
      fade = null;
      directReader.pos = frame;
      snapParams();
      route = canBypass && tempoNow === 1 && pitchNow === 0 ? 'direct' : 'stretch';
      primeStretch(frame);
    }

    const api: EngineCore = {
      durationSec,
      onEnded: null,
      get ended() {
        return endedFlag;
      },
      get running() {
        return wantRunning;
      },
      get positionSec() {
        return reportedFrames() / srcRate;
      },
      get route() {
        return route;
      },
      setTempo(t) {
        if (Number.isFinite(t) && t > 0) tempoTarget = t;
      },
      setPitchSemitones(s) {
        if (Number.isFinite(s)) pitchTarget = s;
      },
      setLoop(region) {
        if (!region) {
          loopOn = false;
          return;
        }
        let a = Math.round(Math.min(region[0], region[1]) * srcRate);
        let b = Math.round(Math.max(region[0], region[1]) * srcRate);
        a = Math.min(Math.max(a, 0), total);
        b = Math.min(Math.max(b, 0), total);
        if (b - a < MIN_LOOP_SEC * srcRate) {
          a = 0;
          b = total;
        }
        loopStart = a;
        loopEnd = b;
        loopOn = b > a;
        setLoopTables();
      },
      play() {
        if (endedFlag) api.seek(0);
        wantRunning = true;
      },
      pause() {
        wantRunning = false;
      },
      seek(sec) {
        const frame = Math.min(Math.max(Math.round((Number.isFinite(sec) ? sec : 0) * srcRate), 0), total);
        endedFlag = false;
        if (gain <= 0) doSeek(frame);
        else pendingSeek = frame;
      },
      render(outL, outR, frames) {
        let out = 0;
        while (out < frames) {
          const n = Math.min(STEP_FRAMES, frames - out);
          if (gain <= 0 && pendingSeek !== null) doSeek(pendingSeek);
          if (gain <= 0) settleWhileSilent(); // nothing is audible yet, so this is the moment to switch routes
          const target = wantRunning && pendingSeek === null ? 1 : 0;
          if (gain <= 0 && target === 0) {
            outL.fill(0, out, out + n);
            outR.fill(0, out, out + n);
            out += n;
            continue;
          }
          if (fade === null) updateRoute();
          produce(n);
          const inc = 1 / FADE_FRAMES;
          for (let i = 0; i < n; i++) {
            if (gain < target) gain = Math.min(target, gain + inc);
            else if (gain > target) gain = Math.max(target, gain - inc);
            outL[out + i] = stepL[i] * gain;
            outR[out + i] = stepR[i] * gain;
          }
          out += n;
          if (!loopOn && nominalFrames() >= total - 1 && !endedFlag) {
            endedFlag = true;
            wantRunning = false;
            gain = 0;
            pendingSeek = null;
            outL.fill(0, out, frames);
            outR.fill(0, out, frames);
            if (api.onEnded) api.onEnded();
            return;
          }
        }
      },
    };
    return api;
  };
}
