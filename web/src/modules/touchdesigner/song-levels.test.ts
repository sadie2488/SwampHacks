// The playing song's levels (bus "songLevels", published by playback) reach TouchDesigner as audio.bands.
import { afterEach, describe, expect, it } from 'vitest';
import { bus } from '@/bus';
import { createTracker } from './frame';
import { shapeProblems } from './frame.test-util';
import { startWith } from './index';

const BANDS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];

describe('song levels in TouchDesigner frames', () => {
  afterEach(() => bus.reset());

  it('the tracker puts the latest song bands in the frame, and zeros again when playback sends zeros', () => {
    const tracker = createTracker(() => 0);
    expect(tracker.frame().audio.bands).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    tracker.onSongLevels({ bands: BANDS });
    const frame = tracker.frame();
    expect(frame.audio.bands).toEqual(BANDS);
    expect(shapeProblems(frame)).toEqual([]);
    tracker.onSongLevels({ bands: [0, 0, 0, 0, 0, 0, 0, 0] });
    expect(tracker.frame().audio.bands).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('the module, wired to the bus, streams the songLevels bands', () => {
    let now = 0;
    const timers: Array<() => void> = [];
    const stop = startWith({
      url: 'ws://localhost:1',
      createSocket: () => ({ readyState: 0, send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }),
      now: () => now,
      setInterval: (fn) => timers.push(fn),
      clearInterval: () => void timers.splice(0),
      setTimeout: () => 0,
      clearTimeout: () => {},
    });
    bus.emit('songLevels', { bands: BANDS, level: 0.6, at: 0 });
    bus.emit('enable', { module: 'touchdesigner', on: true });
    now = 40;
    for (const fn of timers) fn();
    expect(bus.last('td')?.audio.bands).toEqual(BANDS);
    stop();
  });
});
