// @vitest-environment jsdom
// Tests for the Command Lab page: it is rendered in a fake browser (jsdom) and driven through the bus.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, resetControls, sendCommand, sendSignal, type Landmarks } from '@/bus';
import { controlCatalog, signalCatalog } from '@/contracts/catalogs';
import type { Signal } from '@/contracts';
import { CommandLab } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

// jsdom has no canvas, so give the page a fake one that just counts what is drawn
const calls = { arc: 0, moveTo: 0, clear: 0 };
const fakeContext = { arc: () => calls.arc++, moveTo: () => calls.moveTo++, clearRect: () => calls.clear++, beginPath() {}, lineTo() {}, stroke() {}, fill() {} };

beforeEach(() => {
  calls.arc = calls.moveTo = calls.clear = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext as unknown as CanvasRenderingContext2D);
  resetControls();
  bus.emit('issues', []);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<CommandLab />));
});
afterEach(() => {
  vi.restoreAllMocks();
  act(() => root.unmount());
  container.remove();
});

describe('Command Lab', () => {
  it('has a meter for every signal and a row for every control, with "no data yet" until something arrives', () => {
    for (const s of signalCatalog.signals) {
      expect(q(`meter-${s.id}`), s.id).toBeTruthy();
      expect(q(`meter-${s.id}`).textContent).toContain(s.description);
      expect(q(`meter-${s.id}`).textContent).toContain('no data yet');
    }
    for (const c of controlCatalog.controls) expect(q(`control-${c.id}`), c.id).toBeTruthy();
    expect(q('command-lab')).toBeTruthy();
  });

  it('a slider meter follows the signal', async () => {
    act(() => sendSignal({ id: 'vision.hand.right.height', kind: 'slider', value: 0.42, confidence: 0.9 }));
    await wait(80);
    expect(q('meter-vision.hand.right.height').dataset.value).toBe('0.42');
    expect(q('meter-vision.hand.right.height').dataset.state).toBe('live');
    expect(q('meter-vision.hand.right.height').textContent).toContain('0.42');
    expect(container.querySelector<HTMLMeterElement>('[data-testid="meter-vision.hand.right.height"] meter')!.value).toBe(0.42);
  });

  it('a held moment (a fist) stays lit until it ends', () => {
    const lamp = () => q('meter-vision.hand.left.fist').dataset.on;
    expect(lamp()).toBe('false');
    act(() => sendSignal({ id: 'vision.hand.left.fist', kind: 'moment', state: 'start' }));
    expect(lamp()).toBe('true');
    act(() => sendSignal({ id: 'vision.hand.left.fist', kind: 'moment', state: 'end' }));
    expect(lamp()).toBe('false');
    expect(q('meter-vision.hand.left.fist').textContent).toContain('happened 1 time');
  });

  it('a quick moment (a clap) lights up and then goes dark again', async () => {
    act(() => sendSignal({ id: 'audio.clap', kind: 'moment', state: 'start' }));
    expect(q('meter-audio.clap').dataset.on).toBe('true');
    await wait(520);
    expect(q('meter-audio.clap').dataset.on).toBe('false');
  });

  it('a control shows its value and flashes when a command arrives', async () => {
    expect(q('control-playback.tempo').textContent).toContain('1 x');
    act(() => sendCommand('playback.tempo', 'gesture', { how: 'follow', value: 0.8, mapping: 'hand height controls tempo' }));
    expect(q('control-playback.tempo').textContent).toContain('0.8 x');
    expect(q('control-playback.tempo').dataset.flash).toBe('true');
    expect(q('lab-log').textContent).toContain('playback.tempo');
    await wait(620);
    expect(q('control-playback.tempo').dataset.flash).toBe('false');
  });

  it('lists the loaded rules, greys out disabled ones, and lights a rule when it fires', async () => {
    expect(q('rule-0').textContent).toContain('hand height controls tempo');
    expect(q('rule-1').dataset.enabled).toBe('false');
    expect(q('rule-2').dataset.enabled).toBe('true');
    expect(q('rule-2').dataset.fired).toBe('false');
    act(() => {
      const command = { version: 1 as const, command: 'playback.toggle', source: 'gesture' as const, mapping: 'clap toggles play/pause', t_ms: 1 };
      bus.emit('fired', { mapping: 'clap toggles play/pause', command });
    });
    expect(q('rule-2').dataset.fired).toBe('true');
    expect(q('rule-0').dataset.fired).toBe('false');
    await wait(700);
    expect(q('rule-2').dataset.fired).toBe('false');
  });

  it('shows problems in plain words, and "Everything looks fine" when there are none', () => {
    expect(q('lab-issues').textContent).toContain('Everything looks fine');
    act(() => bus.emit('issues', [{ level: 'error', where: 'rule 3 (oops)', message: 'Did you mean "audio.clap"?' }, { level: 'warning', where: 'rules 1 and 2', message: 'They fight each other.' }]));
    expect(q('lab-issues').textContent).not.toContain('Everything looks fine');
    expect(q('lab-issues').textContent).toContain('rule 3 (oops)');
    expect(q('lab-issues').textContent).toContain('Did you mean "audio.clap"?');
    expect(q('lab-issues').querySelector('[data-level="warning"]')!.textContent).toContain('Heads up');
    act(() => bus.emit('issues', []));
    expect(q('lab-issues').textContent).toContain('Everything looks fine');
  });

  it('the camera button asks the vision module to turn on and off', () => {
    const enables: Array<{ module: string; on: boolean }> = [];
    const stop = bus.on('enable', (e) => enables.push(e));
    expect(q('lab-enable-camera').textContent).toBe('Turn camera on');
    act(() => q('lab-enable-camera').click());
    expect(q('lab-enable-camera').textContent).toBe('Turn camera off');
    act(() => q('lab-enable-camera').click());
    stop();
    expect(enables).toEqual([
      { module: 'vision', on: true },
      { module: 'vision', on: false },
    ]);
  });

  it('shows the vision module\'s message when the camera cannot start', () => {
    act(() => q('lab-enable-camera').click());
    act(() => bus.emit('status', { module: 'vision', state: 'error', message: 'The camera is blocked.' }));
    expect(container.textContent).toContain('The camera is blocked.');
    expect(q('lab-enable-camera').textContent).toBe('Turn camera on');
  });

  it('has a muted, inline video and an overlay canvas', () => {
    const video = q('lab-video') as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(q('lab-overlay').tagName).toBe('CANVAS');
  });

  it('draws hand and face points on the overlay', () => {
    calls.arc = calls.moveTo = calls.clear = 0;
    const point = (x: number, y: number) => ({ x, y, z: 0 });
    const landmarks: Landmarks = {
      t_ms: 1,
      width: 640,
      height: 480,
      hands: [{ handedness: 'Right', points: Array.from({ length: 21 }, (_, i) => point(i / 21, 0.5)) }],
      face: { points: [point(0.5, 0.2), point(0.5, 0.3)] },
    };
    act(() => bus.emit('landmarks', landmarks));
    expect(calls.clear).toBe(1);
    expect(calls.arc).toBe(21 + 2);
    expect(calls.moveTo).toBeGreaterThan(0);
    expect((q('lab-overlay') as HTMLCanvasElement).width).toBe(640);
  });

  describe('Test without a camera', () => {
    let seen: Signal[];
    let stop: () => void;
    beforeEach(() => {
      seen = [];
      stop = bus.on('signal', (s) => seen.push(s));
    });
    afterEach(() => stop());

    it('has a control for every signal: a button for each moment and a range input for each slider', () => {
      for (const s of signalCatalog.signals) {
        const el = q(`fake-${s.id}`);
        expect(el, s.id).toBeTruthy();
        if (s.kind === 'slider') expect((el as HTMLInputElement).type).toBe('range');
        else expect(el.tagName).toBe('BUTTON');
      }
    });

    it('a moment button sends a start, then an end after 300 ms', async () => {
      act(() => q('fake-audio.clap').click());
      expect(seen.map((s) => [s.id, s.state])).toEqual([['audio.clap', 'start']]);
      await wait(380);
      expect(seen.map((s) => [s.id, s.state])).toEqual([['audio.clap', 'start'], ['audio.clap', 'end']]);
    });

    it('a holdable moment button toggles between start and end', () => {
      act(() => q('fake-vision.hand.left.fist').click());
      expect(q('fake-vision.hand.left.fist').getAttribute('aria-pressed')).toBe('true');
      act(() => q('fake-vision.hand.left.fist').click());
      expect(seen.map((s) => s.state)).toEqual(['start', 'end']);
      expect(q('fake-vision.hand.left.fist').getAttribute('aria-pressed')).toBe('false');
    });

    it('a slider sends readings as you drag', () => {
      const input = q('fake-vision.hand.right.height') as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      for (const v of ['0.2', '0.7']) {
        act(() => {
          setValue.call(input, v);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }
      expect(seen.map((s) => [s.id, s.kind, s.value])).toEqual([
        ['vision.hand.right.height', 'slider', 0.2],
        ['vision.hand.right.height', 'slider', 0.7],
      ]);
    });
  });
});
