// The hand cursor: a small ring in the mode's ink that follows the raised hand (bus "landmarks", already mirrored like
// the background). On the entrance, the menu, or while a panel or overlay is open, the hand works like a mouse:
// open hand, then close it into a fist over a button and hold still for HOLD_MS to click (a ring fills); hold a fist and
// move to scroll. Inside a mode with nothing open the cursor only shows, because fists are music commands there.
// One animation loop while the hand is seen; target boxes are cached and refreshed on resize and every half second.
// The cursor takes the colour of what it is over (data-hand-color, else a drawn border or background, else the screen's
// ink; paper white on the menu), read once per new target. Closing the fist grabs at once: the ring closes, the item
// lifts (hand-grabbed), and the colour stays put until the hand opens.
// On the record menu it is forgiving: a fist anywhere grabs the chosen record (unless right over another record or a
// button), records reach RECORD_MAGNET_PX further, the hold is MENU_HOLD_MS and only a clear sideways move drags.
import { useEffect, useRef } from 'react';
import { bus, type Landmarks } from '@/bus';
import '@/modules/commands'; // the handPointer topic type
import { toScreen } from './guide';
import { emitHandDrag } from './hand-drag';
import { CLICKABLE, createHandPicker, createHoldMachine, createInkLatch, createShapeTracker, handsOf, hitBox, MENU_FEEL, menuTarget, nearest, PAPER, pickHandColor, smoothPoint, type Box, type MenuItem, type Point, type Side } from './hand-pointer';
import { createPinchMachine, popRing } from './pinch';
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

/** The cursor's colour over a target, read once when the target changes (records carry data-hand-color). */
function colorOf(el: Element, fallback: string): string {
  const data = el.getAttribute('data-hand-color');
  if (data) return pickHandColor({ data }, fallback);
  const s = getComputedStyle(el);
  const drawn = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' && s.borderTopStyle !== 'hidden';
  return pickHandColor({ border: drawn ? s.borderTopColor : null, background: s.backgroundColor }, fallback);
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
    let menuItems: Array<MenuItem<Element>> = [];
    const sides: Record<Side, { fist: boolean; open: boolean }> = { left: { fist: false, open: false }, right: { fist: false, open: false } };
    const machine = createHoldMachine<Element>();
    const pincher = createPinchMachine<Element>();
    const picker = createHandPicker();
    const shapes = createShapeTracker();
    let dragging = false;
    const endDrag = () => {
      if (dragging) emitHandDrag({ phase: 'end', dx: 0 });
      dragging = false;
    };
    const latch = createInkLatch();
    let hoverInk: string | null = null;
    let shownInk = '';
    const baseInk = () => (screenRef.current === 'menu' ? PAPER : ink);
    let heldEl: Element | null = null;
    const paint = (grabbed: boolean, held: Element | null) => {
      const want = latch(grabbed, hoverInk ?? baseInk());
      if (want !== shownInk) el.style.setProperty('--hand-color', (shownInk = want));
      el.dataset.grabbed = grabbed ? 'true' : 'false';
      if (held === heldEl) return;
      heldEl?.classList.remove('hand-grabbed');
      heldEl = held;
      if (held) {
        (held as HTMLElement).style.setProperty('--hand-ink', want);
        held.classList.add('hand-grabbed');
      }
    };

    const setActive = (on: boolean) => {
      if (on === active) return;
      active = on;
      bus.emit('handPointer', { active: on });
    };
    const refresh = () => {
      setActive(screenRef.current !== 'mode' || !!document.querySelector(OPEN_PANELS));
      targets = [];
      menuItems = [];
      for (const t of document.querySelectorAll(CLICKABLE)) {
        if (!usable(t)) continue;
        const r = t.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        targets.push({ item: t, box: hitBox(r) });
        const record = t.classList.contains('record');
        menuItems.push({ item: t, box: record ? r : hitBox(r), record, chosen: record && t.getAttribute('data-chosen') === 'true' });
      }
    };
    const setHover = (t: Element | null) => {
      if (t === hover) return;
      hover?.classList.remove('hand-hover');
      hover = t;
      hoverInk = t ? colorOf(t, ink) : null;
      if (t && hoverInk) {
        (t as HTMLElement).style.setProperty('--hand-ink', hoverInk);
        t.classList.add('hand-hover');
      }
    };
    const hide = () => {
      el.style.opacity = '0';
      setHover(null);
      endDrag();
      machine.reset();
      picker.reset();
      paint(false, null);
      pos = null;
      if (arc.current) arc.current.style.strokeDashoffset = String(RING_LEN);
    };
    const findTarget = (p: Point): Element | null => {
      const under = document.elementFromPoint(p.x, p.y)?.closest(CLICKABLE);
      const ok = under && usable(under) ? under : null;
      if (screenRef.current === 'menu') return menuTarget(p, ok, menuItems);
      return ok ?? nearest(p, targets);
    };

    const frame = () => {
      raf = 0;
      const lm = latest;
      if (!lm || performance.now() - lastAt > STALE_MS) return hide();
      // the cursor follows the active hand (either side), and grabs with that same hand's fist
      const picked = picker.pick(handsOf(lm));
      if (!picked) return hide();
      const { hand, switched } = picked;
      if (switched) {
        endDrag();
        machine.reset(); // a grab never carries over to the other hand
      }
      const aspect = lm.width > 0 && lm.height > 0 ? lm.width / lm.height : 16 / 9;
      const [sx, sy] = toScreen(hand.x, hand.y, aspect, window.innerWidth, window.innerHeight);
      pos = smoothPoint(pos, { x: sx, y: sy });
      const target = findTarget(pos);
      setHover(target);
      const sig = sides[hand.side];
      const shape = shapes.update(hand.side, hand.points, aspect);
      const fist = shape.fist || sig.fist;
      const out = machine.update({ t: performance.now(), x: pos.x, y: pos.y, fist, open: !fist && (shape.open || sig.open), target, enabled: active, feel: screenRef.current === 'menu' ? MENU_FEEL : undefined });
      if (out.click) {
        click(out.click);
        window.setTimeout(refresh, 50);
      }
      // pinch (index tip on thumb tip) clicks at once what the cursor was over a frame ago; never during a fist or grab
      const pinch = pincher.update({ t: performance.now(), points: hand.points, aspect, fist, grabbed: machine.grabbed, target, enabled: active });
      if (pinch.click) {
        click(pinch.click);
        popRing(el);
        window.setTimeout(refresh, 50);
      }
      const nowDragging = machine.phase === 'dragging';
      if (nowDragging && !dragging) emitHandDrag({ phase: 'start', dx: 0 });
      else if (!nowDragging) endDrag();
      dragging = nowDragging;
      if (out.move?.dx) emitHandDrag({ phase: 'move', dx: out.move.dx });
      const overMenu = !!document.elementFromPoint(pos.x, pos.y)?.closest('[data-hand-drag]');
      if (out.wheel && !overMenu) {
        const under = scrollable(document.elementFromPoint(pos.x, pos.y));
        under.dispatchEvent(new WheelEvent('wheel', { deltaX: out.wheel.dx, deltaY: out.wheel.dy, clientX: pos.x, clientY: pos.y, bubbles: true, cancelable: true }));
        if (under !== document.body) under.scrollBy(out.wheel.dx, out.wheel.dy);
      }
      if (arc.current) arc.current.style.strokeDashoffset = String(RING_LEN * (1 - out.progress));
      el.style.opacity = '1';
      el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      paint(machine.grabbed, active ? machine.held : null);
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
      paint(false, null);
      if (active) bus.emit('handPointer', { active: false });
    };
  }, [ink]);

  return (
    <div ref={root} className="hand-pointer" aria-hidden="true" data-testid="hand-pointer">
      <svg width="56" height="56" viewBox="-28 -28 56 56">
        <g className="hand-pointer-ring">
          <circle className="hand-pointer-dot" r="9" />
          <circle ref={arc} className="hand-pointer-fill" r={RING_R} strokeDasharray={RING_LEN} strokeDashoffset={RING_LEN} transform="rotate(-90)" />
        </g>
      </svg>
    </div>
  );
}
