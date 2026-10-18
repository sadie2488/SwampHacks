// Every rule in the REAL mappings.yaml, end to end: a fake signal goes in the way vision / audio-live would send it,
// the REAL commands module (engine + bus wiring) turns it into a command, and the REAL handlers (the playback
// controller, the create controller) change something we can see. One test per rule, named after the rule.
//
// What runs for real: mappings.yaml, the commands module, the bus and its controls, PlaybackController, the Create
// controller and its layers. What is pretend: the speakers (a fake output), the loop sound engine (a fake that writes
// down calls), and the shell's app.mode listener (App.tsx is a whole React screen, so its few lines of logic are copied
// below as `startShellStandIn`, and a static check makes sure App.tsx still has them).
//
// A failing test here means a rule does not do what its name says. Do not weaken a test to make it pass.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import twinkleJson from '@fixtures/song-analysis/twinkle.json';
import { bus, resetControls, sendCommand, sendSignal, type Stop, type TransportState } from '@/bus';
import { controlCatalog, signalCatalog } from '@/contracts/catalogs';
import type { CommandEvent, Mode, SongAnalysis } from '@/contracts';
import { getMappingsText } from '../mappings';
import { startController } from '../create/controller';
import type { LoopEngine, LoopHooks } from '../create/engine';
import { fakeHumFrames } from '../create/fake-hum';
import { currentLayer, initialState, type Layer } from '../create/layers';
import { createStore, type CreateStore } from '../create/store';
import { PlaybackController, type AudioOutput } from '../playback/controller';
import type { LoopRegion, PcmSource } from '../playback/stretch-engine';
import { loadMappings } from './engine';
import { start as startCommands } from './index';

const SRC = fileURLToPath(new URL('../..', import.meta.url)); // web/src
const twinkle = twinkleJson as unknown as SongAnalysis;

// ---------------------------------------------------------------------------------------------------------------
// The rules, read straight from the file (not through the engine), so a rule the engine skips is still tested
// ---------------------------------------------------------------------------------------------------------------
interface RawRule {
  name?: string;
  mode?: string;
  when?: string;
  only_while?: string;
  do?: string;
  how?: string;
  value?: unknown;
  step?: number;
  range?: [number, number];
  hold_ms?: number;
  cooldown_ms?: number;
  enabled?: boolean;
}
const YAML_TEXT = getMappingsText();
const RAW_RULES = parse(YAML_TEXT) as RawRule[];
const ruleNamed = (name: string): RawRule => {
  const r = RAW_RULES.find((x) => x.name === name);
  if (!r) throw new Error(`mappings.yaml has no rule named "${name}" any more: update this test's list of rules`);
  return r;
};

// ---------------------------------------------------------------------------------------------------------------
// Pretend hardware
// ---------------------------------------------------------------------------------------------------------------
/** Speakers that make no sound but remember what they were told. */
class FakeOutput implements AudioOutput {
  sampleRate = 8000;
  durationSec = 0;
  positionSec = 0;
  onEnded: (() => void) | null = null;
  tempo = 1;
  pitch = 0;
  volume = 0.8;
  loop: LoopRegion = null;
  playing = false;
  load(source: PcmSource) {
    this.durationSec = source.channels[0].length / source.sampleRate;
  }
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seek(sec: number) {
    this.positionSec = sec;
  }
  setTempo(t: number) {
    this.tempo = t;
  }
  setPitch(p: number) {
    this.pitch = p;
  }
  setVolume(v: number) {
    this.volume = v;
  }
  setLoop(region: LoopRegion) {
    this.loop = region;
  }
  wake() {
    return Promise.resolve();
  }
  dispose() {}
}

/** The Create loop engine, minus the sound. */
class FakeLoopEngine implements LoopEngine {
  calls: string[] = [];
  layers: readonly Layer[] = [];
  hooks?: LoopHooks;
  syncLayers(layers: readonly Layer[]) {
    this.layers = layers;
  }
  setMasterVolume() {}
  startLoop(opts: { countIn: boolean }, hooks?: LoopHooks) {
    this.calls.push(opts.countIn ? 'start:countIn' : 'start');
    this.hooks = hooks;
  }
  stopLoop() {
    this.calls.push('stop');
    this.hooks = undefined;
  }
  dispose() {}
}

// The shell's app.mode listener, copied from web/src/app/App.tsx (TABS, modeOf, and the bus.on('command') effect).
// The static test "App.tsx still reacts to app.mode" below checks the real file still has this logic.
const TABS = ['learn', 'play', 'create', 'lab'] as const;
type Tab = (typeof TABS)[number];
const modeOf = (tab: Tab): Mode => (tab === 'lab' ? 'play' : tab);
let shownTab: Tab = 'learn';
function startShellStandIn(): Stop {
  return bus.on('command', (c) => {
    const id = TABS.find((t) => c.command === 'app.mode' && t === c.value);
    if (!id) return;
    shownTab = id;
    bus.emit('mode', modeOf(id));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Wiring: the real modules on the real bus
// ---------------------------------------------------------------------------------------------------------------
let stops: Stop[] = [];
let commands: CommandEvent[] = [];
let playback: PlaybackController;
let output: FakeOutput;
let store: CreateStore;
let loop: FakeLoopEngine;
let createClock = 0;

const transport = (): TransportState => bus.last('transport')!;
const controls = () => bus.last('controls') ?? {};
const createState = () => store.getState();
const layer = () => currentLayer(createState());
const fromRule = (name: string) => commands.filter((c) => c.mapping === name);

function setMode(mode: Mode) {
  bus.emit('mode', mode);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
  vi.advanceTimersByTime(10_000); // so "time 0" cooldowns are not an issue
  commands = [];
  shownTab = 'learn';
  resetControls();
  setMode('play');

  // playback, wired like web/src/modules/playback/index.ts does it
  output = new FakeOutput();
  playback = new PlaybackController({ output, publish: (s) => bus.emit('transport', s), report: () => {} });
  stops.push(
    bus.on('controls', (c) => playback.applyControls(c), { replay: true }),
    bus.on('command', (cmd) => playback.command(cmd.command)),
  );
  playback.setAnalysis(twinkle); // the demo song: sound is made from its notes, ready to play

  // create, wired like web/src/modules/create/index.tsx does it (fake sound engine)
  createClock = 100_000;
  store = createStore(initialState());
  loop = new FakeLoopEngine();
  stops.push(startController({ engine: loop, store, now: () => createClock, inputLatencyMs: 0, tailMs: 0 }));

  stops.push(startShellStandIn());
  stops.push(bus.on('command', (c) => commands.push(c)));
  stops.push(startCommands()); // the real commands module, reading the real mappings.yaml
});
afterEach(() => {
  stops.reverse().forEach((s) => s());
  stops = [];
  playback.dispose();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------------------------
// Signals, sent the way vision and audio-live send them
// ---------------------------------------------------------------------------------------------------------------
const moment = (id: string, state: 'start' | 'end' = 'start', confidence = 0.9) => sendSignal({ id, kind: 'moment', state, confidence });
const slider = (id: string, value: number, confidence = 0.9) => sendSignal({ id, kind: 'slider', value, confidence });
/** audio-live: keyword signals carry no confidence */
const say = (word: string) => sendSignal({ id: `audio.keyword.${word}`, kind: 'moment', state: 'start' });
/** A hand held at one place for a while: vision sends about 30 readings a second. */
function holdSlider(id: string, value: number, readings = 40) {
  for (let i = 0; i < readings; i++) {
    slider(id, value);
    vi.advanceTimersByTime(33);
  }
}
const fist = (side: 'left' | 'right', state: 'start' | 'end' = 'start') => moment(`vision.hand.${side}.fist`, state, 1);

/** Hum a take into Create: Record (a button), count-in over, hum the fake melody. Leaves the take running. */
function beginTake(by: 'button' | 'voice' = 'button') {
  if (by === 'button') sendCommand('create.loop.record', 'button', { how: 'set', value: true });
  else say('start');
  expect(loop.hooks, 'the Create controller never started the loop for a take').toBeDefined();
  loop.hooks!.onGo(createClock);
  for (const f of fakeHumFrames(0)) {
    const at = 100_000 + f.t_ms;
    createClock = at;
    bus.emit('pitch', f);
  }
  createClock += 200;
}
/**
 * A finished layer with notes, then the loop playing it (the normal state for the Create gestures). Since the Create
 * reframe (Sun 6 AM) a take that ends on time is KEPT and all playback STOPS (phase idle); Play starts the loop again.
 */
function recordedLayer() {
  beginTake();
  loop.hooks!.onPassEnd();
  expect(createState().phase, 'setup: a take that ends on time stops everything').toBe('idle');
  expect(layer()?.notes.length ?? 0, 'setup: the fake hum should give notes').toBeGreaterThan(0);
  sendCommand('create.loop.play', 'button');
  expect(createState().phase, 'setup: Play starts the loop').toBe('playing');
}

// ---------------------------------------------------------------------------------------------------------------
// 0. The engine accepts the file
// ---------------------------------------------------------------------------------------------------------------
describe('mappings.yaml loads cleanly in the real engine', () => {
  it('has no errors or warnings, and every rule in the file was kept', () => {
    const result = loadMappings(YAML_TEXT);
    expect(result.fatal).toBe(false);
    expect(result.issues.map((i) => `${i.level}: ${i.where}: ${i.message}`)).toEqual([]);
    expect(result.rules.map((r) => r.label)).toEqual(RAW_RULES.map((r) => r.name));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 1. Play mode
// ---------------------------------------------------------------------------------------------------------------
describe('Play mode rules: the effect on the song', () => {
  it('hand height controls tempo', () => {
    const [lo, hi] = ruleNamed('hand height controls tempo').range!;
    holdSlider('vision.hand.right.height', 1);
    const up = controls()['playback.tempo'] as number;
    expect(up).toBeGreaterThan(1.2);
    expect(up).toBeLessThanOrEqual(hi);
    expect(transport().tempo).toBe(up);
    expect(output.tempo).toBe(up);
    holdSlider('vision.hand.right.height', 0, 80);
    const down = controls()['playback.tempo'] as number;
    expect(down).toBeLessThan(0.8);
    expect(down).toBeGreaterThanOrEqual(lo);
    expect(transport().tempo).toBe(down);
    expect(fromRule('hand height controls tempo').length).toBeGreaterThan(0);
  });

  it('hand height controls tempo: low-confidence readings are ignored', () => {
    for (let i = 0; i < 40; i++) slider('vision.hand.right.height', 1, 0.3);
    expect(controls()['playback.tempo']).toBe(1);
  });

  it('head tilt slows down (switched off in the file, so tilting does nothing)', () => {
    expect(ruleNamed('head tilt slows down').enabled).toBe(false);
    holdSlider('vision.head.tilt', 1);
    expect(fromRule('head tilt slows down')).toEqual([]);
    expect(controls()['playback.tempo']).toBe(1);
  });

  it('clap toggles play/pause', () => {
    const cooldown = ruleNamed('clap toggles play/pause').cooldown_ms ?? 0;
    expect(transport().loaded).toBe(true);
    expect(transport().playing).toBe(false);
    moment('audio.clap.double');
    expect(transport().playing).toBe(true);
    expect(output.playing).toBe(true);
    // a second double clap inside the cooldown is the same moment
    vi.advanceTimersByTime(cooldown / 2);
    moment('audio.clap.double');
    expect(transport().playing).toBe(true);
    vi.advanceTimersByTime(cooldown);
    moment('audio.clap.double');
    expect(transport().playing).toBe(false);
  });

  it('clap toggles play/pause: a single clap does nothing', () => {
    moment('audio.clap');
    moment('audio.clap');
    expect(transport().playing).toBe(false);
  });

  it('say "pause" only while left fist is held', () => {
    sendCommand('playback.play', 'button');
    expect(transport().playing).toBe(true);
    fist('left');
    say('pause');
    expect(transport().playing).toBe(false);
  });

  it('say "play" only while left fist is held', () => {
    fist('left');
    say('play');
    expect(transport().playing).toBe(true);
  });

  it('say "slower" only while left fist is held', () => {
    fist('left');
    say('slower');
    expect(controls()['playback.tempo']).toBe(1 + ruleNamed('say "slower" only while left fist is held').step!);
    expect(transport().tempo).toBeCloseTo(0.9, 6);
    for (let i = 0; i < 20; i++) say('slower');
    expect(controls()['playback.tempo']).toBe(0.5); // stays inside the control's range
  });

  it('say "faster" only while left fist is held', () => {
    fist('left');
    say('faster');
    expect(transport().tempo).toBeCloseTo(1.1, 6);
    for (let i = 0; i < 20; i++) say('faster');
    expect(controls()['playback.tempo']).toBe(1.5);
  });

  it('say "higher" only while left fist is held', () => {
    fist('left');
    say('higher');
    expect(transport().pitch).toBe(1);
    expect(output.pitch).toBe(1);
  });

  it('say "lower" only while left fist is held', () => {
    fist('left');
    say('lower');
    expect(transport().pitch).toBe(-1);
  });
});

describe('Play mode voice words need the left fist', () => {
  const voiceRules = RAW_RULES.filter((r) => r.mode === 'play' && r.when?.startsWith('audio.keyword.'));
  it('every Play voice rule asks for the left fist', () => {
    expect(voiceRules.length).toBeGreaterThan(0);
    for (const r of voiceRules) expect(r.only_while, `"${r.name}" has no only_while`).toBe('vision.hand.left.fist');
  });
  for (const r of voiceRules) {
    it(`${r.name}: without the fist, nothing happens`, () => {
      if (r.do === 'playback.pause') sendCommand('playback.play', 'button');
      const before = { playing: transport().playing, tempo: transport().tempo, pitch: transport().pitch };
      say(r.when!.slice('audio.keyword.'.length));
      expect(fromRule(r.name!)).toEqual([]);
      expect({ playing: transport().playing, tempo: transport().tempo, pitch: transport().pitch }).toEqual(before);
    });
    it(`${r.name}: letting go of the fist switches it off again`, () => {
      if (r.do === 'playback.pause') sendCommand('playback.play', 'button');
      fist('left');
      fist('left', 'end');
      say(r.when!.slice('audio.keyword.'.length));
      expect(fromRule(r.name!)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Create mode
// ---------------------------------------------------------------------------------------------------------------
describe('Create mode rules: the effect on the layers', () => {
  beforeEach(() => setMode('create'));

  it('right hand height pitches the enabled layer', () => {
    recordedLayer();
    expect(layer()!.handPitchEnabled).toBe(true);
    holdSlider('vision.hand.right.height', 1);
    const up = layer()!.pitchSemitones!;
    expect(up).toBeGreaterThan(2);
    expect(up).toBeLessThanOrEqual(6);
    holdSlider('vision.hand.right.height', 0, 80);
    const down = layer()!.pitchSemitones!;
    expect(down).toBeLessThan(-2);
    expect(down).toBeGreaterThanOrEqual(-6);
  });

  it('start begins recording a layer', () => {
    say('start');
    expect(controls()['create.loop.record']).toBe(true);
    expect(createState().phase).toBe('countIn');
    expect(loop.calls).toContain('start:countIn');
    loop.hooks!.onGo(createClock);
    expect(createState().phase).toBe('recording');
    expect(createState().layers).toHaveLength(1);
  });

  it('raised left fist ends the current take', () => {
    beginTake();
    expect(createState().phase).toBe('recording');
    fist('left'); // the held part (only_while)
    moment('vision.hand.left.raised', 'start', 1); // the moment
    expect(fromRule('raised left fist ends the current take')).toHaveLength(1);
    // Create reframe (Sun 6 AM): a take stopped before the loop length is DISCARDED and everything stops
    expect(createState().phase).toBe('idle');
    expect(layer()?.notes.length ?? 0).toBe(0);
    expect(controls()['create.loop.record']).toBe(false);
  });

  it('fist closes while raised ends the current take', () => {
    beginTake();
    moment('vision.hand.left.raised', 'start', 1); // the held part (only_while)
    fist('left'); // the moment
    expect(fromRule('fist closes while raised ends the current take')).toHaveLength(1);
    expect(createState().phase).toBe('idle'); // early stop discards the take (Create reframe)
    expect(layer()?.notes.length ?? 0).toBe(0);
  });

  it('a plain left fist (hand not raised) does not end the take', () => {
    beginTake();
    fist('left');
    expect(createState().phase).toBe('recording');
  });

  it('right hand position controls layer volume', () => {
    recordedLayer();
    const start = layer()!.volume;
    holdSlider('vision.hand.right.x', 0, 80);
    const low = layer()!.volume;
    expect(low).toBeLessThan(start - 0.3);
    expect(low).toBeGreaterThanOrEqual(0);
    holdSlider('vision.hand.right.x', 1, 80);
    expect(layer()!.volume).toBeGreaterThan(0.9);
    expect(layer()!.volume).toBeLessThanOrEqual(1);
  });

  it('left thumbs-up keeps the current pitch', () => {
    recordedLayer();
    const before = layer()!.notes.map((n) => n.pitch);
    holdSlider('vision.hand.right.height', 1);
    const shift = layer()!.pitchSemitones!;
    expect(shift).not.toBe(0);
    moment('vision.hand.left.thumbs_up', 'start', 1);
    expect(layer()!.pitchConfirmed).toBe(true);
    expect(layer()!.handPitchEnabled).toBe(false);
    expect(layer()!.notes.map((n) => n.pitch)).toEqual(before.map((p) => p + shift));
  });

  it('say next to record another layer', () => {
    recordedLayer();
    const first = layer()!.id;
    say('next');
    expect(createState().layers.filter((l) => l.kind === 'hum')).toHaveLength(2);
    expect(layer()!.id).not.toBe(first);
    expect(createState().phase).toBe('countIn');
  });

  const instrumentRules: Array<[string, string, string]> = [
    ['say piano for this layer', 'piano', 'bass'],
    ['say synth for this layer', 'synth', 'piano'],
    ['say bass for this layer', 'bass', 'piano'],
    ['say pluck for this layer', 'pluck', 'piano'],
    ['say drums for this layer', 'drums', 'piano'],
  ];
  for (const [name, word, other] of instrumentRules) {
    it(name, () => {
      expect(ruleNamed(name).value).toBe(word);
      recordedLayer();
      sendCommand('create.instrument', 'button', { how: 'set', value: other });
      expect(layer()!.instrument).toBe(other);
      say(word);
      expect(fromRule(name)).toHaveLength(1);
      expect(layer()!.instrument).toBe(word);
    });
  }

  const effectRules: Array<[string, string, string]> = [
    ['say none for this layer', 'none', 'reverb'],
    ['say reverb for this layer', 'reverb', 'none'],
    ['say delay for this layer', 'delay', 'none'],
    ['say filter for this layer', 'filter', 'none'],
  ];
  for (const [name, word, other] of effectRules) {
    it(name, () => {
      expect(ruleNamed(name).value).toBe(word);
      recordedLayer();
      sendCommand('create.effects', 'button', { how: 'set', value: other });
      expect(layer()!.effects).toBe(other);
      say(word);
      expect(fromRule(name)).toHaveLength(1);
      expect(layer()!.effects).toBe(word);
    });
  }

  it('say beat to turn on the beat', () => {
    say('beat');
    expect(controls()['create.beat']).toBe(true);
    expect(createState().layers.some((l) => l.kind === 'beat')).toBe(true);
    expect(createState().phase).toBe('playing');
  });

  it('right fist finishes the composition', () => {
    recordedLayer();
    loop.calls = [];
    fist('right');
    expect(fromRule('right fist finishes the composition')).toHaveLength(1);
    expect(createState().phase).toBe('idle');
    expect(loop.calls).toContain('stop');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Any mode: signs and grabs
// ---------------------------------------------------------------------------------------------------------------
describe('Any-mode rules', () => {
  const signRules: Array<[string, string, Tab, Mode]> = [
    ['hold L to go to Learn', 'l', 'learn', 'play'],
    ['hold Y to go to Play', 'y', 'play', 'learn'],
    ['hold C to go to Create', 'c', 'create', 'play'],
    ['hold W to go to the Command Lab', 'w', 'lab', 'learn'],
  ];
  for (const [name, letter, tab, from] of signRules) {
    // Switched off Sun 5:30 AM (Lalitha): modes are chosen on the record menu, not with ASL signs.
    it(`${name} is switched off: holding the sign does nothing`, () => {
      expect(ruleNamed(name).enabled).toBe(false);
      setMode(from);
      moment(`vision.sign.${letter}`);
      vi.advanceTimersByTime((ruleNamed(name).hold_ms ?? 2000) + 500);
      expect(fromRule(name)).toEqual([]);
      expect(bus.last('mode')).toBe(from);
      void tab;
    });
    it(`${name}: letting go early does nothing`, () => {
      setMode(from);
      moment(`vision.sign.${letter}`);
      vi.advanceTimersByTime(ruleNamed(name).hold_ms! - 300);
      moment(`vision.sign.${letter}`, 'end', 1);
      vi.advanceTimersByTime(3000);
      expect(fromRule(name)).toEqual([]);
      expect(bus.last('mode')).toBe(from);
    });
  }

  // The grab -> app.enter rules were replaced by the hand cursor's hold-to-click (ui/overture/HandPointer.tsx).
  it('has no grab -> app.enter rules any more', () => {
    expect(RAW_RULES.filter((r) => String(r.when).endsWith('.grab'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Every mode-bound rule is quiet in the other modes
// ---------------------------------------------------------------------------------------------------------------
describe('rules stay quiet in the wrong mode', () => {
  const MODES: Mode[] = ['learn', 'play', 'create'];
  for (const r of RAW_RULES.filter((x) => x.enabled !== false && x.mode && x.mode !== 'any')) {
    for (const wrong of MODES.filter((m) => m !== r.mode)) {
      it(`${r.name}: does nothing in ${wrong} mode`, () => {
        setMode(wrong);
        if (r.only_while) moment(r.only_while, 'start', 1);
        const info = signalCatalog.signals.find((s) => s.id === r.when);
        if (info?.kind === 'slider') {
          holdSlider(r.when!, 1, 10);
          holdSlider(r.when!, 0, 10);
        } else {
          moment(r.when!);
          if (r.hold_ms) vi.advanceTimersByTime(r.hold_ms + 100);
        }
        expect(fromRule(r.name!)).toEqual([]);
      });
    }
  }

  it('Create words said in Play mode change nothing in Create', () => {
    recordedLayerInPlayModeCheck();
  });
});

/** Words like "piano" said while in Play: no command from a Create rule, and Create's layers stay untouched. */
function recordedLayerInPlayModeCheck() {
  setMode('play');
  const before = JSON.stringify(createState());
  for (const w of ['start', 'next', 'piano', 'reverb', 'beat']) say(w);
  fist('right');
  expect(commands.filter((c) => c.command.startsWith('create.'))).toEqual([]);
  expect(JSON.stringify(createState())).toBe(before);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Static audit: every rule's signal is really sent by some module, and every control is really handled
// ---------------------------------------------------------------------------------------------------------------
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => relative(SRC, p).replace(/\\/g, '/');

// Signal senders: the real camera and microphone code (not the fake replays, which only exist for ?fake=1).
const SENDER_FILES = [...sourceFiles(join(SRC, 'modules/vision')), ...sourceFiles(join(SRC, 'modules/audio-live'))].filter(
  (p) => !/[\\/](fake[^\\/]*|synthetic[^\\/]*|test-[^\\/]*)\.ts$/.test(p),
);
const SENDER_TEXT = SENDER_FILES.map(read).join('\n');
/** Words that appear as quoted strings in the sender code (hold names, sides, keyword lists...). */
const QUOTED_WORDS = new Set([...SENDER_TEXT.matchAll(/['"]([a-z0-9_]+)['"]/g)].map((m) => m[1]));
const HAS_ALPHABET = SENDER_TEXT.includes("'abcdefghijklmnopqrstuvwxyz'");
/** Template ids like `vision.hand.${side}.${h}` turned into patterns. */
const TEMPLATE_IDS = [...SENDER_TEXT.matchAll(/`((?:vision|audio)\.[^`]*\$\{[^`]*)`/g)].map((m) => m[1]);

/** Where (if anywhere) a signal id is sent from: a quoted literal, or a template whose parts are known words. */
function senderOf(id: string): string | undefined {
  for (const p of SENDER_FILES) if (new RegExp(`['"\`]${id.replace(/\./g, '\\.')}['"\`]`).test(read(p))) return `${rel(p)} (literal)`;
  for (const tpl of TEMPLATE_IDS) {
    const pattern = new RegExp('^' + tpl.split(/\$\{[^}]*\}/).map((s) => s.replace(/\./g, '\\.')).join('([a-z0-9_]+)') + '$');
    const m = id.match(pattern);
    if (!m) continue;
    const parts = m.slice(1);
    if (parts.every((part) => QUOTED_WORDS.has(part) || (HAS_ALPHABET && /^[a-z]$/.test(part)))) return `template \`${tpl}\``;
  }
  return undefined;
}

// Handlers: app code that reacts to a control by name. The generic plumbing (the engine, the Command Lab that only
// shows things, the bus, the catalogs, the TouchDesigner forwarder) does not count as an effect in the app.
const NOT_HANDLERS = ['modules/commands/', 'modules/command-lab/', 'modules/mappings/', 'modules/touchdesigner/', 'bus/', 'contracts/'];
const HANDLER_FILES = sourceFiles(SRC).filter((p) => !NOT_HANDLERS.some((d) => rel(p).startsWith(d)));
function handlersOf(control: string): string[] {
  const q = control.replace(/\./g, '\\.');
  const re = new RegExp(`(case\\s+['"]${q}['"]|[!=]==\\s*['"]${q}['"]|['"]${q}['"]\\s*[!=]==|\\[['"]${q}['"]\\])`);
  return HANDLER_FILES.filter((p) => re.test(read(p))).map(rel);
}

const SIGNAL_IDS = new Set(signalCatalog.signals.map((s) => s.id));
const CONTROL_BY_ID = new Map(controlCatalog.controls.map((c) => [c.id, c]));

/** Everything wrong with one rule, in plain words (empty = fine). */
function auditRule(r: RawRule): string[] {
  const problems: string[] = [];
  for (const key of ['name', 'mode', 'when', 'do', 'how'] as const) if (r[key] === undefined || r[key] === '') problems.push(`missing "${key}:"`);
  if (r.mode && !['play', 'create', 'learn', 'any'].includes(r.mode)) problems.push(`mode "${r.mode}" is not play, create, learn or any`);
  if (r.how && !['follow', 'trigger', 'toggle', 'nudge'].includes(r.how)) problems.push(`how "${r.how}" is not follow, trigger, toggle or nudge`);

  for (const [field, id] of [['when', r.when], ['only_while', r.only_while]] as const) {
    if (!id) continue;
    if (!SIGNAL_IDS.has(id)) problems.push(`${field} "${id}" is not in contracts/signal-catalog.json`);
    else if (!senderOf(id)) problems.push(`${field} "${id}" is never sent by vision or audio-live (no literal or template found)`);
  }

  const ctl = r.do ? CONTROL_BY_ID.get(r.do) : undefined;
  if (r.do && !ctl) problems.push(`do "${r.do}" is not in contracts/control-catalog.json`);
  if (ctl) {
    if (r.mode && r.mode !== 'any' && !ctl.modes.includes(r.mode as Mode)) problems.push(`do "${r.do}" does not work in ${r.mode} mode (only ${ctl.modes.join('/')})`);
    if (handlersOf(ctl.id).length === 0) problems.push(`nothing in the app reacts to "${ctl.id}" (no handler found outside the engine and Command Lab)`);
    const v = r.value;
    if (v !== undefined) {
      if (ctl.kind === 'toggle' && typeof v !== 'boolean') problems.push(`value ${JSON.stringify(v)} should be true or false for ${ctl.id}`);
      if (ctl.kind === 'value' && ctl.value_type === 'string' && ctl.options && !ctl.options.includes(v as string)) {
        problems.push(`value ${JSON.stringify(v)} is not one of ${ctl.id}'s options (${ctl.options.join(', ')})`);
      }
      if (ctl.kind === 'value' && (ctl.value_type ?? 'number') === 'number' && typeof v !== 'number') problems.push(`value ${JSON.stringify(v)} should be a number for ${ctl.id}`);
    } else if (r.how === 'trigger' && ctl.kind === 'value') {
      problems.push(`a trigger on "${ctl.id}" (a value control) needs a "value:"`);
    }
    if (r.how === 'nudge' && r.step === undefined && ctl.step === undefined) problems.push('nudge without a step');
    if (r.range && ctl.range && (Math.min(...r.range) < ctl.range[0] || Math.max(...r.range) > ctl.range[1])) {
      problems.push(`range [${r.range.join(', ')}] goes past ${ctl.id}'s range [${ctl.range.join(', ')}]`);
    }
  }
  return problems;
}

describe('static audit of every rule', () => {
  RAW_RULES.forEach((r, i) => {
    const name = r.name ?? `rule ${i + 1}`;
    it(`${name}: complete, in the catalogs, signal sent by a module, control handled`, () => {
      expect(auditRule(r), `rule "${name}"`).toEqual([]);
    });
  });

  it('the audit itself catches broken rules (missing do / mode / how, a value outside the options, unknown names)', () => {
    const good: RawRule = { name: 'x', mode: 'create', when: 'audio.keyword.piano', do: 'create.instrument', how: 'trigger', value: 'piano' };
    expect(auditRule(good)).toEqual([]);
    expect(auditRule({ ...good, do: undefined })).toContain('missing "do:"');
    expect(auditRule({ ...good, mode: undefined })).toContain('missing "mode:"');
    expect(auditRule({ ...good, how: undefined })).toContain('missing "how:"');
    expect(auditRule({ ...good, value: 'kazoo' })).toEqual([`value "kazoo" is not one of create.instrument's options (piano, synth, bass, pluck, drums)`]);
    expect(auditRule({ ...good, value: undefined })).toEqual(['a trigger on "create.instrument" (a value control) needs a "value:"']);
    expect(auditRule({ ...good, when: 'audio.keyword.kazoo' })).toEqual(['when "audio.keyword.kazoo" is not in contracts/signal-catalog.json']);
    expect(auditRule({ ...good, do: 'create.kazoo' })).toEqual(['do "create.kazoo" is not in contracts/control-catalog.json']);
    expect(auditRule({ ...good, mode: 'play' })).toEqual(['do "create.instrument" does not work in play mode (only create)']);
  });

  it('the sender and handler searches are not too generous', () => {
    expect(senderOf('vision.hand.left.kazoo')).toBeUndefined();
    expect(senderOf('audio.keyword.kazoo')).toBeUndefined();
    expect(senderOf('vision.sign.l')).toBeDefined();
    expect(senderOf('audio.keyword.piano')).toBeDefined();
    expect(handlersOf('create.kazoo')).toEqual([]);
    expect(handlersOf('create.loop.play')).toEqual(['modules/create/controller.ts']);
  });

  it('App.tsx still reacts to app.mode (the stand-in above copies this logic)', () => {
    const app = read(join(SRC, 'app/App.tsx'));
    expect(app).toMatch(/bus\.on\(\s*'command'/);
    expect(app).toMatch(/c\.command === 'app\.mode'/);
    expect(app).toMatch(/const modeOf = \(tab: Tab\): Mode => \(tab === 'lab' \? 'play' : tab\)/);
    for (const t of TABS) expect(app).toContain(`id: '${t}'`);
  });

  it('the record menu reacts to app.enter', () => {
    const menu = read(join(SRC, 'ui/overture/RecordMenu.tsx'));
    expect(menu).toMatch(/bus\.on\('command'/);
    expect(menu).toMatch(/c\.command !== 'app\.enter'/);
    expect(menu).toMatch(/onChoose\(/);
  });
});
