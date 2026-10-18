import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, reportStatus } from '@/bus';
import { MIC_WAIT_MS, startMicThen } from './practice-logic';

describe('Start practice turns the microphone on first', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reportStatus('audio-live', 'idle', 'Microphone is off');
  });
  afterEach(() => vi.useRealTimers());

  it('asks for the microphone (like the Turn on microphone button) and starts once it runs', () => {
    const enables: unknown[] = [];
    const off = bus.on('enable', (e) => enables.push(e));
    const action = vi.fn();
    const failed = vi.fn();
    startMicThen(action, failed);
    expect(enables).toEqual([{ module: 'audio-live', on: true }]);
    expect(action).not.toHaveBeenCalled();
    reportStatus('audio-live', 'starting', 'Asking for the microphone');
    expect(action).not.toHaveBeenCalled();
    reportStatus('audio-live', 'running', 'Listening');
    expect(action).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    off();
  });

  it('starts at once when the microphone is already on', () => {
    reportStatus('audio-live', 'running', 'Listening');
    const action = vi.fn();
    startMicThen(action, vi.fn());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('gives up when the microphone fails or never comes on', () => {
    const failed = vi.fn();
    startMicThen(vi.fn(), failed);
    reportStatus('audio-live', 'error', 'No microphone');
    expect(failed).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    startMicThen(vi.fn(), late);
    vi.advanceTimersByTime(MIC_WAIT_MS + 1);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
