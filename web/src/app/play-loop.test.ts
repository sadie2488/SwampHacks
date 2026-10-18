// Play mode turns loop on when it opens and after every song load; leaving Play does not turn it off.
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { beforeEach, describe, expect, it } from 'vitest';
import { bus, resetControls, sendCommand } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { autoLoops, startPlayLoop } from './play-loop';

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
