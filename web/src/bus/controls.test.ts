import { describe, expect, it } from 'vitest';
import type { CommandEvent, ControlValue } from '@/contracts';
import { nextControlValue, snapToStep, trimFloat } from './controls';

const cmd = (command: string, how: CommandEvent['how'], value?: CommandEvent['value']) => ({ command, source: 'button', how, value }) as CommandEvent;

/** Applies a list of commands to one control, starting from its default. */
function run(control: string, cmds: CommandEvent[]): ControlValue | undefined {
  let v: ControlValue | undefined;
  for (const c of cmds) v = nextControlValue(v, c) ?? v;
  return v;
}

describe('snapToStep and trimFloat', () => {
  it('rounds to the step and drops float noise', () => {
    expect(snapToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(snapToStep(0.9999999999999997, 0.1)).toBe(1);
    expect(snapToStep(0.84, 0.1)).toBe(0.8);
    expect(snapToStep(3, 1)).toBe(3);
    expect(snapToStep(-0.4, 1)).toBe(0); // no negative zero
    expect(Object.is(snapToStep(-0.4, 1), -0)).toBe(false);
    expect(trimFloat(0.30000000000000004)).toBe(0.3);
  });
  it('leaves the value alone (apart from noise) when there is no step', () => {
    expect(snapToStep(0.123, 0)).toBe(0.123);
  });
});

describe('nudging tempo and pitch', () => {
  it('comes back to exactly 1 after 5 taps faster and 5 taps slower', () => {
    const up = Array.from({ length: 5 }, () => cmd('playback.tempo', 'nudge', 0.1));
    const down = Array.from({ length: 5 }, () => cmd('playback.tempo', 'nudge', -0.1));
    expect(run('playback.tempo', up)).toBe(1.5);
    expect(run('playback.tempo', [...up, ...down])).toBe(1);
  });
  it('uses the catalog step when the nudge has no value, and stays exact over many taps', () => {
    const taps = [...Array.from({ length: 3 }, () => cmd('playback.tempo', 'nudge')), ...Array.from({ length: 3 }, () => cmd('playback.tempo', 'nudge', -0.1))];
    expect(run('playback.tempo', taps)).toBe(1);
    const many = Array.from({ length: 50 }, (_, i) => cmd('playback.tempo', 'nudge', i % 2 ? -0.1 : 0.1));
    expect(run('playback.tempo', many)).toBe(1);
  });
  it('keeps pitch nudges on whole semitones', () => {
    const pitch = [cmd('playback.pitch', 'nudge', 1), cmd('playback.pitch', 'nudge', 1), cmd('playback.pitch', 'nudge', -1)];
    expect(run('playback.pitch', pitch)).toBe(1);
    expect(run('playback.pitch', [cmd('playback.pitch', 'nudge', -1), cmd('playback.pitch', 'nudge', 1)])).toBe(0);
  });
  it('lands an off-grid value back on the grid', () => {
    expect(nextControlValue(0.83, cmd('playback.tempo', 'nudge', 0.1))).toBe(0.9);
  });
  it('still clamps to the range', () => {
    expect(run('playback.tempo', Array.from({ length: 20 }, () => cmd('playback.tempo', 'nudge', 0.1)))).toBe(1.5);
    expect(run('playback.tempo', Array.from({ length: 20 }, () => cmd('playback.tempo', 'nudge', -0.1)))).toBe(0.5);
    expect(run('playback.pitch', Array.from({ length: 30 }, () => cmd('playback.pitch', 'nudge', 1)))).toBe(12);
    expect(nextControlValue(1, cmd('playback.tempo', 'set', 9))).toBe(1.5);
  });
});

describe('setting a value', () => {
  it('keeps values finer than the step (sliders and hand movement) but drops float noise', () => {
    expect(nextControlValue(0.8, cmd('playback.volume', 'set', 0.85))).toBe(0.85);
    expect(nextControlValue(1, cmd('playback.tempo', 'follow', 0.83))).toBe(0.83);
    expect(nextControlValue(1, cmd('playback.tempo', 'set', 0.1 * 3 + 0.7))).toBe(1);
  });
});
