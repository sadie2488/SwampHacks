// @vitest-environment jsdom
// The "see yourself" preview, driven through the bus in a fake page (jsdom).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, type Landmarks } from '@/bus';
import { drawLandmarks, HAND_BONES } from './camera-overlay';
import { CameraPreview } from './CameraPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const emit = <T,>(fn: () => T) => act(async () => void fn());
const fakeStream = (id = 'cam') => ({ id, getTracks: () => [] }) as unknown as MediaStream;

/** Records every arc and move the page draws, so the tests can see where things land. */
const drawn = { arcs: [] as Array<[number, number]>, moves: [] as Array<[number, number]>, clears: 0 };
const fakeContext = {
  arc: (x: number, y: number) => void drawn.arcs.push([x, y]),
  moveTo: (x: number, y: number) => void drawn.moves.push([x, y]),
  clearRect: () => void drawn.clears++,
  beginPath() {},
  lineTo() {},
  stroke() {},
  fill() {},
};

const hand = (handedness: 'Left' | 'Right', x: (i: number) => number) => ({
  handedness,
  points: Array.from({ length: 21 }, (_, i) => ({ x: x(i), y: 0.5, z: 0 })),
});
const landmarks = (extra: Partial<Landmarks> = {}): Landmarks => ({ t_ms: 1, width: 640, height: 480, hands: [], ...extra });

beforeEach(async () => {
  drawn.arcs = [];
  drawn.moves = [];
  drawn.clears = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext as unknown as CanvasRenderingContext2D);
  // the bus remembers the latest value of every topic: start each test with the camera off and nothing tracked
  bus.emit('cameraStream', null);
  bus.emit('landmarks', landmarks());
  bus.emit('status', { module: 'vision', state: 'idle' });
  history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CameraPreview />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('CameraPreview', () => {
  it('shows nothing while the camera is off and there is no picture', () => {
    expect(container.innerHTML).toBe('');
  });

  it('appears when a camera stream is published and goes away when it becomes null', async () => {
    const stream = fakeStream();
    await emit(() => bus.emit('cameraStream', stream));
    expect($('camera-preview')).not.toBeNull();
    expect($('camera-preview-overlay')).not.toBeNull();
    const video = $('camera-preview-video') as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect((video as unknown as { srcObject: unknown }).srcObject).toBe(stream);
    expect($('camera-preview')?.textContent).toContain('You (mirrored). Dots show what the camera tracks.');

    await emit(() => bus.emit('cameraStream', null));
    expect($('camera-preview')).toBeNull();
    expect($('camera-preview-video')).toBeNull();
    expect($('camera-preview-overlay')).toBeNull();
  });

  it('lets go of the stream when it goes away, and attaches a replacement', async () => {
    const first = fakeStream('one');
    const second = fakeStream('two');
    await emit(() => bus.emit('cameraStream', first));
    const video = $('camera-preview-video') as unknown as { srcObject: unknown };
    await emit(() => bus.emit('cameraStream', second));
    expect(($('camera-preview-video') as unknown as { srcObject: unknown }).srcObject).toBe(second);
    await emit(() => bus.emit('cameraStream', null));
    expect(video.srcObject).toBeNull();
  });

  it('says it is waiting while the camera is on and no picture has arrived yet', async () => {
    await emit(() => bus.emit('status', { module: 'vision', state: 'starting', message: 'Asking for the camera...' }));
    expect($('camera-preview-waiting')?.textContent).toBe('Waiting for the camera...');
    expect($('camera-preview')).toBeNull();

    await emit(() => bus.emit('cameraStream', fakeStream()));
    expect($('camera-preview-waiting')).toBeNull();
    expect($('camera-preview')).not.toBeNull();
  });

  it('stops waiting when the camera could not start or is switched off', async () => {
    await emit(() => bus.emit('status', { module: 'vision', state: 'starting' }));
    expect($('camera-preview-waiting')).not.toBeNull();
    await emit(() => bus.emit('status', { module: 'vision', state: 'error', message: 'Camera permission was blocked.' }));
    expect($('camera-preview-waiting')).toBeNull();
    await emit(() => bus.emit('status', { module: 'vision', state: 'running' }));
    expect($('camera-preview-waiting')).not.toBeNull();
    await emit(() => bus.emit('status', { module: 'vision', state: 'idle' }));
    expect($('camera-preview-waiting')).toBeNull();
  });

  it('does not mistake another module for the camera', async () => {
    await emit(() => bus.emit('status', { module: 'audio-live', state: 'running' }));
    expect($('camera-preview-waiting')).toBeNull();
  });

  it('does not claim a camera picture in practice mode (?fake=1)', async () => {
    history.replaceState({}, '', '/?fake=1');
    await emit(() => bus.emit('status', { module: 'vision', state: 'running', message: 'Using made-up camera data' }));
    expect($('camera-preview-waiting')?.textContent).toMatch(/practice mode/i);
  });

  it('is still there after a remount while the stream is already live, and draws the latest tracking', async () => {
    const stream = fakeStream();
    await emit(() => bus.emit('cameraStream', stream));
    await emit(() => bus.emit('landmarks', landmarks({ hands: [hand('Left', () => 0.4)] })));
    await act(async () => root.unmount());
    expect(container.innerHTML).toBe('');

    drawn.arcs = [];
    root = createRoot(container);
    await act(async () => root.render(<CameraPreview />));
    expect($('camera-preview')).not.toBeNull();
    expect(($('camera-preview-video') as unknown as { srcObject: unknown }).srcObject).toBe(stream);
    expect(drawn.arcs).toHaveLength(21); // the hand from before the remount is drawn straight away
  });

  it('draws each tracking update on the overlay, and stops listening when the picture goes away', async () => {
    await emit(() => bus.emit('cameraStream', fakeStream()));
    drawn.arcs = [];
    await emit(() => bus.emit('landmarks', landmarks({ hands: [hand('Right', () => 0.2)], face: { points: [{ x: 0.5, y: 0.3, z: 0 }] } })));
    expect(drawn.arcs).toHaveLength(21 + 1);

    await emit(() => bus.emit('cameraStream', null));
    drawn.arcs = [];
    await emit(() => bus.emit('landmarks', landmarks({ hands: [hand('Right', () => 0.2)] })));
    expect(drawn.arcs).toHaveLength(0);
  });

  it('follows the shape of the camera image', async () => {
    await emit(() => bus.emit('cameraStream', fakeStream()));
    const frame = () => ($('camera-preview-video') as HTMLElement).parentElement as HTMLElement;
    const ratio = () => parseFloat(frame().style.aspectRatio);
    expect(ratio()).toBeCloseTo(4 / 3);
    await emit(() => bus.emit('landmarks', landmarks({ width: 1280, height: 720 })));
    expect(ratio()).toBeCloseTo(16 / 9);
  });
});

describe('drawLandmarks (the preview overlay)', () => {
  const makeCanvas = (width = 640, height = 480) => {
    const arcs: Array<[number, number]> = [];
    const ctx = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc: (x: number, y: number) => void arcs.push([x, y]) };
    return { canvas: { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement, arcs };
  };

  it('draws a point at x = 0.2 at 0.2 * width: the points arrive mirrored, so nothing is flipped again', () => {
    const { canvas, arcs } = makeCanvas();
    // the first point of a "Right" hand is at x = 0.2, the rest at 0.9
    drawLandmarks(canvas, landmarks({ hands: [hand('Right', (i) => (i === 0 ? 0.2 : 0.9))] }));
    expect(arcs).toHaveLength(21);
    expect(arcs[0][0]).toBeCloseTo(0.2 * 640); // 128, not 512 (1 - 0.2 flipped)
    expect(arcs[0][1]).toBeCloseTo(0.5 * 480);
    expect(arcs[1][0]).toBeCloseTo(0.9 * 640);
  });

  it('matches the drawing surface to the camera image first', () => {
    const { canvas, arcs } = makeCanvas(300, 150);
    drawLandmarks(canvas, landmarks({ width: 1000, height: 500, hands: [hand('Left', () => 0.2)] }));
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(500);
    expect(arcs[0][0]).toBeCloseTo(0.2 * 1000);
  });

  it('draws the 21 hand points, the bones between them, and small face dots', () => {
    const moves: number[] = [];
    const arcs: number[] = [];
    const ctx = { clearRect() {}, beginPath() {}, lineTo() {}, stroke() {}, fill() {}, moveTo: () => void moves.push(1), arc: () => void arcs.push(1) };
    const canvas = { width: 640, height: 480, getContext: () => ctx } as unknown as HTMLCanvasElement;
    drawLandmarks(canvas, landmarks({ hands: [hand('Left', (i) => i / 21), hand('Right', (i) => i / 21)], face: { points: [{ x: 0.5, y: 0.2, z: 0 }, { x: 0.5, y: 0.3, z: 0 }] } }));
    expect(HAND_BONES).toHaveLength(21);
    expect(moves).toHaveLength(2 * HAND_BONES.length);
    expect(arcs).toHaveLength(2 * 21 + 2);
  });

  it('uses one color per hand', () => {
    const colors: string[] = [];
    const ctx = {
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      arc() {},
      fill() {},
      set strokeStyle(c: string) {
        colors.push(c);
      },
      set fillStyle(c: string) {},
    };
    const canvas = { width: 640, height: 480, getContext: () => ctx } as unknown as HTMLCanvasElement;
    drawLandmarks(canvas, landmarks({ hands: [hand('Left', () => 0.3), hand('Right', () => 0.6)] }));
    expect(colors).toHaveLength(2);
    expect(colors[0]).not.toBe(colors[1]);
  });

  it('clears the canvas when given null, and does nothing without a canvas', () => {
    let cleared = 0;
    const ctx = { clearRect: () => void cleared++ };
    const canvas = { width: 640, height: 480, getContext: () => ctx } as unknown as HTMLCanvasElement;
    drawLandmarks(canvas, null);
    expect(cleared).toBe(1);
    expect(() => drawLandmarks(null, null)).not.toThrow();
  });
});
