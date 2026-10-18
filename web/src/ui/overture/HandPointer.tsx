// The hand cursor: a small ring in the mode's ink that follows the raised hand (bus "landmarks", already mirrored like
// the background). On the entrance, the menu, or while a panel or overlay is open, the hand works like a mouse:
// open hand, then close it into a fist over a button and hold still for HOLD_MS to click (a ring fills); hold a fist and
// move to scroll. Inside a mode with nothing open the cursor only shows, because fists are music commands there.
// One animation loop while the hand is seen; target boxes are cached and refreshed on resize and every half second.
import { useEffect, useRef } from 'react';
import { bus, type Landmarks } from '@/bus';
import '@/modules/commands'; // the handPointer topic type
import { toScreen } from './guide';
import { CLICKABLE, createHoldMachine, hitBox, nearest, pickHand, smoothPoint, type Box, type Point, type Side } from './hand-pointer';
import { modeLook, type ModeId, type Screen } from './modes';
import './hand-pointer.css';

const STALE_MS = 600;
const RING_R = 20;
const RING_LEN = 2 * Math.PI * RING_R;
const OPEN_PANELS = '[data-testid^="toggle-"][aria-pressed="true"], [data-testid="btn-instructions"][aria-pressed="true"], [data-testid="btn-hands-overlay"][aria-pressed="true"]';

const usable = (el: Element) => !el.closest('[inert]') && !(el as HTMLButtonElement).disabled;

function click(el: Element) {
  if (el instanceof HTMLInputElement && el.type === 'range') return;
  if (el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !['button', 'submit', 'checkbox', 'radio', 'file'].includes(el.type)) || el instanceof HTMLTextAreaElement) {
    el.focus();
    return;
  }
  (el as HTMLElement).click();
}

function scrollable(el: Element | null): Element {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth)) return e;
  }
  return el ?? document.body;
}

export function HandPointer({ screen, mode }: { screen: Screen; mode: ModeId }) {
  const root = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  const ink = modeLook(mode).a;
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let latest: Landmarks | null = null;
    let lastAt = 0;
    let raf = 0;
    let pos: Point | null = null;
    let hover: Element | null = null;
    let active = false;
    let targets: Array<{ item: Element; box: Box }> = [];
    const sides: Record<Side, { fist: boolean; open: boolean }> = { left: { fist: false, open: false }, right: { fist: false, open: false } };
    const machine = createHoldMachine<Element>();

    const setActive = (on: boolean) => {
      if (on === active) return;
      active = on;
      bus.emit('handPointer', { active: on });
    };
    const refresh = () => {
      setActive(screenRef.current !== 'mode' || !!document.querySelector(OPEN_PANELS));
      targets = [];
      for (const t of document.querySelectorAll(CLICKABLE)) {
        if (!usable(t)) continue;
        const r = t.getBoundingClientRect();
        if (r.width && r.height) targets.push({ item: t, box: hitBox(r) });
      }
    };
    const setHover = (t: Element | null) => {
      if (t === hover) return;
      hover?.classList.remove('hand-hover');
      hover = t;
      if (t) {
        (t as HTMLElement).style.setProperty('--hand-ink', ink);
        t.classList.add('hand-hover');
      }
    };
    const hide = () => {
      el.style.opacity = '0';
      setHover(null);
      machine.reset();
      pos = null;
      if (arc.current) arc.current.style.strokeDashoffset = String(RING_LEN);
    };
    const findTarget = (p: Point): Element | null => {
      const under = document.elementFromPoint(p.x, p.y)?.closest(CLICKABLE);
      if (under && usable(under)) return under;
      return nearest(p, targets);
    };

    const frame = () => {
      raf = 0;
      const lm = latest;
      const hand = pickHand(lm);
      if (!lm || !hand || performance.now() - lastAt > STALE_MS) return hide();
      const aspect = lm.width > 0 && lm.height > 0 ? lm.width / lm.height : 16 / 9;
      const [sx, sy] = toScreen(hand.x, hand.y, aspect, window.innerWidth, window.innerHeight);
      pos = smoothPoint(pos, { x: sx, y: sy });
      const target = findTarget(pos);
      setHover(target);
      const s = sides[hand.side];
      const out = machine.update({ t: performance.now(), x: pos.x, y: pos.y, fist: s.fist, open: s.open, target, enabled: active });
      if (out.click) {
        click(out.click);
        window.setTimeout(refresh, 50);
      }
      if (out.wheel) {
        const under = scrollable(document.elementFromPoint(pos.x, pos.y));
        under.dispatchEvent(new WheelEvent('wheel', { deltaX: out.wheel.dx, deltaY: out.wheel.dy, clientX: pos.x, clientY: pos.y, bubbles: true, cancelable: true }));
        if (under !== document.body) under.scrollBy(out.wheel.dx, out.wheel.dy);
      }
      if (arc.current) arc.current.style.strokeDashoffset = String(RING_LEN * (1 - out.progress));
      el.style.opacity = '1';
      el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      el.dataset.fist = s.fist && active ? 'true' : 'false';
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const offs = [
      bus.on('landmarks', (lm) => {
        latest = lm;
        lastAt = performance.now();
        kick();
      }),
      bus.on('signal', (sig) => {
        const m = /^vision\.hand\.(left|right)\.(fist|open_palm)$/.exec(sig.id);
        if (!m || sig.kind !== 'moment') return;
        sides[m[1] as Side][m[2] === 'fist' ? 'fist' : 'open'] = sig.state !== 'end';
      }),
    ];
    refresh();
    const timer = window.setInterval(refresh, 500);
    window.addEventListener('resize', refresh);
    hide();
    return () => {
      offs.forEach((off) => off());
      window.clearInterval(timer);
      window.removeEventListener('resize', refresh);
      if (raf) cancelAnimationFrame(raf);
      setHover(null);
      if (active) bus.emit('handPointer', { active: false });
    };
  }, [ink]);

  return (
    <div ref={root} className="hand-pointer" aria-hidden="true" style={{ color: ink }} data-testid="hand-pointer">
      <svg width="56" height="56" viewBox="-28 -28 56 56">
        <circle className="hand-pointer-dot" r="9" />
        <circle ref={arc} className="hand-pointer-fill" r={RING_R} strokeDasharray={RING_LEN} strokeDashoffset={RING_LEN} transform="rotate(-90)" />
      </svg>
    </div>
  );
}
