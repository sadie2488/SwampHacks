// The Learn screen's own layer (mounted by ModeVisual's Learn branch, so it exists only while Learn is on screen):
// - "Show letters" pill: the same switch as the sheet's Beginner checkbox, and letters next to the gliding notes
// - "Restart": back to 0 s, keeping playing/paused as it was
// - pause by sign (learn.pause from mappings.yaml) with the big pause mark and the 3, 2, 1 countdown
// - drag to scrub while paused: a grabbing fist (the hand cursor) or the mouse on the sheet band moves the song;
//   the position is set on every frame, with no React re-render, so it feels instant
// - wrong practice notes drawn in muted red on the sheet (see Sheet.tsx for the overlay)
import { useEffect, useRef, useState } from 'react';
import { bus, sendCommand, type TransportState } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { seek } from '@/modules/playback';
import { learnView, setLetters } from '@/modules/sheet';
import { useBusValue } from '@/app/hooks';
import { HAND_DRAG_EVENT, type HandDragDetail } from './hand-drag';
import { createLearnPause, type PauseView } from './learn-pause';
import { isScrubSpot, scrubLabel, scrubPosition, secondsPerBar } from './learn-scrub';
import { noteName, placeNotes, staffGeometry, staffNotes } from './mode-visual';
import './learn-stage.css';

const FRAME_MS = 1000 / 30 - 2;
const SHEET_AREA = '.sheet-strip';
const SHEET_CONTROLS = 'button, select, input, label, a[href]';

export function LearnStage({ ink }: { ink: string }) {
  const view = useBusValue('learnView');
  const letters = view?.letters ?? learnView().letters;
  const [pause, setPause] = useState<PauseView>({ mark: false, count: null });
  const lettersRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  // pause by sign (only while this screen is mounted, so the menu's neutral "learn" mode never reaches it)
  useEffect(() => {
    const machine = createLearnPause({
      pause: () => sendCommand('playback.pause', 'button', { how: 'trigger' }),
      play: () => sendCommand('playback.play', 'button', { how: 'trigger' }),
      onChange: setPause,
    });
    const offs = [
      bus.on('transport', (t) => machine.transport(t), { replay: true }),
      bus.on('command', (c) => {
        if (c.command === 'learn.pause') machine.toggle();
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      machine.dispose();
    };
  }, []);

  // drag to scrub while paused: the hand cursor's drag events, and the mouse on the sheet band
  useEffect(() => {
    let transport: TransportState | undefined = bus.last('transport');
    let analysis: SongAnalysis | undefined = bus.last('analysis');
    let secPerBar = secondsPerBar(analysis);
    let scrub: { startSec: number; travel: number; x: number; y: number } | null = null;
    let raf = 0;
    const label = labelRef.current;
    const paused = () => !!transport?.loaded && !transport.playing;

    const apply = () => {
      raf = 0;
      if (!scrub) return;
      const sec = scrubPosition(scrub.startSec, scrub.travel, secPerBar, transport?.durationSec ?? 0);
      seek(sec);
      if (label) {
        label.textContent = scrubLabel(sec);
        label.style.transform = `translate3d(${scrub.x + 28}px, ${scrub.y - 36}px, 0)`;
      }
    };
    const begin = (x: number, y: number) => {
      if (!paused() || !transport) return false;
      const overSheet = !!document.elementFromPoint(x, y)?.closest(SHEET_AREA);
      if (!isScrubSpot(y, window.innerHeight, overSheet)) return false;
      scrub = { startSec: transport.positionSec, travel: 0, x, y };
      if (label) label.style.opacity = '1';
      document.documentElement.dataset.learnScrub = 'true';
      return true;
    };
    const move = (dx: number, x?: number, y?: number) => {
      if (!scrub) return;
      scrub.travel += dx;
      if (x !== undefined) scrub.x = x;
      if (y !== undefined) scrub.y = y;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const end = () => {
      if (!scrub) return;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      apply();
      scrub = null;
      if (label) label.style.opacity = '0';
      delete document.documentElement.dataset.learnScrub;
    };

    const onHand = (e: Event) => {
      const d = (e as CustomEvent<HandDragDetail>).detail;
      if (d.phase === 'start') {
        if (begin(d.x ?? window.innerWidth / 2, d.y ?? window.innerHeight)) e.preventDefault();
      } else if (d.phase === 'move') {
        if (scrub) {
          move(d.dx, d.x, d.y);
          e.preventDefault();
        }
      } else end();
    };
    let pointerId: number | null = null;
    let lastX = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || pointerId !== null) return;
      const t = e.target as Element | null;
      if (!t?.closest(SHEET_AREA) || t.closest(SHEET_CONTROLS)) return;
      if (!begin(e.clientX, e.clientY)) return;
      pointerId = e.pointerId;
      lastX = e.clientX;
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      move(e.clientX - lastX, e.clientX, e.clientY);
      lastX = e.clientX;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      end();
    };
    const offs = [
      bus.on('transport', (t) => void (transport = t), { replay: true }),
      bus.on('analysis', (a) => ((analysis = a), (secPerBar = secondsPerBar(a))), { replay: true }),
    ];
    window.addEventListener(HAND_DRAG_EVENT, onHand);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      end();
      offs.forEach((off) => off());
      window.removeEventListener(HAND_DRAG_EVENT, onHand);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // the letters next to the gliding note heads (same places as ModeVisual's notes)
  useEffect(() => {
    const canvas = lettersRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let analysis: SongAnalysis | undefined = bus.last('analysis');
    let notes = staffNotes(analysis);
    let transport: TransportState | undefined;
    let transportAt = 0;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = 0;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!letters) return;
      const g = staffGeometry(w, h);
      const playing = !!transport?.playing;
      const pos = (transport?.positionSec ?? 0) + (playing ? ((now - transportAt) / 1000) * (transport?.tempo ?? 1) : 0);
      ctx.font = "600 12px 'Instrument Sans', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const placed = placeNotes(notes, pos, g, w);
      let i = 0;
      for (const n of notes) {
        if (n.onset_sec + n.duration_sec < pos - g.playheadX / g.pxPerSec - 1) continue;
        if (n.onset_sec > pos + (w - g.playheadX) / g.pxPerSec + 1) break;
        const p = placed[i++];
        if (!p) break;
        ctx.fillStyle = p.on ? ink : 'rgba(242, 238, 230, 0.9)';
        ctx.fillText(noteName(n.pitch).replace(/-?\d+$/, ''), p.x, p.y - 16);
      }
      if (playing) schedule();
    };
    const schedule = () => {
      if (raf || document.hidden) return;
      raf = requestAnimationFrame((now) => (now - last >= FRAME_MS ? ((last = now), draw(now)) : ((raf = 0), schedule())));
    };
    const offs = [
      bus.on('analysis', (a) => ((analysis = a), (notes = staffNotes(a)), schedule()), { replay: true }),
      bus.on('transport', (t) => ((transport = t), (transportAt = performance.now()), schedule()), { replay: true }),
    ];
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [letters, ink]);

  const restart = () => sendCommand('playback.seek', 'button', { how: 'set', value: 0 });

  return (
    <>
      <canvas ref={lettersRef} className="mode-visual learn-letters" aria-hidden="true" />
      <div className="learn-tools">
        <button type="button" className="pill" data-testid="learn-letters" aria-pressed={letters} onClick={() => setLetters(!letters)}>
          Show letters
        </button>
        <button type="button" className="pill" data-testid="btn-restart" title="Back to the start of the song" onClick={restart}>
          Restart
        </button>
      </div>
      {pause.mark && (
        <div className="learn-pause-mark" data-testid="learn-pause-mark" role="img" aria-label="Paused" style={{ color: ink }}>
          <span />
          <span />
        </div>
      )}
      {pause.count !== null && (
        <div className="learn-countdown" data-testid="learn-countdown" role="status" aria-live="polite" style={{ color: ink }}>
          {pause.count}
        </div>
      )}
      <div ref={labelRef} className="learn-scrub-time" data-testid="learn-scrub-time" aria-hidden="true" />
    </>
  );
}
