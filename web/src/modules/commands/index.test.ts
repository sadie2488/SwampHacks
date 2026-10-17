// Tests for the bus wiring: signals in, commands / fired / issues out, live reload of mappings.yaml.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bus, resetControls, sendSignal, type EngineIssue, type Stop } from '@/bus';
import type { CommandEvent } from '@/contracts';
import { getMappingsText, setMappingsText } from '../mappings';
import { start } from './index';

const original = getMappingsText();
let stop: Stop;
let commands: CommandEvent[];
let fired: Array<{ mapping: string; command: CommandEvent }>;
let issueUpdates: EngineIssue[][];
let unsubscribe: Stop[];

beforeEach(() => {
  commands = [];
  fired = [];
  issueUpdates = [];
  resetControls();
  bus.emit('mode', 'play');
  unsubscribe = [
    bus.on('command', (c) => commands.push(c)),
    bus.on('fired', (f) => fired.push(f)),
    bus.on('issues', (i) => issueUpdates.push(i)),
  ];
  stop = start();
});
afterEach(() => {
  stop();
  unsubscribe.forEach((u) => u());
  setMappingsText(original);
});

const clap = () => sendSignal({ id: 'audio.clap', kind: 'moment', state: 'start', confidence: 0.9 });

describe('commands module on the bus', () => {
  it('publishes the issues (none for the real mappings.yaml) as soon as it starts', () => {
    expect(issueUpdates[0]).toEqual([]);
  });

  it('a clap becomes a command plus a "fired" event, and a second clap inside the cooldown does not', () => {
    clap();
    clap();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ command: 'playback.toggle', how: 'trigger', source: 'gesture', mode: 'play', mapping: 'clap toggles play/pause', signal: 'audio.clap', version: 1 });
    expect(typeof commands[0].t_ms).toBe('number');
    expect(fired).toHaveLength(1);
    expect(fired[0].mapping).toBe('clap toggles play/pause');
    expect(fired[0].command).toBe(commands[0]);
  });

  it('follows the mode topic', () => {
    bus.emit('mode', 'create');
    clap();
    expect(commands).toEqual([]);
  });

  it('a spoken word armed by the left fist changes the tempo control through the bus', () => {
    sendSignal({ id: 'audio.keyword.slower', kind: 'moment', state: 'start' });
    expect(commands).toEqual([]); // fist not closed yet
    sendSignal({ id: 'vision.hand.left.fist', kind: 'moment', state: 'start' });
    sendSignal({ id: 'audio.keyword.slower', kind: 'moment', state: 'start' });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ command: 'playback.tempo', how: 'nudge', value: -0.1, source: 'voice' });
    expect(bus.last('controls')?.['playback.tempo']).toBeCloseTo(0.9);
  });

  it('saving mappings.yaml applies at once, and a mistake is reported without stopping the good rules', () => {
    setMappingsText('- name: oops\n  when: audio.clapp\n  do: playback.toggle\n  how: trigger\n- name: snap\n  when: audio.snap\n  do: playback.toggle\n  how: trigger\n');
    const latest = issueUpdates[issueUpdates.length - 1];
    expect(latest).toHaveLength(1);
    expect(latest[0].message).toContain('Did you mean "audio.clap"?');
    clap();
    expect(commands).toEqual([]);
    sendSignal({ id: 'audio.snap', kind: 'moment', state: 'start' });
    expect(commands).toHaveLength(1);
  });

  it('only republishes issues when they change', () => {
    const before = issueUpdates.length;
    setMappingsText(original + '\n# just a comment\n');
    expect(issueUpdates.length).toBe(before);
  });

  it('broken YAML keeps the last good rules', () => {
    setMappingsText('- name: x\n  when: [audio.clap\n');
    expect(issueUpdates[issueUpdates.length - 1]).toHaveLength(1);
    clap();
    expect(commands).toHaveLength(1);
  });

  it('stopping lets go of everything', () => {
    stop();
    clap();
    expect(commands).toEqual([]);
  });
});
