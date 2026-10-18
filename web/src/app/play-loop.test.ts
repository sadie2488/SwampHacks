// Play mode turns loop on when it opens and after every song load; leaving Play does not turn it off.
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { beforeEach, describe, expect, it } from 'vitest';
import { bus, resetControls, sendCommand } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { autoLoops, ensureSongLoaded, startPlayLoop } from './play-loop';

const loop = () => bus.last('controls')?.['playback.loop'];

describe('Play mode loops the song', () => {
  beforeEach(() => resetControls());

  it('only counts the Play mode itself, on screen', () => {
    expect(autoLoops('mode', 'play')).toBe(true);
    for (const tab of ['learn', 'create', 'lab']) expect(autoLoops('mode', tab)).toBe(false);
    expect(autoLoops('menu', 'play')).toBe(false);
    expect(autoLoops('entrance', 'play')).toBe(false);
  });

  it('turns loop on when Play opens, through a normal command', () => {
    expect(loop()).toBe(false);
    const seen: string[] = [];
    const off = bus.on('command', (c) => void seen.push(`${c.command}:${c.how}:${String(c.value)}`));
    const stop = startPlayLoop();
    expect(loop()).toBe(true);
    expect(seen).toContain('playback.loop:set:true');
    stop();
    off();
  });

  it('the Loop button can still turn it off, and a new song turns it back on', () => {
    const stop = startPlayLoop();
    sendCommand('playback.loop', 'button', { how: 'toggle' });
    expect(loop()).toBe(false);
    bus.emit('analysis', twinkle as unknown as SongAnalysis);
    expect(loop()).toBe(true);
    stop();
  });

  it('leaving Play leaves loop on, and later song loads do not touch it', () => {
    const stop = startPlayLoop();
    stop();
    expect(loop()).toBe(true);
    sendCommand('playback.loop', 'button', { how: 'set', value: false });
    bus.emit('analysis', twinkle as unknown as SongAnalysis);
    expect(loop()).toBe(false);
  });
});

describe('Play loads the demo song when none is loaded', () => {
  const song = { analysis: twinkle as unknown as SongAnalysis, offline: true };
  const transport = { playing: false, positionSec: 0, durationSec: 0, tempo: 1, pitch: 0, volume: 1, loop: false, loopSection: null };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('publishes the demo song when nothing is loaded', async () => {
    bus.emit('transport', { ...transport, loaded: false });
    const seen: string[] = [];
    const off = bus.on('analysis', (a) => void seen.push(a.song_id));
    ensureSongLoaded(async () => song);
    await tick();
    expect(seen).toEqual([song.analysis.song_id]);
    off();
  });

  it('leaves a loaded song alone', async () => {
    bus.emit('transport', { ...transport, loaded: true });
    const seen: string[] = [];
    const off = bus.on('analysis', (a) => void seen.push(a.song_id));
    ensureSongLoaded(async () => song);
    await tick();
    expect(seen).toEqual([]);
    off();
  });
});
