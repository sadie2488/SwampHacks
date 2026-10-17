// Fake mode has no camera, but the camera preview should still show something. This draws a made-up picture on a small
// canvas and turns it into a video stream (canvas.captureStream), which is published as "cameraStream" like a real camera.
import type { Clock } from './fake';
import type { Pt } from './gestures';
import { TRACKING_FPS } from './protocol';

export const FAKE_PICTURE_TEXT = 'Made-up camera (fake mode)';
const WIDTH = 640;
const HEIGHT = 480;

export interface FakePicture {
  stream: MediaStream;
  /** Stops the drawing and the stream's tracks. */
  stop(): void;
}

export interface FakePictureDeps {
  clock: Clock;
  /** The right wrist in the mirrored view (what the overlay shows), or null if there is none yet. */
  handAt: () => Pt | null;
  /** Makes the canvas to draw on; null when this page has no way to (for example, no document). */
  makeCanvas: () => HTMLCanvasElement | null;
}

export const pageCanvas = (): HTMLCanvasElement | null => (typeof document === 'undefined' ? null : document.createElement('canvas'));

function draw(g: CanvasRenderingContext2D, hand: Pt | null): void {
  g.fillStyle = '#14161c';
  g.fillRect(0, 0, WIDTH, HEIGHT);

  // The preview is shown flipped like a mirror, so the words are drawn flipped too and read the right way round there.
  g.save();
  g.translate(WIDTH, 0);
  g.scale(-1, 1);
  g.fillStyle = '#c8ccd6';
  g.font = '24px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillText(FAKE_PICTURE_TEXT, WIDTH / 2, 24);
  g.restore();

  // This picture is the plain, unflipped one: the hand overlay is mirrored, so the circle's x is flipped to match it.
  const x = (1 - (hand?.x ?? 0.72)) * WIDTH;
  const y = (hand?.y ?? 0.5) * HEIGHT;
  g.fillStyle = '#4cc9a6';
  g.beginPath();
  g.arc(x, y, 28, 0, Math.PI * 2);
  g.fill();
}

/** Starts drawing. Returns null (and publishes nothing) when the browser cannot turn a canvas into a stream. */
export function startFakePicture({ clock, handAt, makeCanvas }: FakePictureDeps): FakePicture | null {
  const canvas = makeCanvas();
  if (!canvas || typeof canvas.captureStream !== 'function') return null;
  const g = canvas.getContext('2d');
  if (!g) return null;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const paint = (): void => draw(g, handAt());
  paint(); // so the very first frame of the stream already has something in it
  let stream: MediaStream;
  try {
    stream = canvas.captureStream(TRACKING_FPS);
  } catch (e) {
    console.warn('[vision] could not make a picture for fake mode', e);
    return null;
  }
  const stopTimer = clock.every(1000 / TRACKING_FPS, paint);
  return {
    stream,
    stop: () => {
      stopTimer();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
