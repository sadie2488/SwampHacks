import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNT_STEP_MS, createLearnPause, type PauseView } from './learn-pause';

function setup() {
  const calls: string[] = [];
  const views: PauseView[] = [];
  const m = createLearnPause({ pause: () => calls.push('pause'), play: () => calls.push('play'), onChange: (v) => views.push({ ...v }) });
  m.transport({ playing: false, loaded: true });
  return { m, calls, views };
}

describe('Learn pause by sign', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('while playing: pauses now and shows the pause mark', () => {
    const { m, calls } = setup();
    m.transport({ playing: true, loaded: true });
    m.toggle();
    expect(calls).toEqual(['pause']);
    expect(m.view).toEqual({ mark: true, count: null });
    m.transport({ playing: false, loaded: true });
    expect(m.view).toEqual({ mark: true, count: null });
  });

  it('while paused: hides the mark, counts 3, 2, 1 one per second, then plays', () => {
    const { m, calls, views } = setup();
    m.transport({ playing: true, loaded: true });
    m.toggle();
    m.transport({ playing: false, loaded: true });
    m.toggle();
    expect(m.view).toEqual({ mark: false, count: 3 });
    vi.advanceTimersByTime(COUNT_STEP_MS);
    expect(m.view.count).toBe(2);
    vi.advanceTimersByTime(COUNT_STEP_MS);
    expect(m.view.count).toBe(1);
    expect(calls).toEqual(['pause']);
    vi.advanceTimersByTime(COUNT_STEP_MS);
    expect(calls).toEqual(['pause', 'play']);
    expect(m.view).toEqual({ mark: false, count: null });
    expect(views.map((v) => v.count)).toEqual([null, 3, 2, 1, null]);
  });

  it('a second sign during the countdown calls it off and stays paused', () => {
    const { m, calls } = setup();
    m.toggle();
    vi.advanceTimersByTime(COUNT_STEP_MS);
    m.toggle();
    vi.advanceTimersByTime(5 * COUNT_STEP_MS);
    expect(calls).toEqual([]);
    expect(m.view).toEqual({ mark: true, count: null });
  });

  it('the Pause and Play buttons show and hide the mark the same way (through the transport)', () => {
    const { m } = setup();
    m.transport({ playing: true, loaded: true });
    expect(m.view.mark).toBe(false);
    m.transport({ playing: false, loaded: true });
    expect(m.view.mark).toBe(true);
    m.transport({ playing: true, loaded: true });
    expect(m.view.mark).toBe(false);
  });

  it('pressing Play during the countdown ends it without a second play', () => {
    const { m, calls } = setup();
    m.toggle();
    m.transport({ playing: true, loaded: true });
    vi.advanceTimersByTime(5 * COUNT_STEP_MS);
    expect(calls).toEqual([]);
    expect(m.view).toEqual({ mark: false, count: null });
  });

  it('does nothing without a song, and a freshly loaded paused song shows no mark', () => {
    const { m, calls } = setup();
    m.transport({ playing: false, loaded: false });
    m.toggle();
    expect(calls).toEqual([]);
    expect(m.view).toEqual({ mark: false, count: null });
  });
});
