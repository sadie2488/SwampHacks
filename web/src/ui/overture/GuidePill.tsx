// The small pill that says what the app is following ("Following your hand"), or what to show it ("Show your
// hand") when that part is out of view. Only shown while the camera is on. Updates only when the words change.
import { useEffect, useState } from 'react';
import { bus, isModuleOn } from '@/bus';
import { seenParts } from './guide';

const WORDS = { hand: 'your hand', head: 'your head' } as const;

export function GuidePill({ want }: { want: ReadonlyArray<'hand' | 'head'> }) {
  const [cameraOn, setCameraOn] = useState(() => isModuleOn('vision'));
  const [missing, setMissing] = useState<string>(want.join(','));
  const wantKey = want.join(',');

  useEffect(() => {
    const parts = wantKey ? (wantKey.split(',') as Array<'hand' | 'head'>) : [];
    let lastAt = 0;
    const update = (seen: Set<string>) => setMissing(parts.filter((p) => !seen.has(p)).join(','));
    const offS = bus.on('status', (s) => s.module === 'vision' && setCameraOn(isModuleOn('vision')));
    const offL = bus.on('landmarks', (lm) => {
      lastAt = performance.now();
      update(seenParts(lm));
    });
    const timer = window.setInterval(() => performance.now() - lastAt > 800 && update(new Set()), 800);
    return () => {
      offS();
      offL();
      window.clearInterval(timer);
    };
  }, [wantKey]);

  if (!want.length || !cameraOn) return null;
  const lost = missing.length > 0;
  const words = lost
    ? `Show ${missing.split(',').map((p) => WORDS[p as 'hand' | 'head']).join(' + ')}`
    : `Following ${want.map((p) => WORDS[p]).join(' + ')}`;
  return (
    <p className="guide-pill" data-lost={lost} aria-live="polite">
      <i aria-hidden="true" />
      {words}
    </p>
  );
}
