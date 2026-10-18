// The speech listener with a stand-in recogniser: what it does when Chrome's speech service loses the network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeechListener, NETWORK_RETRY_MS } from './speech';

class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  abort = vi.fn();
  constructor() {
    FakeRecognizer.instances.push(this);
  }
  /** Chrome sends the error, then ends the session. */
  fail(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
  say(text: string, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: Object.assign([], { 0: Object.assign([{ transcript: text }], { isFinal }) }, { length: 1 }) });
  }
}

const setup = () => {
  const h = { onText: vi.fn(), onNewSession: vi.fn(), onProblem: vi.fn(), onRecovered: vi.fn() };
  const listener = createSpeechListener(h)!;
  listener.start();
  return { h, listener, rec: FakeRecognizer.instances[0] };
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognizer.instances = [];
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognizer);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('network trouble', () => {
  it('says so, then keeps trying again after 2 s, 5 s, 10 s and then every 15 s', async () => {
    const { h, rec } = setup();
    expect(rec.start).toHaveBeenCalledTimes(1);
    const errors = vi.spyOn(console, 'error');
    let starts = 1;
    for (const wait of [...NETWORK_RETRY_MS, 15000, 15000]) {
      rec.fail('network');
      expect(h.onProblem).toHaveBeenLastCalledWith(expect.stringMatching(/need an internet connection/));
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(rec.start).toHaveBeenCalledTimes(starts); // not early: no tight loop
      await vi.advanceTimersByTimeAsync(1);
      expect(rec.start).toHaveBeenCalledTimes(++starts);
    }
    expect(NETWORK_RETRY_MS).toEqual([2000, 5000, 10000, 15000]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('does not start early when asked to listen while a retry is waiting', async () => {
    const { rec, listener } = setup();
    rec.fail('network');
    listener.start(); // e.g. the mode or a control changed
    listener.start();
    expect(rec.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(rec.start).toHaveBeenCalledTimes(2);
  });

  it('stops retrying once listening is no longer wanted', async () => {
    const { rec, listener } = setup();
    rec.fail('network');
    listener.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts the waits from 2 s again once speech comes through, and says it is back', async () => {
    const { h, rec } = setup();
    rec.fail('network');
    await vi.advanceTimersByTimeAsync(2000);
    rec.fail('network');
    await vi.advanceTimersByTimeAsync(5000);
    expect(rec.start).toHaveBeenCalledTimes(3);
    rec.say('start');
    expect(h.onRecovered).toHaveBeenCalledTimes(1);
    expect(h.onText).toHaveBeenLastCalledWith(['start'], 0, [true]);
    rec.fail('network');
    await vi.advanceTimersByTimeAsync(2000);
    expect(rec.start).toHaveBeenCalledTimes(4);
  });

  it('still gives up on a blocked microphone (that needs the user)', async () => {
    const { h, rec } = setup();
    rec.fail('not-allowed');
    await vi.advanceTimersByTimeAsync(60000);
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(h.onProblem).toHaveBeenCalledWith(expect.stringMatching(/blocked/));
  });

  it('passes on which results are final', () => {
    const { h, rec } = setup();
    rec.say('next', false);
    expect(h.onText).toHaveBeenLastCalledWith(['next'], 0, [false]);
    expect(h.onRecovered).not.toHaveBeenCalled();
  });
});
