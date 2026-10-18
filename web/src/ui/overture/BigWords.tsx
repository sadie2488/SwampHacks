// The two giant serif lines wrapped round the chosen record (Grail-style): the first sits just above the record and
// tucks BEHIND it, the second runs IN FRONT across its lower part, each a small step off the record's centre,
// alternating sides record to record. On a change the old line leaves upward first (0.4 s), then the new line
// rises out of a hidden edge (0.7 s; the front line 50 ms after the back one). Whole lines move, never letters.
import { useEffect, useState, type CSSProperties } from 'react';
import { bigWordPlaces, bigWordSize } from './carousel';
import { MODES } from './modes';
import { prefersReducedMotion } from './screen';

const LEAVE_MS = 400;

export function BigWords({ index, w, h, layer }: { index: number; w: number; h: number; layer: 'back' | 'front' }) {
  const [shown, setShown] = useState(index);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (index === shown) {
      setLeaving(false);
      return;
    }
    if (prefersReducedMotion()) {
      setShown(index);
      return;
    }
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setShown(index);
      setLeaving(false);
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [index, shown]);

  const m = MODES[shown];
  const places = bigWordPlaces(shown, w, h);
  const text = (layer === 'back' ? m.big[0] : m.big[1]).toUpperCase();
  const at = layer === 'back' ? places.back : places.front;
  const size = bigWordSize(text, w);
  const style = {
    fontSize: size,
    transform: `translate3d(${(at.x - w / 2).toFixed(1)}px, ${(at.y - size * 0.5).toFixed(1)}px, 0)`,
    '--delay': layer === 'front' ? '50ms' : '0ms',
  } as CSSProperties;
  return (
    <div className={`big big-${layer}`} aria-hidden="true" style={style}>
      <span className="big-clip">
        <span className={`big-line${leaving ? ' leaving' : ''}`} key={m.id}>
          {text}
        </span>
      </span>
    </div>
  );
}
