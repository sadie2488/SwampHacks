import { beforeEach, describe, expect, it } from 'vitest';
import { bus, createBus, getStatus, isModuleOn, reportStatus, resetControls, sendCommand, type ControlState } from './index';
import { nextControlValue } from './controls';
import type { CommandEvent } from '@/contracts';

const cmd = (command: string, extra: Partial<CommandEvent> = {}): CommandEvent => ({ version: 1, command, source: 'button', t_ms: 0, ...extra });

describe('bus', () => {
  it('delivers values to listeners and stops after unsubscribe', () => {
    const b = createBus<{ n: number }>();
    const seen: number[] = [];
    const stop = b.on('n', (v) => seen.push(v));
    b.emit('n', 1);
    stop();
    b.emit('n', 2);
    expect(seen).toEqual([1]);
    expect(b.last('n')).toBe(2);
  });

  it('replays the latest value to a late listener only when asked', () => {
    const b = createBus<{ n: number }>();
    b.emit('n', 7);
    const plain: number[] = [];
    const replayed: number[] = [];
    b.on('n', (v) => plain.push(v));
    b.on('n', (v) => replayed.push(v), { replay: true });
    expect(plain).toEqual([]);
    expect(replayed).toEqual([7]);
  });

  it('keeps going when one listener throws', () => {
    const b = createBus<{ n: number }>();
    const seen: number[] = [];
    b.on('n', () => {
      throw new Error('boom');
    });
    b.on('n', (v) => seen.push(v));
    b.emit('n', 3);
    expect(seen).toEqual([3]);
  });
});

describe('per-module status', () => {
  it('remembers the latest status of each module separately', () => {
    reportStatus('vision', 'running', 'Camera tracking is on');
    reportStatus('audio-live', 'starting');
    expect(getStatus('vision')?.message).toBe('Camera tracking is on');
    expect(isModuleOn('vision')).toBe(true);
    expect(isModuleOn('audio-live')).toBe(true);
    reportStatus('vision', 'idle');
    reportStatus('audio-live', 'error', 'blocked');
    expect(isModuleOn('vision')).toBe(false);
    expect(isModuleOn('audio-live')).toBe(false);
    expect(isModuleOn('never-heard-of-it')).toBe(false);
  });
});

describe('controls (shared command rules)', () => {
  beforeEach(() => resetControls());
  const controls = () => bus.last('controls') as ControlState;

  it('starts from the catalog defaults', () => {
    expect(controls()['playback.tempo']).toBe(1);
    expect(controls()['playback.pitch']).toBe(0);
    expect(controls()['playback.loop']).toBe(false);
  });

  it('set and follow clamp to the catalog range', () => {
    sendCommand('playback.tempo', 'button', { how: 'set', value: 3 });
    expect(controls()['playback.tempo']).toBe(1.5);
    sendCommand('playback.tempo', 'gesture', { how: 'follow', value: 0.1 });
    expect(controls()['playback.tempo']).toBe(0.5);
    sendCommand('playback.pitch', 'button', { how: 'set', value: -20 });
    expect(controls()['playback.pitch']).toBe(-12);
  });

  it('nudge adds the step and clamps; with no value it uses the catalog step', () => {
    sendCommand('playback.tempo', 'voice', { how: 'nudge', value: -0.1 });
    expect(controls()['playback.tempo']).toBeCloseTo(0.9);
    sendCommand('playback.tempo', 'voice', { how: 'nudge' });
    expect(controls()['playback.tempo']).toBeCloseTo(1.0);
    for (let i = 0; i < 20; i++) sendCommand('playback.tempo', 'voice', { how: 'nudge', value: 0.1 });
    expect(controls()['playback.tempo']).toBe(1.5);
  });

  it('toggle flips, or sets when given a boolean', () => {
    sendCommand('playback.loop', 'gesture', { how: 'toggle' });
    expect(controls()['playback.loop']).toBe(true);
    sendCommand('playback.loop', 'gesture', { how: 'toggle' });
    expect(controls()['playback.loop']).toBe(false);
    sendCommand('playback.loop', 'button', { how: 'set', value: true });
    expect(controls()['playback.loop']).toBe(true);
  });

  it('string controls only accept their options; range controls sort their ends', () => {
    sendCommand('create.instrument', 'button', { how: 'set', value: 'bass' });
    expect(controls()['create.instrument']).toBe('bass');
    sendCommand('create.instrument', 'button', { how: 'set', value: 'kazoo' });
    expect(controls()['create.instrument']).toBe('bass');
    sendCommand('playback.loop_section', 'button', { how: 'set', value: [8, 2] });
    expect(controls()['playback.loop_section']).toEqual([2, 8]);
  });

  it('triggers and unknown controls change nothing', () => {
    const before = controls();
    sendCommand('playback.pause', 'voice', { how: 'trigger' });
    sendCommand('playback.nonsense', 'button', { how: 'set', value: 1 });
    expect(controls()).toBe(before);
    expect(nextControlValue(undefined, cmd('playback.play'))).toBeUndefined();
  });

  it('emits "controls" only when something really changed', () => {
    let count = 0;
    const stop = bus.on('controls', () => count++);
    sendCommand('playback.tempo', 'button', { how: 'set', value: 1 }); // already 1
    expect(count).toBe(0);
    sendCommand('playback.tempo', 'button', { how: 'set', value: 1.2 });
    expect(count).toBe(1);
    stop();
  });
});
