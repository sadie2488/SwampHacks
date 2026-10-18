// The 4-count before a Create take: one big serif number per beat ("4, 3, 2, 1") in the middle of the screen,
// so the person knows when to start humming. Shows nothing outside the count-in.
import { useCreateCountIn } from '@/modules/create/app-store';

const style: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  pointerEvents: 'none',
  font: "400 min(42vh, 260px) / 1 var(--serif, 'Instrument Serif', serif)",
  color: 'var(--paper-white, #f2eee6)',
  zIndex: 3,
};

export function CountIn() {
  const n = useCreateCountIn();
  if (n === null) return null;
  return (
    <div className="count-in" data-testid="count-in" style={style} aria-live="assertive">
      {n}
    </div>
  );
}
