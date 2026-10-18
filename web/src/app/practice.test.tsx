// @vitest-environment jsdom
// The Practice panel in a fake page: buttons, status, the feedback card and the loop-this-bar button, all through the bus.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import rulesTempo from '@fixtures/feedback/rules-tempo.json';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { bus, reportStatus, resetControls, type TransportState, type Topics } from '@/bus';
import type { CommandEvent, Feedback, SongAnalysis } from '@/contracts';
import { FeedbackPanel } from './FeedbackPanel';
import { Practice } from './Practice';
import { builtInCoaching } from './practice-logic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = twinkle as unknown as SongAnalysis;
const fresh = (): Feedback => structuredClone(rulesTempo) as unknown as Feedback;
const transport = (extra: Partial<TransportState> = {}): TransportState => ({ loaded: true, playing: false, positionSec: 0, durationSec: 28.8, tempo: 1, pitch: 0, volume: 0.8, loop: false, loopSection: null, ...extra });

let container: HTMLDivElement;
let root: Root;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (id: string) => $(id)?.textContent ?? null;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
const click = async (id: string) => {
  await act(async () => void $(id)!.click());
  await settle();
};
const emit = <K extends keyof Topics>(topic: K, value: Topics[K]) => act(async () => void bus.emit(topic, value));
// the Practice panel and the Feedback panel next to it (the feedback card moved out of Practice into its own panel)
const mount = () =>
  act(async () =>
    root.render(
      <>
        <Practice />
        <FeedbackPanel />
      </>,
    ),
  );
async function until(check: () => unknown, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** The bus remembers the latest value of every topic: put them all back to "nothing yet" for each test. */
const forget = <K extends keyof Topics>(topic: K) => bus.emit(topic, undefined as unknown as Topics[K]);

const commands: Array<Pick<CommandEvent, 'command' | 'source' | 'how' | 'value'>> = [];
const practiceControls: string[] = [];
let unwatch: Array<() => void> = [];

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const coachRequest = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as { feedback: Feedback; level: string } };
};

const micOn = () => reportStatus('audio-live', 'running', 'Listening');
const micOff = () => reportStatus('audio-live', 'idle', 'Microphone is off');

beforeEach(async () => {
  micOff();
  commands.length = 0;
  practiceControls.length = 0;
  resetControls();
  bus.emit('practice', { state: 'idle' });
  forget('feedback');
  forget('analysis');
  bus.emit('transport', transport({ loaded: false, durationSec: 0 }));
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
  unwatch = [
    bus.on('command', ({ command, source, how, value }) => commands.push({ command, source, how, value })),
    bus.on('practiceControl', (c) => practiceControls.push(c.action)),
  ];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await mount();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  unwatch.forEach((u) => u());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('steps and buttons', () => {
  it('lists the steps in plain words (headphones included) and has the three buttons', () => {
    const steps = [...container.querySelectorAll('ol li')].map((li) => li.textContent);
    expect(steps).toEqual([
      'Turn on the microphone',
      "Use headphones so the microphone doesn't hear the song",
      'Clap along to calibrate the delay',
      'Play along with the song',
    ]);
    expect(text('btn-calibrate')).toBe('Calibrate: clap along');
    expect(text('btn-practice-start')).toBe('Start practice');
    expect(text('btn-practice-stop')).toBe('Stop');
  });

  it('calibrate and stop send their action, and nothing else', async () => {
    await click('btn-calibrate');
    await click('btn-practice-stop');
    expect(practiceControls).toEqual(['calibrate', 'stop']);
    expect(commands).toEqual([]);
  });

  it('start practice starts the song when it is paused', async () => {
    await emit('transport', transport({ playing: false }));
    micOn();
    await click('btn-practice-start');
    expect(practiceControls).toEqual(['start']);
    expect(commands).toEqual([{ command: 'playback.play', source: 'button', how: 'trigger', value: undefined }]);
    expect($('practice-notice')).toBeNull();
  });

  it('start practice leaves a song that is already playing alone', async () => {
    await emit('transport', transport({ playing: true }));
    micOn();
    await click('btn-practice-start');
    expect(practiceControls).toEqual(['start']);
    expect(commands).toEqual([]);
  });

  it('start practice with no song says so in friendly words and does not start', async () => {
    await click('btn-practice-start');
    expect(practiceControls).toEqual([]);
    expect(commands).toEqual([]);
    expect(text('practice-notice')).toMatch(/Pick a song first/);
    // loading a song clears the reminder
    await emit('analysis', song);
    expect($('practice-notice')).toBeNull();
  });

  it('start practice works once the song is analysed even before playback reports in', async () => {
    await emit('analysis', song);
    micOn();
    await click('btn-practice-start');
    expect(practiceControls).toEqual(['start']);
    expect(commands.map((c) => c.command)).toEqual(['playback.play']);
  });

  it('start practice with the microphone off turns it on first, then starts (instead of an error)', async () => {
    await emit('transport', transport({ playing: false }));
    micOff();
    const enables: unknown[] = [];
    const off = bus.on('enable', (e) => enables.push(e));
    await click('btn-practice-start');
    expect(enables).toEqual([{ module: 'audio-live', on: true }]);
    expect(practiceControls).toEqual([]);
    expect(text('practice-notice')).toMatch(/Turning on the microphone/);
    await act(async () => reportStatus('audio-live', 'running', 'Listening'));
    await settle();
    expect(practiceControls).toEqual(['start']);
    expect(commands.map((c) => c.command)).toEqual(['playback.play']);
    off();
  });
});

describe('status and delay', () => {
  it('shows a plain sentence until the listening part says something, then follows its messages', async () => {
    expect(text('practice-status')).toBe('Ready when you are.');
    expect($('practice-latency')).toBeNull();
    await emit('practice', { state: 'calibrating', message: 'Clap along with the clicks.' });
    expect(text('practice-status')).toBe('Clap along with the clicks.');
    expect($('practice-status')!.getAttribute('data-state')).toBe('calibrating');
    await emit('practice', { state: 'listening', message: 'Delay measured. Play along now.', latencyOffsetMs: 84.4 });
    expect(text('practice-status')).toBe('Delay measured. Play along now.');
    expect(text('practice-latency')).toBe('Delay measured: 84 ms');
    // a later message without the number keeps the delay on screen
    await emit('practice', { state: 'done', message: 'Nice, that is the end.' });
    expect(text('practice-status')).toBe('Nice, that is the end.');
    expect(text('practice-latency')).toBe('Delay measured: 84 ms');
    await emit('practice', { state: 'listening', message: 'Again', latencyOffsetMs: 120 });
    expect(text('practice-latency')).toBe('Delay measured: 120 ms');
  });

  it('uses a plain sentence when there is a state but no message, and shows problems as alerts', async () => {
    await emit('practice', { state: 'error' });
    expect(text('practice-status')).toMatch(/microphone/);
    expect($('practice-status')!.getAttribute('role')).toBe('alert');
  });

  it('is right straight away after the panel is closed and opened again', async () => {
    await act(async () => root.unmount());
    bus.emit('practice', { state: 'listening', message: 'Listening to you play.', latencyOffsetMs: 63 });
    root = createRoot(container);
    await mount();
    expect(text('practice-status')).toBe('Listening to you play.');
    expect(text('practice-latency')).toBe('Delay measured: 63 ms');
  });
});

describe('feedback card', () => {
  it('is not there before any feedback', () => {
    expect($('feedback-card')).toBeNull();
  });

  it('appears at once from the rules feedback, with the tips still being written', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    await emit('feedback', fresh());
    expect($('feedback-card')).not.toBeNull();
    expect(text('feedback-summary')).toBe('You played about 10% slower than the song and held steady notes. One note was a little sharp.');
    expect(text('feedback-tempo')).toBe('You played about 90 BPM; the song is 100 BPM: a bit slow');
    expect([...$('feedback-strengths')!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Every note was in the right order', 'Clean attacks']);
    const issues = [...$('feedback-issues')!.querySelectorAll('li')].map((li) => li.textContent);
    expect(issues).toEqual(['Bars 1-2: You dragged in bars 1-2: try counting along with the metronome.', 'The 4th note was about 30 cents sharp.']);
    expect(text('feedback-next-step')).toBe('Play bars 1-2 at 80% speed, then bring it up to 100%.');
    expect(text('feedback-coaching-pending')).toBe('Writing friendly tips...');
    expect($('feedback-coaching')).toBeNull();
  });

  it('is there right away when the panel is opened again, and does not ask the server twice', async () => {
    const fetchMock = vi.fn(async () => answer({ ...fresh(), source: 'gemini', pending: false, coaching: 'You nailed the notes.' }));
    vi.stubGlobal('fetch', fetchMock);
    await emit('feedback', fresh());
    await until(() => $('feedback-coaching'), 'the coaching');
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect($('feedback-card')).not.toBeNull();
    expect(text('feedback-coaching')).toBe('You nailed the notes.');
    expect($('feedback-coaching-pending')).toBeNull();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks the server for coaching with the rules feedback and the level', async () => {
    const fetchMock = vi.fn(async () => answer({ ...fresh(), source: 'gemini', pending: false, coaching: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    const fb = fresh();
    await emit('feedback', fb);
    await until(() => fetchMock.mock.calls.length > 0, 'the request');
    const { url, init, body } = coachRequest(fetchMock);
    expect(url).toBe('/api/feedback/coach');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ feedback: fb, level: 'beginner' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('shows the Gemini coaching text with its label when the server answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ ...fresh(), source: 'gemini', pending: false, coaching: 'You nailed the notes. Try the first two bars at 80% speed.' })));
    await emit('feedback', fresh());
    await until(() => $('feedback-coaching'), 'the coaching');
    expect(text('feedback-coaching')).toBe('You nailed the notes. Try the first two bars at 80% speed.');
    expect(text('feedback-coaching-label')).toBe('Coach (Gemini)');
    expect($('feedback-coaching-pending')).toBeNull();
    // the facts did not move
    expect(text('feedback-tempo')).toBe('You played about 90 BPM; the song is 100 BPM: a bit slow');
  });

  it('labels the server\'s canned tips as built-in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ ...fresh(), source: 'canned', pending: false, coaching: 'Good effort. Keep a steady beat and try again at a slower tempo.' })));
    await emit('feedback', fresh());
    await until(() => $('feedback-coaching'), 'the coaching');
    expect(text('feedback-coaching')).toBe('Good effort. Keep a steady beat and try again at a slower tempo.');
    expect(text('feedback-coaching-label')).toBe('Coach (built-in tips)');
  });

  it.each([
    ['cannot be reached', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['answers with an error', async () => answer({ detail: 'Traceback (most recent call last)' }, 500)],
    ['answers with something that is not JSON', async () => new Response('<!doctype html><title>x</title>', { status: 200 })],
  ])('shows the built-in tips, never an error, when the server %s', async (_name, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl));
    const fb = fresh();
    await emit('feedback', fb);
    await until(() => $('feedback-coaching'), 'the built-in tips');
    expect(text('feedback-coaching')).toBe(builtInCoaching(fb));
    expect(text('feedback-coaching')).toMatch(/slow/);
    expect(text('feedback-coaching-label')).toBe('Coach (built-in tips)');
    expect($('feedback-coaching-pending')).toBeNull();
    expect(container.textContent).not.toMatch(/Traceback|Failed to fetch|doctype|error/i);
  });

  it('shows the built-in tips after 10 seconds without an answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal;
        return new Promise<Response>(() => {}); // never answers and ignores the abort signal
      }),
    );
    const fb = fresh();
    await emit('feedback', fb);
    expect(text('feedback-coaching-pending')).toBe('Writing friendly tips...');
    await act(async () => void (await vi.advanceTimersByTimeAsync(9_000)));
    expect(text('feedback-coaching-pending')).toBe('Writing friendly tips...');
    await act(async () => void (await vi.advanceTimersByTimeAsync(1_500)));
    expect(text('feedback-coaching')).toBe(builtInCoaching(fb));
    expect(text('feedback-coaching-label')).toBe('Coach (built-in tips)');
    expect($('feedback-coaching-pending')).toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('ignores a slow answer for old feedback once newer feedback has arrived', async () => {
    let finishFirst!: (r: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => (finishFirst = r)))
      .mockImplementationOnce(async () => answer({ ...fresh(), source: 'gemini', pending: false, coaching: 'Second run.' }));
    vi.stubGlobal('fetch', fetchMock);
    await emit('feedback', fresh());
    await emit('feedback', { ...fresh(), summary: 'Second run summary.' });
    await until(() => $('feedback-coaching'), 'the second coaching');
    await act(async () => finishFirst(answer({ ...fresh(), source: 'gemini', pending: false, coaching: 'First run.' })));
    await settle();
    expect(text('feedback-summary')).toBe('Second run summary.');
    expect(text('feedback-coaching')).toBe('Second run.');
  });

  it('leaves out the parts the feedback does not have', async () => {
    await emit('feedback', { version: 1, song_id: 'demo-twinkle', source: 'rules', summary: 'You played the whole song.' });
    expect(text('feedback-summary')).toBe('You played the whole song.');
    for (const id of ['feedback-tempo', 'feedback-strengths', 'feedback-issues', 'feedback-next-step', 'btn-loop-bar']) expect($(id), id).toBeNull();
  });
});

describe('loop this bar', () => {
  it('sends the loop, speed and play commands for the first issue with bars (Twinkle: bars 1-2 are 0 to 4.8 s)', async () => {
    await emit('analysis', song);
    await emit('feedback', fresh());
    expect(text('btn-loop-bar')).toBe('Loop bars 1-2 at 80% speed');
    await click('btn-loop-bar');
    expect(commands).toEqual([
      { command: 'playback.loop_section', source: 'button', how: 'set', value: [0, 4.8] },
      { command: 'playback.loop', source: 'button', how: 'set', value: true },
      { command: 'playback.tempo', source: 'button', how: 'set', value: 0.8 },
      { command: 'playback.play', source: 'button', how: 'trigger', value: undefined },
    ]);
    const controls = bus.last('controls') as Record<string, unknown>;
    expect(controls['playback.loop_section']).toEqual([0, 4.8]);
    expect(controls['playback.loop']).toBe(true);
    expect(controls['playback.tempo']).toBe(0.8);
  });

  it('works out other bars from the downbeats, and names a single bar', async () => {
    await emit('analysis', song);
    const fb = fresh();
    fb.issues = [{ kind: 'pitch', message: 'sharp' }, { kind: 'rhythm', bars: [5, 5], message: 'rushed' }];
    await emit('feedback', fb);
    expect(text('btn-loop-bar')).toBe('Loop bar 5 at 80% speed');
    await click('btn-loop-bar');
    expect(commands[0]).toMatchObject({ command: 'playback.loop_section', value: [9.6, 12] });

    commands.length = 0;
    const later = fresh();
    later.issues = [{ kind: 'tempo', bars: [11, 12], message: 'slow' }];
    await emit('feedback', later);
    expect(text('btn-loop-bar')).toBe('Loop bars 11-12 at 80% speed');
    await click('btn-loop-bar');
    expect(commands[0]).toMatchObject({ command: 'playback.loop_section', value: [24, 28.8] });
  });

  it('has no loop button when no issue points at bars', async () => {
    await emit('analysis', song);
    const fb = fresh();
    fb.issues = [{ kind: 'pitch', message: 'sharp' }];
    await emit('feedback', fb);
    expect($('btn-loop-bar')).toBeNull();
  });

  it('is switched off, with a reason, when the bars cannot be placed in a song', async () => {
    const fb = fresh();
    fb.issues = [{ kind: 'tempo', bars: [3, 4], message: 'slow' }];
    await emit('feedback', fb);
    expect(($('btn-loop-bar') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toMatch(/Load the song to use this/);
    await click('btn-loop-bar');
    expect(commands).toEqual([]);
    await emit('analysis', song);
    expect(($('btn-loop-bar') as HTMLButtonElement).disabled).toBe(false);
  });
});
