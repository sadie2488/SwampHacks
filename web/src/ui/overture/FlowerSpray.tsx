// The entrance's flowers: Lalitha's drawn chrysanthemum, orchid and hibiscus (SectionBloom tints them with their
// section's inks). Far from the Enter button they are closed; as the pointer comes near it, they open one after
// another (half, then open). Size never changes: each flower is a cross-fade between its three state pictures
// (only opacity animates); the pointer is read at most once per frame.
// On touch screens (no pointer to follow) the flowers open by themselves shortly after the page appears.
import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { SectionBloom } from '@/ui/flowers/SectionBloom';
import { bloomTone } from './sounds';
import { bloomStage, HEART, nearness, SPRAY } from './spray';

type Stage = 0 | 1 | 2;

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
        // one soft tone the first time the flowers open fully (again only after they have closed)
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
        {SPRAY.map((f, i) => (
          <div key={f.section} className="spray-flower" data-flower={f.section} style={{ '--x': f.x, '--y': f.y, '--r': f.r, '--i': i } as CSSProperties}>
            <SectionBloom section={f.section} stage={stages[i]} />
            {i === HEART && <span className="bloom-heart" />}
          </div>
        ))}
      </div>
    </div>
  );
}
