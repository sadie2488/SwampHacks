// Bus wiring for hold_ms rules: holdProgress fills while a sign is held, the command fires once, and letting go,
// the camera turning off, or the hands leaving clears it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, reportStatus, resetControls, sendSignal, type Stop } from '@/bus';
import type { CommandEvent } from '@/contracts';
import { getMappingsText, setMappingsText } from '../mappings';
import { start, type HoldProgress } from './index';

const original = getMappingsText();
const RULES = '- name: hold Y for Play\n  when: vision.sign.y\n  do: app.mode\n  how: trigger\n  value: play\n  hold_ms: 2000\n';
let stop: Stop;
let commands: CommandEvent[];
let progress: HoldProgress[];
let unsubscribe: Stop[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] });
  commands = [];
  progress = [];
  resetControls();
  bus.emit('mode', 'learn');
  unsubscribe = [bus.on('command', (c) => commands.push(c)), bus.on('holdProgress', (p) => progress.push(p))];
  stop = start();
  setMappingsText(RULES);
});
afterEach(() => {
  stop();
  unsubscribe.forEach((u) => u());
  setMappingsText(original);
  vi.useRealTimers();
});

const sign = (state: 'start' | 'end') => sendSignal({ id: 'vision.sign.y', kind: 'moment', state });
const last = () => progress[progress.length - 1];

describe('hold-to-confirm on the bus', () => {
  it('fills up, fires app.mode once after 2 seconds, then clears the ring', () => {
    sign('start');
    vi.advanceTimersByTime(1000);
    expect(last().progress).toBeCloseTo(0.5, 1);
    expect(last()).toMatchObject({ rule: 'hold Y for Play', control: 'app.mode', value: 'play' });
    expect(commands).toEqual([]);
    vi.advanceTimersByTime(1100);
    expect(commands.filter((c) => c.command === 'app.mode').map((c) => c.value)).toEqual(['play']);
    expect(last().progress).toBe(0);
    expect(bus.last('controls')?.['app.mode']).toBe('play');
    vi.advanceTimersByTime(3000);
    expect(commands).toHaveLength(1);
  });

  it('letting go early does nothing and clears the ring', () => {
    sign('start');
    vi.advanceTimersByTime(1500);
    sign('end');
    expect(last().progress).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(commands).toEqual([]);
  });

  it('the camera turning off cancels a hold', () => {
    sign('start');
    vi.advanceTimersByTime(500);
    reportStatus('vision', 'idle');
    expect(last().progress).toBe(0);
    vi.advanceTimersByTime(3000);
    expect(commands).toEqual([]);
  });

  it('no hands in the picture cancels a hold', () => {
    sign('start');
    bus.emit('landmarks', { t_ms: 0, width: 640, height: 480, hands: [] });
    vi.advanceTimersByTime(3000);
    expect(commands).toEqual([]);
    expect(last().progress).toBe(0);
  });
});
