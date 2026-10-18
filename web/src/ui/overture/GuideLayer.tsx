// The guide drawing over the background: the hand as dots (a dot on every joint, small dots along each bone) and
// the head as its outline with an eye line, in the mode's main ink. It only SHOWS what the vision module sees
// (bus "landmarks"); it never runs its own tracker and it controls nothing. Redrawn at most once per frame, only
// when new points arrive (about 15 a second). Never clickable.
import { useEffect, useRef } from 'react';
import { bus, type Landmarks } from '@/bus';
import { boneDots, eyeLine, hull, toScreen, type Pt } from './guide';
import { GUIDES, modeLook, type ModeId, type Screen } from './modes';

const MAX_DPR = 1.5;

export function GuideLayer({ screen, mode }: { screen: Screen; mode: ModeId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const want = screen === 'menu' ? GUIDES.menu : screen === 'mode' ? GUIDES[mode] : [];
  const wantKey = want.join(',');
  const ink = modeLook(mode).a;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const parts = wantKey ? wantKey.split(',') : [];
    let raf = 0;
    let latest: Landmarks | null = null;
    let lastAt = 0;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);

    const draw = () => {
      raf = 0;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const lm = latest;
      if (!lm || !parts.length || performance.now() - lastAt > 600) return;
      const aspect = lm.width > 0 && lm.height > 0 ? lm.width / lm.height : 16 / 9;
      // the landmarks come mirrored (selfie view) but the background shows the camera the true way round: flip back
      const map = (p: { x: number; y: number }): Pt => toScreen(1 - p.x, p.y, aspect, w, h);
      ctx.fillStyle = ink;
      ctx.strokeStyle = ink;
      const dot = (p: Pt, r: number) => {
        ctx.moveTo(p[0] + r, p[1]);
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      };
      if (parts.includes('hand')) {
        ctx.beginPath();
        for (const hand of lm.hands) {
          const pts = hand.points.map(map);
          for (const p of boneDots(pts)) dot(p, 1.05);
          for (const p of pts) dot(p, 3.6);
        }
        ctx.fill();
      }
      const face = lm.face?.points;
      if (parts.includes('head') && face && face.length > 263) {
        const pts = face.map(map);
        const outline = hull(pts);
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        outline.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        const line = eyeLine(pts[33], pts[263], outline);
        if (line) {
          ctx.moveTo(line[0][0], line[0][1]);
          ctx.lineTo(line[1][0], line[1][1]);
        }
        ctx.stroke();
      }
    };
    const schedule = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const offLm = bus.on('landmarks', (lm) => {
      latest = lm;
      lastAt = performance.now();
      schedule();
    });
    // clear the drawing when the points stop coming (camera off, hand gone)
    const timer = window.setInterval(() => latest && performance.now() - lastAt > 600 && ((latest = null), schedule()), 700);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      offLm();
      window.clearInterval(timer);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [wantKey, ink]);

  // the unit tests' pretend browser has no canvas drawing
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return null;
  return <canvas ref={ref} className="guide-layer" aria-hidden="true" />;
}
