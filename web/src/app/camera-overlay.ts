// Draws the tracking (hands and face) over the camera picture in the app's "see yourself" preview.
//
// Mirror rule: the vision module publishes the landmarks ALREADY mirrored (x is flipped, and "Left" / "Right" are the
// user's own hands). So nothing here flips anything: a point at x = 0.2 is drawn at 0.2 * canvas width. Only the
// <video> is mirrored (with CSS), because the camera stream itself is the plain, unflipped picture.
import type { Landmarks } from '@/bus';

/** The standard 21-point hand skeleton: which points are joined by a bone. */
export const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** One color per hand ("Left" and "Right" are the user's own hands). */
export const HAND_COLORS = { Left: '#3aa0ff', Right: '#ff9f1a' } as const;
const FACE_COLOR = 'rgba(255, 255, 255, 0.75)';

/** Draw hand bones and dots and small face dots. Pass null to just clear the canvas. */
export function drawLandmarks(canvas: HTMLCanvasElement | null, lm: Landmarks | null): void {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  // Match the drawing surface to the camera image, so 0-1 points map straight to pixels.
  if (lm && lm.width > 0 && lm.height > 0 && (canvas.width !== lm.width || canvas.height !== lm.height)) {
    canvas.width = lm.width;
    canvas.height = lm.height;
  }
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;

  const dot = Math.max(3, w / 110);
  ctx.lineWidth = Math.max(2, w / 200);

  ctx.fillStyle = FACE_COLOR;
  for (const p of lm.face?.points ?? []) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, Math.max(1, w / 400), 0, Math.PI * 2);
    ctx.fill();
  }

  for (const hand of lm.hands) {
    const color = HAND_COLORS[hand.handedness];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    for (const [a, b] of HAND_BONES) {
      const p = hand.points[a];
      const q = hand.points[b];
      if (!p || !q) continue;
      ctx.beginPath();
      ctx.moveTo(p.x * w, p.y * h);
      ctx.lineTo(q.x * w, q.y * h);
      ctx.stroke();
    }
    for (const p of hand.points) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
