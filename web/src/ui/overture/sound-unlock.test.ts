// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '@/bus';
import { soundAsleep, watchSoundUnlock, type SoundState } from './sound-unlock';

describe('the "click anywhere to turn sound on" pill', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (initial: SoundState) => {
    let state = initial;
    const resume = vi.fn(async () => {
      state = 'running';
    });
    const seen: boolean[] = [];
    const stop = watchSoundUnlock((a) => seen.push(a), { read: () => state, resume });
    return { seen, resume, stop, set: (s: SoundState) => (state = s) };
  };

  it('only counts a suspended context as asleep', () => {
    expect(soundAsleep('suspended')).toBe(true);
    expect(soundAsleep('running')).toBe(false);
    expect(soundAsleep('closed')).toBe(false);
    expect(soundAsleep('none')).toBe(false);
  });

  it('shows on load while asleep, and hides after the first click anywhere wakes the sound', async () => {
    const { seen, resume, stop } = setup('suspended');
    expect(seen).toEqual([true]);
    window.dispatchEvent(new Event('pointerdown'));
    expect(resume).toHaveBeenCalledTimes(1);
    await vi.runOnlyPendingTimersAsync();
    expect(seen).toEqual([true, false]);
    stop();
  });

  it('a key press also wakes it', async () => {
    const { seen, resume, stop } = setup('suspended');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(resume).toHaveBeenCalledTimes(1);
    await vi.runOnlyPendingTimersAsync();
    expect(seen.at(-1)).toBe(false);
    stop();
  });

  it('never shows while sound is already running, and clicks then do nothing', () => {
    const { seen, resume, stop } = setup('running');
    expect(seen).toEqual([false]);
    window.dispatchEvent(new Event('pointerdown'));
    expect(resume).not.toHaveBeenCalled();
    stop();
  });

  it('notices when sound falls asleep later (checked every second and on mode changes)', () => {
    const { seen, set, stop } = setup('running');
    set('suspended');
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([false, true]);
    set('running');
    bus.emit('mode', 'play');
    expect(seen).toEqual([false, true, false]);
    stop();
  });

  it('stops listening when stopped', () => {
    const { seen, resume, set, stop } = setup('running');
    stop();
    set('suspended');
    vi.advanceTimersByTime(3000);
    window.dispatchEvent(new Event('pointerdown'));
    expect(seen).toEqual([false]);
    expect(resume).not.toHaveBeenCalled();
  });
});
