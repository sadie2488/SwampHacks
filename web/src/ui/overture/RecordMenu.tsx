// Screen 2, the record menu: the four modes are four records on a rising diagonal. Scroll, drag, the arrow keys or
// the mode pills move between them (a soft tick per step); clicking the chosen record (or Enter) opens that mode.
// Moving only changes CSS transforms; while the menu sits still only the chosen record's vinyl turns.
// The app.enter command (Lalitha's grab: open hand, then close it) pulses the chosen record once and opens it like a click.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { bus } from '@/bus';
import { BigWords } from './BigWords';
import { recordPlace } from './carousel';
import { MenuFrame } from './MenuFrame';
import { MODES } from './modes';
import { Record } from './Record';
import { tick } from './sounds';
import { useViewport } from './useViewport';

/** How long the chosen record pulses after a grab before it opens. */
const GRAB_PULSE_MS = 260;

export interface RecordMenuProps {
  sel: number;
  onSelect: (index: number) => void;
  onChoose: (index: number) => void;
}

export function RecordMenu({ sel, onSelect, onChoose }: RecordMenuProps) {
  const { w, h } = useViewport();
  const latest = useRef({ sel, onSelect, onChoose });
  latest.current = { sel, onSelect, onChoose };
  const dragged = useRef(false);
  const [grabbed, setGrabbed] = useState(false);

  // app.enter only exists while the menu is on screen (this component is the menu), so other screens ignore it
  useEffect(() => {
    let timer: number | undefined;
    const stop = bus.on('command', (c) => {
      if (c.command !== 'app.enter' || timer !== undefined) return;
      setGrabbed(true);
      timer = window.setTimeout(() => latest.current.onChoose(latest.current.sel), GRAB_PULSE_MS);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let acc = 0;
    let lastStep = 0;
    let drag: { x: number; at: number } | null = null;
    const step = (dir: number) => {
      const { sel: s, onSelect: pick } = latest.current;
      const next = Math.max(0, Math.min(MODES.length - 1, s + dir));
      if (next === s) return;
      tick();
      pick(next);
    };
    const onWheel = (e: WheelEvent) => {
      acc += e.deltaY + e.deltaX;
      const now = performance.now();
      if (Math.abs(acc) < 40 || now - lastStep < 280) return;
      step(Math.sign(acc));
      acc = 0;
      lastStep = now;
    };
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1);
      else if (e.key === 'Enter' && (!el || el === document.body)) latest.current.onChoose(latest.current.sel);
      else return;
      e.preventDefault();
    };
    // the pointer stands in for the hand: drag sideways to turn the records
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, at: e.clientX };
      dragged.current = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.buttons === 0) return;
      const dx = e.clientX - drag.at;
      if (Math.abs(e.clientX - drag.x) > 8) dragged.current = true;
      if (Math.abs(dx) > 90) {
        step(dx < 0 ? 1 : -1);
        drag.at = e.clientX;
      }
    };
    const onUp = () => (drag = null);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const px = Math.round(recordPlace(0, w, h).size * 1.25 * Math.min(1.25, window.devicePixelRatio || 1));
  return (
    <section className="menu" aria-label="Choose a mode" data-testid="overture-menu">
      <BigWords index={sel} w={w} h={h} layer="back" />
      <div className="records">
        {MODES.map((mode, i) => {
          const p = recordPlace(i - sel, w, h);
          const style = {
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            zIndex: p.z,
            transform: `translate3d(${(p.x - p.size / 2).toFixed(1)}px, ${(p.y - p.size / 2).toFixed(1)}px, 0) scale(${p.scale.toFixed(3)}) rotateX(${p.tilt.toFixed(1)}deg) rotateZ(${p.turn}deg)`,
          } as CSSProperties;
          const click = () => {
            if (dragged.current) return;
            if (i === sel) onChoose(i);
            else {
              tick();
              onSelect(i);
            }
          };
          return (
            <button key={mode.id} type="button" className="record" style={style} data-testid={`record-${mode.id}`} data-hand-color={mode.a} data-chosen={i === sel} data-grabbed={grabbed && i === sel ? 'true' : undefined} aria-label={`${mode.name} mode`} aria-current={i === sel ? 'true' : undefined} onClick={click}>
              <span className="record-shadow" />
              <Record m={mode} index={i} px={px} />
            </button>
          );
        })}
      </div>
      <BigWords index={sel} w={w} h={h} layer="front" />
      <MenuFrame sub={MODES[sel].sub} modeId={MODES[sel].id} />
    </section>
  );
}
