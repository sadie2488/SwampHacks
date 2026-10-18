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
const doubleClap = () => sendSignal({ id: 'audio.clap.double', kind: 'moment', state: 'start', confidence: 0.9 });

describe('commands module on the bus', () => {
  it('publishes the issues (none for the real mappings.yaml) as soon as it starts', () => {
    expect(issueUpdates[0]).toEqual([]);
  });

  it('a single clap does nothing in play mode (play/pause needs a double clap)', () => {
    clap();
    clap();
    expect(commands).toEqual([]);
  });

  it('a double clap becomes a command plus a "fired" event, and a second one inside the cooldown does not', () => {
    doubleClap();
    doubleClap();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ command: 'playback.toggle', how: 'trigger', source: 'gesture', mode: 'play', mapping: 'clap toggles play/pause', signal: 'audio.clap.double', version: 1 });
    expect(typeof commands[0].t_ms).toBe('number');
    expect(fired).toHaveLength(1);
    expect(fired[0].mapping).toBe('clap toggles play/pause');
    expect(fired[0].command).toBe(commands[0]);
  });

  it('follows the mode topic', () => {
    bus.emit('mode', 'create');
    doubleClap();
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
    doubleClap();
    expect(commands).toHaveLength(1);
  });

  it('stopping lets go of everything', () => {
    stop();
    doubleClap();
    expect(commands).toEqual([]);
  });

  it('the right hand moves the tempo smoothly from where it is, but not while a practice run listens', () => {
    const hand = (value: number) => sendSignal({ id: 'vision.hand.right.height', kind: 'slider', value, confidence: 0.9 });
    const tempo = () => bus.last('controls')?.['playback.tempo'];
    try {
      bus.emit('practice', { state: 'listening' });
      for (let i = 0; i < 10; i++) hand(1);
      expect(commands).toEqual([]);
      expect(tempo()).toBe(1);
      bus.emit('practice', { state: 'done' });
      hand(1);
      const first = commands[0]?.value as number;
      expect(first).toBeGreaterThan(1.02); // it moves...
      expect(first).toBeLessThan(1.5); // ...but does not jump straight to the top
      expect(tempo()).toBe(first);
    } finally {
      bus.emit('practice', { state: 'idle' });
    }
  });
});
