import { describe, expect, it } from 'vitest';
import type { CommandEvent } from '@/contracts';
import { createFollowGate, FOLLOW_EVERY_MS, wordFor } from './commandWord';

const cmd = (command: string, extra: Partial<CommandEvent> = {}): CommandEvent => ({ version: 1, command, source: 'voice', t_ms: 0, ...extra });

describe('command toast words', () => {
  it('maps controls to short words', () => {
    expect(wordFor(cmd('playback.pause'))).toBe('Pause');
    expect(wordFor(cmd('playback.play'))).toBe('Play');
    expect(wordFor(cmd('playback.toggle'), { playing: true })).toBe('Play');
    expect(wordFor(cmd('playback.toggle'), { playing: false })).toBe('Pause');
    expect(wordFor(cmd('playback.tempo', { how: 'nudge', value: 0.1 }))).toBe('Faster');
    expect(wordFor(cmd('playback.tempo', { how: 'nudge', value: -0.1 }))).toBe('Slower');
    expect(wordFor(cmd('playback.pitch', { how: 'nudge', value: 1 }))).toBe('Higher');
    expect(wordFor(cmd('playback.pitch', { how: 'nudge', value: -1 }))).toBe('Lower');
    expect(wordFor(cmd('create.loop.record'), { after: true })).toBe('Recording');
    expect(wordFor(cmd('create.loop.record'), { after: false })).toBe('Take done');
    expect(wordFor(cmd('create.layer.next'))).toBe('Next layer');
    expect(wordFor(cmd('create.instrument', { value: 'piano' }))).toBe('Piano');
    expect(wordFor(cmd('create.effects', { value: 'reverb' }))).toBe('Reverb');
    expect(wordFor(cmd('create.beat'), { after: true })).toBe('Beat on');
    expect(wordFor(cmd('create.loop.stop'))).toBe('Stopped');
    expect(wordFor(cmd('app.mode', { value: 'learn' }))).toBe('Learn');
    expect(wordFor(cmd('app.mode', { value: 'lab' }))).toBe('Lab');
  });

  it('falls back to the rule name', () => {
    expect(wordFor(cmd('visual.intensity', { mapping: 'sparkle on wave' }))).toBe('Sparkle on wave');
    expect(wordFor(cmd('visual.intensity'))).toBeNull();
  });

  it('throttles follow rules to one "Tempo" per 2 s, and only when the tempo moved', () => {
    const gate = createFollowGate();
    const tempo = (value: number) => cmd('playback.tempo', { how: 'follow', value });
    expect(gate(tempo(1), 0)).toBe('Tempo');
    expect(gate(tempo(1.3), 500)).toBeNull();
    expect(gate(tempo(1.01), FOLLOW_EVERY_MS + 1)).toBeNull();
    expect(gate(tempo(1.3), FOLLOW_EVERY_MS + 2)).toBe('Tempo');
    expect(gate(cmd('playback.pitch', { how: 'follow', value: 3 }), 99999)).toBeNull();
    expect(gate(cmd('playback.volume', { how: 'follow', value: 0.2 }), 99999)).toBeNull();
  });
});
