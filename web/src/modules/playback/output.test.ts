// The browser end of the playback module with pretend audio parts: which sound path gets chosen (worklet or script
// node), what happens when the worklet is missing, cannot load, says it broke, or goes silent, and that the song,
// the place in it and the settings survive the switch. The "worklet" here runs the real worklet logic in-process.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineEngine } from './engine-core';
import { WebAudioOutput, type MakeWorkletNode } from './output';
import { createPipeline } from './soundtouch-lib';
import { rms, sine, zeroCrossingFreq } from './test-utils';
import type { WorkletNodeLike } from './worklet-backend';
import { defineWorkletCore, type FromWorklet, type ToWorklet } from './worklet-core';

const SR = 44100;
const QUANTUM = 128;
const BLOCK = 4096;

class FakeParam {
  value = 1;
  setTargetAtTime(v: number): void {
    this.value = v;
  }
}
class FakeNode {
  gain = new FakeParam();
  onaudioprocess: ((e: unknown) => void) | null = null;
  connected = true;
  connect(): void {}
  disconnect(): void {
    this.connected = false;
  }
}
class FakeContext {
  sampleRate = SR;
  currentTime = 0;
  state: 'running' | 'suspended' = 'running';
  destination = {};
  outputLatency: number | undefined;
  baseLatency: number | undefined;
  audioWorklet: object | undefined = {};
  gainNode = new FakeNode();
  scripts: FakeNode[] = [];
  createGain() {
    return this.gainNode;
  }
  createScriptProcessor() {
    const node = new FakeNode();
    this.scripts.push(node);
    return node;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
}

/** A worklet node that runs the real worklet logic right here. `deaf` = it never answers; `sink` collects what the page sent. */
function inProcessWorklet(ctx: FakeContext, mode: { deaf?: boolean } = {}) {
  const sent: ToWorklet[] = [];
  const transfers: Transferable[][] = [];
  const core = defineWorkletCore(defineEngine(createPipeline))({
    sampleRate: ctx.sampleRate,
    time: () => ctx.currentTime,
    post: (m: FromWorklet) => {
      if (!mode.deaf) node.port.onmessage?.({ data: m });
    },
  });
  const node = {
    port: {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      postMessage: (m: unknown, transfer?: Transferable[]) => {
        sent.push(m as ToWorklet);
        if (transfer) transfers.push(transfer);
        core.handle(m as ToWorklet);
      },
      close: vi.fn(),
    },
    onprocessorerror: null as ((e: unknown) => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  /** Run the audio thread for this many seconds (128 frames at a time), moving the audio clock along. Returns the left channel. */
  const pump = (seconds: number) => {
    const blocks = Math.ceil((seconds * ctx.sampleRate) / QUANTUM);
    const out = new Float32Array(blocks * QUANTUM);
    const l = new Float32Array(QUANTUM);
    const r = new Float32Array(QUANTUM);
    for (let b = 0; b < blocks; b++) {
      core.render(l, r, QUANTUM);
      out.set(l, b * QUANTUM);
      ctx.currentTime += QUANTUM / ctx.sampleRate;
    }
    return out;
  };
  return { node: node as unknown as WorkletNodeLike & typeof node, sent, transfers, pump, core };
}

/** Ask the script node for blocks of sound the way the browser would. Returns the left channel. */
function pumpScript(ctx: FakeContext, blocks: number): Float32Array {
  const out = new Float32Array(blocks * BLOCK);
  const node = ctx.scripts[ctx.scripts.length - 1];
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    node.onaudioprocess?.({ outputBuffer: { numberOfChannels: 2, getChannelData: (i: number) => (i === 0 ? l : r) } });
    out.set(l, b * BLOCK);
    ctx.currentTime += BLOCK / SR;
  }
  return out;
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const tone = () => ({ sampleRate: SR, channels: [sine(440, 20, SR)] });

let ctx: FakeContext;
let warn: ReturnType<typeof vi.spyOn>;

function makeOutput(make: MakeWorkletNode | boolean | undefined, watchdogMs = 1000) {
  return new WebAudioOutput(
    () => ctx as unknown as AudioContext,
    async () => {
      ctx.state = 'running';
    },
    { worklet: make, watchdogMs },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  ctx = new FakeContext();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});

describe('choosing the sound path', () => {
  it('uses the script node straight away when the browser has no audio worklet', () => {
    ctx.audioWorklet = undefined;
    const out = new WebAudioOutput(() => ctx as unknown as AudioContext);
    out.load(tone());
    expect(out.soundPath).toBe('script');
    expect(ctx.scripts).toHaveLength(1);
  });

  it('uses the script node when told not to use the worklet', () => {
    const out = makeOutput(false);
    out.load(tone());
    expect(out.soundPath).toBe('script');
  });

  it('uses the worklet when it loads, and the script node is never made', async () => {
    const w = inProcessWorklet(ctx);
    const out = makeOutput(async () => w.node);
    out.load(tone());
    expect(out.soundPath).toBe('starting');
    await flush();
    expect(out.soundPath).toBe('worklet');
    expect(ctx.scripts).toHaveLength(0);
    expect(w.node.connect).toHaveBeenCalledWith(ctx.gainNode);
  });
});

describe('the worklet path', () => {
  async function started() {
    const w = inProcessWorklet(ctx);
    const out = makeOutput(async () => w.node);
    out.load(tone());
    await flush();
    return { w, out };
  }

  it('plays, reports a position that follows the audio clock, changes speed, seeks, pauses and ends', async () => {
    const { w, out } = await started();
    expect(out.durationSec).toBeCloseTo(20, 3);
    out.play();
    const a = w.pump(1);
    expect(rms(a, SR / 2, a.length)).toBeGreaterThan(0.25);
    expect(out.positionSec).toBeGreaterThan(0.9);
    expect(out.positionSec).toBeLessThan(1.05);
    out.setTempo(1.5);
    const before = out.positionSec;
    w.pump(1);
    expect(out.positionSec - before).toBeGreaterThan(1.2);
    expect(out.positionSec - before).toBeLessThan(1.6);

    out.seek(10); // reads as 10 at once, before the worklet has even answered
    expect(out.positionSec).toBe(10);
    w.pump(0.3);
    expect(out.positionSec).toBeGreaterThan(10);
    expect(out.positionSec).toBeLessThan(10.8);

    out.pause();
    w.pump(0.3);
    const frozen = out.positionSec;
    const quiet = w.pump(0.5);
    expect(rms(quiet)).toBe(0);
    expect(out.positionSec).toBeCloseTo(frozen, 3);

    let ended = 0;
    out.onEnded = () => ended++;
    out.setTempo(1);
    out.seek(19.5);
    out.play();
    w.pump(1.5);
    expect(ended).toBe(1);
  });

  it('keeps pitch and speed independent end to end', async () => {
    const { w, out } = await started();
    out.setPitch(12);
    out.play();
    w.pump(1);
    const a = w.pump(0.5);
    expect(zeroCrossingFreq(a, SR, 0, a.length)).toBeGreaterThan(880 * 0.99);
    expect(zeroCrossingFreq(a, SR, 0, a.length)).toBeLessThan(880 * 1.01);
  });

  it('what was asked for before the worklet was ready is applied once it is (song, speed, loop, play)', async () => {
    const w = inProcessWorklet(ctx);
    const out = makeOutput(async () => w.node);
    out.load(tone());
    out.setTempo(0.5);
    out.setLoop([2, 3]);
    out.seek(2);
    out.play();
    out.setVolume(0.5);
    await flush();
    const a = w.pump(2);
    expect(rms(a, SR / 2, a.length)).toBeGreaterThan(0.05); // sound, at half volume
    expect(rms(a, SR / 2, a.length)).toBeLessThan(0.3);
    expect(out.positionSec).toBeGreaterThanOrEqual(2);
    expect(out.positionSec).toBeLessThanOrEqual(3.01);
  });

  it('the position is early by the device delay: reading it accounts for sound still on its way to the speakers', async () => {
    ctx.outputLatency = 0.1;
    const { w, out } = await started();
    out.play();
    w.pump(2);
    expect(out.positionSec).toBeGreaterThan(1.85);
    expect(out.positionSec).toBeLessThan(1.97);
    ctx.outputLatency = 0;
    expect(out.positionSec).toBeGreaterThan(1.97);
  });

  it('sends the song once, as a transfer of its own copy (the original stays whole for a fallback)', async () => {
    const w = inProcessWorklet(ctx);
    const out = makeOutput(async () => w.node);
    const source = tone();
    out.load(source);
    await flush();
    out.play();
    w.pump(1);
    const loads = w.sent.filter((m) => m.type === 'load') as Extract<ToWorklet, { type: 'load' }>[];
    expect(loads).toHaveLength(1);
    expect(w.transfers).toHaveLength(1);
    expect(w.transfers[0].includes(loads[0].left.buffer)).toBe(true);
    expect(loads[0].left === source.channels[0]).toBe(false); // a copy...
    expect(loads[0].right).toBeNull(); // ...of one channel only (a mono song)
    expect(source.channels[0].length).toBe(20 * SR); // ...so the page still has the whole song
  });

  it('puts the volume in the worklet and leaves the gain node at 1', async () => {
    const { w, out } = await started();
    out.setVolume(0.3);
    expect(w.sent.filter((m) => m.type === 'volume').pop()).toEqual({ type: 'volume', value: 0.3 });
    expect(ctx.gainNode.gain.value).toBe(1);
  });

  it('loads a new song over the old one', async () => {
    const { w, out } = await started();
    out.play();
    w.pump(0.5);
    out.pause();
    out.load({ sampleRate: SR, channels: [sine(880, 4, SR)] });
    expect(out.durationSec).toBeCloseTo(4, 3);
    expect(out.positionSec).toBe(0);
    out.play();
    w.pump(0.3);
    const a = w.pump(0.5);
    expect(zeroCrossingFreq(a, SR, 0, a.length)).toBeGreaterThan(880 * 0.99);
  });

  it('shuts down cleanly', async () => {
    const { w, out } = await started();
    out.dispose();
    expect(w.node.disconnect).toHaveBeenCalled();
    expect(out.soundPath).toBe('none');
  });
});

describe('falling back to the script node', () => {
  it('when the module cannot load', async () => {
    const out = makeOutput(() => Promise.reject(new Error('addModule failed')));
    out.load(tone());
    out.play();
    await flush();
    expect(out.soundPath).toBe('script');
    const a = pumpScript(ctx, 3);
    expect(rms(a, BLOCK, a.length)).toBeGreaterThan(0.25); // it plays what was asked for
    expect(warn).toHaveBeenCalled();
  });

  it('when making the worklet node throws at once', async () => {
    const out = makeOutput(() => {
      throw new Error('boom');
    });
    out.load(tone());
    await flush();
    expect(out.soundPath).toBe('script');
  });

  it('when the script fails its dry run (the maker rejects)', async () => {
    const out = makeOutput(async () => {
      throw new Error('The audio worklet script does not run: x is not defined');
    });
    out.load(tone());
    await flush();
    expect(out.soundPath).toBe('script');
  });

  it('when the worklet never answers, once the audio device is running and the watchdog time has passed', async () => {
    const w = inProcessWorklet(ctx, { deaf: true });
    const out = makeOutput(async () => w.node, 1000);
    out.load(tone());
    out.play();
    await flush();
    expect(out.soundPath).toBe('worklet');
    await vi.advanceTimersByTimeAsync(900);
    expect(out.soundPath).toBe('worklet');
    await vi.advanceTimersByTimeAsync(200);
    expect(out.soundPath).toBe('script');
    expect(w.node.disconnect).toHaveBeenCalled();
    const a = pumpScript(ctx, 3);
    expect(rms(a, BLOCK, a.length)).toBeGreaterThan(0.25);
  });

  it('but not while the audio device is still asleep (waiting for the first click): the clock starts when it wakes', async () => {
    ctx.state = 'suspended';
    const w = inProcessWorklet(ctx, { deaf: true });
    const out = makeOutput(async () => w.node, 1000);
    out.load(tone());
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(out.soundPath).toBe('worklet');
    await out.wake();
    await vi.advanceTimersByTimeAsync(1100);
    expect(out.soundPath).toBe('script');
  });

  it('when the worklet says it broke, in the middle of a song: same place, same settings, still playing', async () => {
    const w = inProcessWorklet(ctx);
    const out = makeOutput(async () => w.node);
    out.load(tone());
    await flush();
    out.setTempo(0.75);
    out.seek(5);
    out.play();
    w.pump(2);
    const place = out.positionSec;
    expect(place).toBeGreaterThan(6);
    w.node.port.onmessage?.({ data: { type: 'error', message: 'engine blew up' } satisfies FromWorklet });
    expect(out.soundPath).toBe('script');
    expect(out.positionSec).toBeGreaterThanOrEqual(place - 0.01);
    expect(out.positionSec).toBeLessThan(place + 0.3);
    pumpScript(ctx, 1);
    const a = pumpScript(ctx, 3);
    expect(rms(a, 0, a.length)).toBeGreaterThan(0.25); // still playing
    const moved = out.positionSec - place;
    expect(moved).toBeGreaterThan(0.2); // 4 blocks of about 93 ms at 0.75 speed
    expect(ctx.gainNode.gain.value).toBe(0.8); // the volume is back on the gain node
  });

  it('when the browser reports a processor error', async () => {
    const w = inProcessWorklet(ctx);
    const out = makeOutput(async () => w.node);
    out.load(tone());
    await flush();
    w.node.onprocessorerror?.(new Event('processorerror'));
    expect(out.soundPath).toBe('script');
  });

  it('when the worklet goes quiet in the middle of playing', async () => {
    const w = inProcessWorklet(ctx);
    const out = makeOutput(async () => w.node, 1000);
    out.load(tone());
    await flush();
    out.play();
    w.pump(1);
    expect(out.soundPath).toBe('worklet');
    // no more pumping: the worklet stops reporting while the clock of the page goes on
    await vi.advanceTimersByTimeAsync(2000);
    expect(out.soundPath).toBe('script');
  });

  it('does not mistake a stuck page for a silent worklet', async () => {
    const w = inProcessWorklet(ctx);
    const out = makeOutput(async () => w.node, 1000);
    out.load(tone());
    await flush();
    out.play();
    w.pump(1);
    vi.setSystemTime(Date.now() + 10_000); // the page was frozen for 10 seconds: timers fire late, messages are still queued
    await vi.advanceTimersByTimeAsync(600);
    expect(out.soundPath).toBe('worklet');
  });

  it('only once: after the fallback the worklet is never tried again', async () => {
    const make = vi.fn(async () => {
      throw new Error('nope');
    });
    const out = makeOutput(make);
    out.load(tone());
    await flush();
    out.load(tone());
    await flush();
    expect(make).toHaveBeenCalledTimes(1);
    expect(out.soundPath).toBe('script');
  });

  it('a worklet that finishes loading after the output was shut down is let go, not used', async () => {
    let finish: (n: WorkletNodeLike) => void = () => {};
    const w = inProcessWorklet(ctx);
    const out = makeOutput(() => new Promise<WorkletNodeLike>((r) => (finish = r)));
    out.load(tone());
    out.dispose();
    finish(w.node);
    await flush();
    expect(w.node.disconnect).toHaveBeenCalled();
    expect(out.soundPath).toBe('none');
  });
});

describe('the script path reports the position that is heard, not the one just made', () => {
  it('uses the time each block will be heard, and the device delay', () => {
    ctx.audioWorklet = undefined;
    ctx.outputLatency = 0.02;
    const out = new WebAudioOutput(() => ctx as unknown as AudioContext);
    out.load(tone());
    out.play();
    const node = ctx.scripts[0];
    // One block is made ahead of time: block N is heard from playbackTime = now + one block.
    const block = (playbackTime: number) => {
      const l = new Float32Array(BLOCK);
      const r = new Float32Array(BLOCK);
      node.onaudioprocess?.({ playbackTime, outputBuffer: { numberOfChannels: 2, getChannelData: (i: number) => (i === 0 ? l : r) } });
    };
    ctx.currentTime = 0;
    for (let b = 0; b < 6; b++) {
      block(ctx.currentTime + BLOCK / SR);
      ctx.currentTime += BLOCK / SR;
    }
    // Blocks 0..5 are made; at this moment block 5 is being heard (it started at 5*BLOCK/SR and its start is song time ~4*BLOCK/SR+fade)
    const made = (6 * BLOCK) / SR;
    const heard = out.positionSec;
    expect(heard).toBeLessThan(made - 0.02); // well behind what was made
    expect(heard).toBeGreaterThan(made - 2 * (BLOCK / SR) - 0.03);
  });
});
