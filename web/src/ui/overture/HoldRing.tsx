// The hold ring: while a "hold_ms" rule is filling up (for example holding the letter Y to go to Play), a ring in the
// middle of the screen fills in the target mode's ink, with the mode's name inside. Let go early and it disappears.
// It only SHOWS bus "holdProgress" (published by the commands module); it controls nothing and is never clickable.
// Progress arrives about 20 times a second and is written straight to the circle, so React does not re-render each time.
import { useEffect, useRef, useState } from 'react';
import { bus } from '@/bus';
import type { HoldProgress } from '@/modules/commands';
import { MODES } from './modes';

// Overture look: a thin ring (like a record's edge) in the mode's ink round the mode's name in the thin serif
const SIZE = 188;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const LENGTH = 2 * Math.PI * R;
const CREAM = '#f4e4a1';

/** What the ring says and which ink it uses: the mode for app.mode, otherwise the rule's own name. */
function lookFor(p: HoldProgress): { label: string; ink: string } {
  const mode = p.control === 'app.mode' ? MODES.find((m) => m.id === p.value) : undefined;
  return mode ? { label: mode.name, ink: mode.a } : { label: p.rule, ink: CREAM };
}

export function HoldRing() {
  const [target, setTarget] = useState<{ key: string; label: string; ink: string } | null>(null);
  const arc = useRef<SVGCircleElement>(null);
  const progress = useRef(0);

  useEffect(
    () =>
      bus.on('holdProgress', (p) => {
        progress.current = p.progress;
        if (arc.current) arc.current.style.strokeDashoffset = String(LENGTH * (1 - p.progress));
        const key = `${p.rule}|${String(p.value)}`;
        setTarget((t) => (p.progress <= 0 ? null : t?.key === key ? t : { key, ...lookFor(p) }));
      }),
    [],
  );

  if (!target) return null;
  return (
    <div
      data-testid="hold-ring"
      role="status"
      aria-label={`Keep holding to open ${target.label}`}
      style={{ position: 'fixed', left: '50%', top: '50%', width: SIZE, height: SIZE, margin: -SIZE / 2, zIndex: 60, pointerEvents: 'none' }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" style={{ display: 'block' }}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R + STROKE / 2} fill="rgba(11, 10, 12, 0.78)" />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={CREAM} strokeOpacity={0.22} strokeWidth={1} />
        <circle
          ref={arc}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={target.ink}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={LENGTH}
          strokeDashoffset={LENGTH * (1 - progress.current)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          padding: STROKE * 2,
          textAlign: 'center',
          // paper white: the Lab's cobalt is too dark for type this size on near-black
          color: '#f2eee6',
          font: "400 30px/0.9 'Instrument Serif', Georgia, serif",
          textTransform: 'uppercase',
          letterSpacing: '-0.01em',
        }}
      >
        {target.label}
      </span>
    </div>
  );
}
