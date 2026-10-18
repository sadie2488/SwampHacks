// The entrance's chrysanthemum spray. Far from the Enter button the blooms are closed balls; as the pointer comes
// near it, the outer petals open first (half), then the centres (open). Size never changes. Each bloom is a
// cross-fade between its three state pictures (only opacity animates); the pointer is read at most once per frame.
// On touch screens (no pointer to follow) the blooms open by themselves shortly after the page appears.
import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { FLOWERS, type FlowerName } from '@/ui/flowers';
import { bloomTone } from './sounds';
import { bloomStage, nearness, SPRAY, STEMS } from './spray';

/** The bloom whose centre becomes the first record's hole when you enter (the shared hand-over). */
const HEART = 4;

type Stage = 0 | 1 | 2;

/** One flower as its three state pictures stacked; data-stage picks which one shows (CSS fades between them). */
export function FlowerStack({ flower, stage, style, className = '', heart = false }: { flower: FlowerName; stage: Stage; style?: CSSProperties; className?: string; heart?: boolean }) {
  const f = FLOWERS[flower];
  return (
    <div className={`bloom ${className}`} style={style} data-stage={stage}>
      {heart && <span className="bloom-heart" />}
      <img className="bloom-state bloom-closed" src={f.closed} alt="" draggable={false} />
      <img className="bloom-state bloom-half" src={f.half} alt="" draggable={false} />
      <img className="bloom-state bloom-open" src={f.open} alt="" draggable={false} />
    </div>
  );
}

export function FlowerSpray({ target }: { target: RefObject<HTMLElement | null> }) {
  const [stages, setStages] = useState<Stage[]>(() => SPRAY.map(() => 0));

  useEffect(() => {
    let raf = 0;
    let open = false;
    let px = -1e4;
    let py = -1e4;
    const update = (near: number) =>
      setStages((old) => {
        const next = SPRAY.map((_, i) => bloomStage(near, i, SPRAY.length));
        if (next.every((s, i) => s === old[i])) return old;
        // one soft tone the first time the blooms open fully (again only after they have closed)
        const openNow = next.some((s) => s === 2);
        if (openNow && !open) bloomTone();
        open = openNow || next.some((s) => s > 0);
        return next;
      });
    const measure = () => {
      raf = 0;
      const box = target.current?.getBoundingClientRect();
      if (!box) return;
      update(nearness(Math.hypot(px - (box.left + box.width / 2), py - (box.top + box.height / 2))));
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const hoverless = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;
    const timer = hoverless ? window.setTimeout(() => update(1), 900) : 0;
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [target]);

  return (
    <div className="spray" aria-hidden="true">
      <div className="spray-sway">
        <svg className="spray-stems" viewBox="-4 -4 8 8">
          <g transform="scale(1,-1)">
            {STEMS.map(([x1, y1, x2, y2], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
          </g>
        </svg>
        {SPRAY.map((f, i) => (
          <FlowerStack
            key={i}
            flower={f.flower}
            stage={stages[i]}
            heart={i === HEART}
            style={{ '--x': f.x, '--y': f.y, '--r': f.r, '--tilt': `${f.tilt}deg`, '--i': i } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
