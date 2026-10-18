// @vitest-environment jsdom
// Checks the shell in a fake page. The other modules and the sheet-music engine are replaced by simple stand-ins.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import rulesTempo from '@fixtures/feedback/rules-tempo.json';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { bus, reportStatus, resetControls, type Topics } from '@/bus';
import * as audioLive from '@/modules/audio-live';
import * as commands from '@/modules/commands';
import * as create from '@/modules/create';
import * as playback from '@/modules/playback';
import * as touchdesigner from '@/modules/touchdesigner';
import * as vision from '@/modules/vision';
import { App } from './App';

const osmdLoads = vi.hoisted(() => [] as string[]);

vi.mock('opensheetmusicdisplay', () => ({
  OpenSheetMusicDisplay: class {
    constructor(private host: HTMLElement) {}
    async load(xml: string) {
      osmdLoads.push(xml);
    }
    render() {
      this.host.innerHTML = '<svg></svg>';
    }
    clear() {
      this.host.innerHTML = '';
    }
    setOptions() {}
    cursor = { show() {}, reset() {}, next() {}, cursorElement: null, Iterator: { EndReached: true, moveToNext() {}, CurrentSourceTimestamp: { RealValue: 0 } } };
  },
}));
vi.mock('@/modules/playback', () => ({ start: vi.fn(() => vi.fn()) }));
vi.mock('@/modules/commands', () => ({ start: vi.fn(() => vi.fn()) }));
vi.mock('@/modules/vision', () => ({ start: vi.fn(() => vi.fn()) }));
vi.mock('@/modules/audio-live', () => ({ start: vi.fn(() => vi.fn()) }));
vi.mock('@/modules/touchdesigner', () => ({ start: vi.fn(() => vi.fn()) }));
vi.mock('@/modules/create', async () => {
  const { createElement } = await import('react');
  return { start: vi.fn(() => vi.fn()), CreatePanel: () => createElement('div', { 'data-testid': 'create-panel' }) };
});
vi.mock('@/modules/command-lab', async () => {
  const { createElement } = await import('react');
  return { CommandLab: () => createElement('div', { 'data-testid': 'command-lab' }) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => $(id)?.textContent ?? null;
const click = (id: string) => act(async () => void $(id)!.click());
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
async function until(check: () => unknown, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const emit = <K extends keyof Topics>(topic: K, value: Topics[K]) => act(async () => void bus.emit(topic, value));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const seen: string[] = [];
const watch = (): (() => void)[] => [
  bus.on('mode', (m) => seen.push(`mode:${m}`)),
  bus.on('enable', (e) => seen.push(`enable:${e.module}:${e.on}`)),
  bus.on('songAudio', (s) => seen.push(`songAudio:${s.songId}`)),
  bus.on('analysis', (a) => seen.push(`analysis:${a.song_id}`)),
  bus.on('command', (c) => seen.push(`command:${c.command}:${c.source}:${c.how}:${c.value ?? ''}`)),
];
let unwatch: (() => void)[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  osmdLoads.length = 0;
  seen.length = 0;
  resetControls();
  // the bus remembers the last status of every module: start each test with everything off
  for (const module of ['vision', 'audio-live', 'touchdesigner', 'playback']) bus.emit('status', { module, state: 'idle' });
  bus.emit('cameraStream', null);
  vi.stubGlobal('fetch', vi.fn(async () => json(twinkle)));
  unwatch = watch();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  unwatch.forEach((u) => u());
  vi.unstubAllGlobals();
});

describe('layout', () => {
  it('shows the title, four tabs, the song loader and an empty sheet', () => {
    expect(container.querySelector('h1')?.textContent).toBe('Overture');
    for (const t of ['tab-learn', 'tab-play', 'tab-create', 'tab-lab']) expect($(t)).not.toBeNull();
    expect($('song-file')?.getAttribute('accept')).toBe('audio/*');
    expect($('use-demo')).not.toBeNull();
    expect($('sheet')).not.toBeNull();
    expect($('analysis-summary')).toBeNull();
    expect(text('transport-state')).toBe('no song');
  });

  it('the small record next to the logo is the Records button; the header has no TouchDesigner switch', () => {
    const records = container.querySelector<HTMLButtonElement>('header button[aria-label="Records"]');
    expect(records).not.toBeNull();
    expect(records!.querySelector('svg.record-mark')).not.toBeNull();
    expect(container.querySelector('header .records-pill')).toBeNull();
    expect(container.querySelector('header [data-testid="btn-enable-td"]')).toBeNull();
    // login is not shown anywhere, and the header is never inert (the logo works on every screen)
    expect(container.querySelector('[data-testid="btn-login"], .login-box')).toBeNull();
    expect(container.querySelector('header')?.hasAttribute('inert')).toBe(false);
  });

  it('starts every module once and stops them when the page goes away', async () => {
    const mods = [playback, commands, vision, audioLive, touchdesigner, create];
    for (const m of mods) expect(m.start).toHaveBeenCalledTimes(1);
    const stops = mods.map((m) => vi.mocked(m.start).mock.results[0].value as ReturnType<typeof vi.fn>);
    await act(async () => root.unmount());
    for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
    root = createRoot(container); // so afterEach can unmount again
  });

  it('announces the mode on every tab change (Command Lab counts as play) and swaps the panels', async () => {
    expect(seen).toContain('mode:learn');
    await click('tab-play');
    // Play is hands and voice only: no sheet, no panels
    expect($('sheet')).toBeNull();
    expect(container.querySelector('.panel-toggles')).toBeNull();
    await click('tab-create');
    expect($('create-panel')).not.toBeNull();
    expect($('sheet')).toBeNull();
    await click('tab-lab');
    expect($('command-lab')).not.toBeNull();
    await click('tab-learn');
    expect(seen.filter((s) => s.startsWith('mode:'))).toEqual(['mode:learn', 'mode:play', 'mode:create', 'mode:play', 'mode:learn']);
  });
});

describe('loading a song', () => {
  it('uses the demo song from the server (no notice) and fills the summary and the sheet', async () => {
    await click('use-demo');
    await until(() => $('sheet-ready'), 'the sheet');
    // (the bus may still remember a song from an earlier test, so the history may ask for its sessions first)
    expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).toContain('/api/songs/demo-twinkle/analysis');
    expect(text('analysis-title')).toBe('Twinkle, Twinkle, Little Star');
    expect(text('analysis-tempo')).toBe('100 BPM');
    expect(text('analysis-key')).toBe('C major');
    expect(text('analysis-time-signature')).toBe('4/4');
    expect($('offline-notice')).toBeNull();
    expect(text('sheet-note-count')).toBe('42');
    expect($('sheet')!.querySelector('svg')).not.toBeNull();
    expect(seen.filter((s) => s.startsWith('analysis') || s.startsWith('songAudio'))).toEqual(['analysis:demo-twinkle']);
  });

  it('falls back to the built-in demo and says so when the server is not there', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await click('use-demo');
    await until(() => $('analysis-summary'), 'the summary');
    expect(text('offline-notice')).toBe('Server not reachable: using the built-in demo');
    expect(text('analysis-title')).toBe('Twinkle, Twinkle, Little Star');
    await until(() => $('sheet-ready'), 'the sheet');
    // the notice survives switching tabs
    await click('tab-create');
    await click('tab-learn');
    expect(text('offline-notice')).toBe('Server not reachable: using the built-in demo');
  });

  it('uploads a file: songAudio goes out before the analysis', async () => {
    const buffer = { duration: 1 } as unknown as AudioBuffer;
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        resume = async () => {};
        decodeAudioData = async () => buffer;
      },
    );
    const uploaded = { ...twinkle, song_id: 'upload-1a2b3c4d', title: 'my song' };
    const fetchMock = vi.fn(async () => json(uploaded));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], 'my song.wav', { type: 'audio/wav' });
    const input = $('song-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => void input.dispatchEvent(new Event('change', { bubbles: true })));
    await until(() => text('analysis-title') === 'my song', 'the uploaded song');
    expect(fetchMock.mock.calls[0]).toMatchObject(['/api/songs', { method: 'POST' }]);
    expect(seen.filter((s) => s.startsWith('analysis') || s.startsWith('songAudio'))).toEqual(['songAudio:upload-1a2b3c4d', 'analysis:upload-1a2b3c4d']);
  });

  it('shows a friendly message when the server refuses the file', async () => {
    vi.stubGlobal('AudioContext', class { state = 'running'; resume = async () => {}; decodeAudioData = async () => ({}) });
    vi.stubGlobal('fetch', vi.fn(async () => json({ detail: 'Traceback (most recent call last)' }, 400)));
    const input = $('song-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'x.txt')], configurable: true });
    await act(async () => void input.dispatchEvent(new Event('change', { bubbles: true })));
    await until(() => $('load-message'), 'the message');
    expect(text('load-message')).toMatch(/could not read that file/);
    expect(text('load-message')).not.toMatch(/Traceback/);
  });
});

describe('transport', () => {
  it('shows tempo, pitch and the loop switch from the controls, and sends button commands', async () => {
    expect(text('tempo-value')).toBe('1.0x');
    expect(text('pitch-value')).toBe('0 semitones');
    await click('btn-tempo-up');
    await click('btn-tempo-up');
    await click('btn-tempo-down');
    expect(text('tempo-value')).toBe('1.1x');
    await click('btn-pitch-up');
    await click('btn-pitch-up');
    await click('btn-pitch-down');
    expect(text('pitch-value')).toBe('1 semitones');
    await click('btn-loop');
    expect($('btn-loop')!.getAttribute('aria-pressed')).toBe('true');
    await click('btn-play');
    await click('btn-pause');
    expect(seen.filter((s) => s.startsWith('command'))).toEqual([
      'command:playback.tempo:button:nudge:0.1',
      'command:playback.tempo:button:nudge:0.1',
      'command:playback.tempo:button:nudge:-0.1',
      'command:playback.pitch:button:nudge:1',
      'command:playback.pitch:button:nudge:1',
      'command:playback.pitch:button:nudge:-1',
      'command:playback.loop:button:toggle:',
      'command:playback.play:button:trigger:',
      'command:playback.pause:button:trigger:',
    ]);
  });

  it('the volume slider sets the volume', async () => {
    const slider = $('volume-slider') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '0.3');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(seen).toContain('command:playback.volume:button:set:0.3');
    expect(Number((bus.last('controls') as Record<string, number>)['playback.volume'])).toBe(0.3);
  });

  it('shows the playing state and position from the transport topic', async () => {
    const t = { loaded: true, playing: true, positionSec: 65.4, durationSec: 125, tempo: 1, pitch: 0, volume: 0.8, loop: false, loopSection: null };
    await emit('transport', t);
    expect(text('transport-state')).toBe('playing');
    expect(text('transport-position')).toBe('01:05 / 02:05');
    await emit('transport', { ...t, playing: false });
    expect(text('transport-state')).toBe('paused');
    await emit('transport', { ...t, loaded: false, playing: false, positionSec: 0, durationSec: 0 });
    expect(text('transport-state')).toBe('no song');
  });

  it('shows what playback says, in plain words, and nothing when it has nothing to say', async () => {
    expect($('status-playback')).toBeNull(); // idle with no message
    await emit('status', { module: 'playback', state: 'running' });
    expect($('status-playback')).toBeNull();
    await emit('status', { module: 'playback', state: 'starting', message: 'Making the demo song' });
    expect(text('status-playback')).toBe('Making the demo song');
    await emit('status', { module: 'playback', state: 'error', message: 'The browser did not allow sound yet. Click Play again.' });
    expect(text('status-playback')).toBe('Problem: The browser did not allow sound yet. Click Play again.');
    expect($('status-playback')!.getAttribute('data-state')).toBe('error');
    // other modules do not leak into it
    await emit('status', { module: 'vision', state: 'error', message: 'The camera is blocked.' });
    expect(text('status-playback')).toBe('Problem: The browser did not allow sound yet. Click Play again.');
    await emit('status', { module: 'playback', state: 'error', message: 'This song could not be played.' });
    expect(text('status-playback')).toBe('Problem: This song could not be played.');
    await emit('status', { module: 'playback', state: 'running', message: 'Ready to play' });
    expect(text('status-playback')).toBe('Ready to play');
    await emit('status', { module: 'playback', state: 'idle' });
    expect($('status-playback')).toBeNull();
  });

  it('still shows the problem after switching tabs and back', async () => {
    await emit('status', { module: 'playback', state: 'error', message: 'This song could not be played.' });
    await click('tab-create');
    expect($('status-playback')).toBeNull();
    await click('tab-learn');
    expect(text('status-playback')).toBe('Problem: This song could not be played.');
  });
});

describe('devices', () => {
  it('toggles each device with an enable event and shows status in plain words', async () => {
    expect(text('btn-enable-vision')).toBe('Camera off');
    expect(text('btn-enable-audio')).toBe('Microphone off');
    expect($('btn-enable-td')).toBeNull(); // TouchDesigner is switched only in the Command Lab
    await click('tab-lab');
    expect(text('btn-enable-td')).toBe('TouchDesigner off');
    await click('btn-enable-vision');
    await click('btn-enable-audio');
    await click('btn-enable-td');
    expect(seen.filter((s) => s.startsWith('enable'))).toEqual(['enable:vision:true', 'enable:audio-live:true', 'enable:touchdesigner:true']);
    await click('btn-enable-vision');
    expect(seen).toContain('enable:vision:false');
    expect(text('btn-enable-vision')).toBe('Camera off');

    await emit('status', { module: 'vision', state: 'starting' });
    expect(text('status-vision')).toBe('Starting...');
    await emit('status', { module: 'vision', state: 'running' });
    expect(text('status-vision')).toBe('On');
    expect($('status-vision')!.getAttribute('data-state')).toBe('running');
    await emit('status', { module: 'audio-live', state: 'error', message: 'The microphone is blocked.' });
    expect(text('status-audio-live')).toBe('Problem: The microphone is blocked.');
    expect(text('btn-enable-audio')).toBe('Microphone off'); // goes back so it can be tried again
    expect(text('status-touchdesigner')).toBe('Off');
  });

  const status = (module: string, state: Topics['status']['state'], message?: string) => emit('status', { module, state, message });

  it('keeps the TouchDesigner button on while it retries, however many problems it reports', async () => {
    await click('tab-lab');
    await click('btn-enable-td');
    expect(text('btn-enable-td')).toBe('TouchDesigner on');
    await status('touchdesigner', 'starting', 'Connecting to the TouchDesigner relay...');
    await status('touchdesigner', 'error', 'Relay not found: start it with: node bridge/relay.mjs.');
    await status('touchdesigner', 'error', 'Relay not found: start it with: node bridge/relay.mjs. (31 frames)');
    expect(text('btn-enable-td')).toBe('TouchDesigner on');
    expect($('btn-enable-td')!.getAttribute('aria-pressed')).toBe('true');
    expect(text('status-touchdesigner')).toMatch(/^Problem: Relay not found/);
    // the relay starts later: nothing flips
    await status('touchdesigner', 'running', 'Sending to TouchDesigner (5 frames sent).');
    expect(text('btn-enable-td')).toBe('TouchDesigner on');
    // a click turns it off, and it stays off
    await status('touchdesigner', 'error', 'Lost the TouchDesigner relay (trying again).');
    await click('btn-enable-td');
    expect(seen.filter((s) => s.startsWith('enable:touchdesigner'))).toEqual(['enable:touchdesigner:true', 'enable:touchdesigner:false']);
    expect(text('btn-enable-td')).toBe('TouchDesigner off');
    await status('touchdesigner', 'idle', 'TouchDesigner is off.');
    expect(text('btn-enable-td')).toBe('TouchDesigner off');
  });

  it('the camera and microphone buttons follow their status: starting and running are on, idle and problems are off', async () => {
    await status('vision', 'starting', 'Asking for the camera...');
    expect(text('btn-enable-vision')).toBe('Camera on');
    await status('vision', 'running', 'Camera tracking is on');
    expect(text('btn-enable-vision')).toBe('Camera on');
    await status('vision', 'error', 'The camera is blocked.');
    expect(text('btn-enable-vision')).toBe('Camera off');
    await status('vision', 'running');
    await status('vision', 'idle');
    expect(text('btn-enable-vision')).toBe('Camera off');

    // switched on somewhere else (the Command Lab, say): the button agrees, and so does turning it off there
    await status('audio-live', 'running', 'Microphone is on');
    expect(text('btn-enable-audio')).toBe('Microphone on');
    expect(seen.filter((s) => s.startsWith('enable'))).toEqual([]);
    await status('audio-live', 'idle', 'Microphone is off');
    expect(text('btn-enable-audio')).toBe('Microphone off');
  });

  it('the camera button says off when the module answers a click with a problem at once', async () => {
    const stop = bus.on('enable', (e) => {
      if (e.on) bus.emit('status', { module: e.module, state: 'error', message: 'This page cannot use the camera.' });
    });
    await click('btn-enable-vision');
    stop();
    expect(text('btn-enable-vision')).toBe('Camera off');
    expect(text('status-vision')).toBe('Problem: This page cannot use the camera.');
  });

  it('draws the buttons right after a reload of the panel when the modules are already on', async () => {
    await act(async () => root.unmount());
    bus.emit('status', { module: 'vision', state: 'running', message: 'Camera tracking is on' });
    bus.emit('status', { module: 'audio-live', state: 'error', message: 'The microphone is blocked.' });
    bus.emit('status', { module: 'touchdesigner', state: 'error', message: 'Relay not found: start it with: node bridge/relay.mjs.' });
    root = createRoot(container);
    await act(async () => root.render(<App />));
    await click('tab-lab');
    expect(text('btn-enable-vision')).toBe('Camera on');
    expect(text('status-vision')).toBe('On (Camera tracking is on)');
    expect(text('btn-enable-audio')).toBe('Microphone off');
    expect(text('btn-enable-td')).toBe('TouchDesigner on'); // a problem there means it is on and retrying
  });

  it('counts mapping issues', async () => {
    expect(text('issues-count')).toBe('0');
    await emit('issues', [
      { level: 'error', where: 'rule 1', message: 'Unknown control.' },
      { level: 'warning', where: 'rule 2', message: 'Very short cooldown.' },
    ]);
    expect(text('issues-count')).toBe('2');
  });
});

describe('camera preview', () => {
  const stream = { id: 'cam', getTracks: () => [] } as unknown as MediaStream;
  let restoreCanvas: () => void;
  // jsdom has no canvas: give the overlay a do-nothing one
  beforeEach(() => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect() {} } as unknown as CanvasRenderingContext2D);
    restoreCanvas = () => spy.mockRestore();
  });
  afterEach(() => restoreCanvas());

  it('shows "waiting" when the camera is switched on, then the picture, on every tab', async () => {
    await click('btn-enable-vision');
    await emit('status', { module: 'vision', state: 'starting', message: 'Asking for the camera...' });
    expect(text('camera-preview-waiting')).toBe('Waiting for the camera...');
    await emit('cameraStream', stream);
    expect($('camera-preview-waiting')).toBeNull();
    for (const tab of ['tab-learn', 'tab-play', 'tab-create', 'tab-lab']) {
      await click(tab);
      expect($('camera-preview'), tab).not.toBeNull();
      expect($('camera-preview-video'), tab).not.toBeNull();
      expect($('camera-preview-overlay'), tab).not.toBeNull();
    }
  });

  it('sits right under the Devices panel and goes away when the camera stops', async () => {
    await emit('cameraStream', stream);
    const devices = container.querySelector('[aria-labelledby="devices-heading"]')!;
    expect(devices.nextElementSibling).toBe($('camera-preview'));
    await emit('cameraStream', null);
    expect($('camera-preview')).toBeNull();
  });

  it('leaves the problem text to the Devices panel when the camera cannot start', async () => {
    await emit('status', { module: 'vision', state: 'error', message: 'Camera permission was blocked.' });
    expect($('camera-preview')).toBeNull();
    expect($('camera-preview-waiting')).toBeNull();
    expect(text('status-vision')).toBe('Problem: Camera permission was blocked.');
  });
});

describe('sheet controls', () => {
  it('picks a part, turns on note letters, and writes for another instrument', async () => {
    await click('use-demo');
    await until(() => $('sheet-ready'), 'the sheet');
    const last = () => osmdLoads[osmdLoads.length - 1];
    expect(last()).not.toContain('<lyric'); // letters are off by default
    expect(last()).toContain('<fifths>2</fifths>'); // the clarinet part is written a step higher

    await click('beginner-toggle');
    await until(() => last().includes('<lyric'), 'note letters');
    await until(() => $('sheet-ready'), 'the redraw');

    const part = $('part-picker') as HTMLSelectElement;
    expect([...part.options].map((o) => o.value)).toEqual(['melody', 'bass']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(part, 'bass');
      part.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(() => text('sheet-note-count') === '12', 'the bass part');
    expect(last()).toContain('<sign>F</sign>');
    // the bass part starts on the C below middle C; guitar is written an octave above it sounds
    expect(last()).toContain('<step>C</step><octave>3</octave>');

    const inst = $('instrument-picker') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(inst, 'guitar');
      inst.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(() => last().includes('<step>C</step><octave>4</octave>'), 'guitar written an octave higher');
  });
});

describe('practice panel', () => {
  const practiceIds = ['btn-calibrate', 'btn-practice-start', 'btn-practice-stop', 'practice-status'];

  it('sits next to the transport controls on Learn, and not on Play, Create or the Command Lab', async () => {
    for (const tab of ['tab-learn']) {
      await click(tab);
      for (const id of practiceIds) expect($(id), `${tab} ${id}`).not.toBeNull();
      expect($('btn-calibrate')!.closest('.song-controls'), tab).toBe($('btn-play')!.closest('.song-controls'));
      expect($('btn-play')!.closest('.song-controls'), tab).not.toBeNull();
    }
    for (const tab of ['tab-play', 'tab-create', 'tab-lab']) {
      await click(tab);
      expect($('btn-calibrate'), tab).toBeNull();
    }
  });

  it('asks the listening part to start, and loops the trouble bars of the loaded demo song at 80% speed', async () => {
    const control: string[] = [];
    const stop = bus.on('practiceControl', (c) => control.push(c.action));
    await click('use-demo');
    await until(() => $('sheet-ready'), 'the sheet');
    await act(async () => reportStatus('audio-live', 'running', 'Listening')); // the microphone is on (off, Start would turn it on first)
    await click('btn-practice-start');
    expect(control).toEqual(['start']);
    expect(seen).toContain('command:playback.play:button:trigger:');

    seen.length = 0;
    await emit('feedback', structuredClone(rulesTempo) as unknown as Topics['feedback']);
    expect(text('feedback-tempo')).toBe('You played about 90 BPM; the song is 100 BPM: a bit slow');
    await until(() => $('feedback-coaching'), 'the built-in tips (the demo server answers with a song, not coaching)');
    expect(text('feedback-coaching-label')).toBe('Coach (built-in tips)');
    await click('btn-loop-bar');
    expect(seen.filter((s) => s.startsWith('command'))).toEqual([
      'command:playback.loop_section:button:set:0,4.8',
      'command:playback.loop:button:set:true',
      'command:playback.tempo:button:set:0.8',
      'command:playback.play:button:trigger:',
    ]);
    stop();
  });

  it('keeps the feedback card in its own Feedback panel, which opens by itself when feedback arrives (nothing else closes)', async () => {
    await emit('feedback', undefined as unknown as Topics['feedback']); // the bus remembers the last run: start with none
    await click('tab-learn');
    const panel = container.querySelector<HTMLElement>('.feedback-card-panel')!;
    const practice = $('btn-practice-start')!.closest('.practice-card')!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('data-open')).toBe('false');
    expect($('feedback-empty')).not.toBeNull();
    const before = [...container.querySelectorAll<HTMLElement>('.float-panel:not(.feedback-card-panel)')].map((p) => p.getAttribute('data-open'));

    await emit('feedback', structuredClone(rulesTempo) as unknown as Topics['feedback']);
    expect(panel.getAttribute('data-open')).toBe('true');
    expect($('feedback-card')).not.toBeNull();
    expect(panel.contains($('feedback-card'))).toBe(true);
    expect(practice.contains($('feedback-card'))).toBe(false);
    expect([...container.querySelectorAll<HTMLElement>('.float-panel:not(.feedback-card-panel)')].map((p) => p.getAttribute('data-open'))).toEqual(before);
    const toggle = $('toggle-feedback');
    if (toggle) expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('on Learn, the Song panel holds the song picker only and the devices sit in their own Devices panel', async () => {
    await click('tab-learn');
    const song = $('use-demo')!.closest('.side-card')!;
    const devices = $('btn-enable-vision')!.closest('.side-card')!;
    expect(devices.classList.contains('devices-card')).toBe(true);
    expect(song).not.toBe(devices);
    expect(song.contains($('btn-enable-audio'))).toBe(false);
    expect(devices.contains($('status-vision'))).toBe(true);
    expect(devices.contains($('status-audio-live'))).toBe(true);
    await click('tab-play');
    expect($('use-demo')!.closest('.side-card')).toBe($('btn-enable-vision')!.closest('.side-card'));
  });
});
