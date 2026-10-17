// The paper landscape behind the whole app. One fixed canvas, never clickable, behind everything.
// The CSS paper background underneath is always there, so if the 3D scene cannot run (no WebGL, ?scene=off,
// a computer without a graphics chip) the page simply keeps that, with no error.
import { useEffect, useRef, useState } from 'react';
import { sceneWanted } from './motion';
import './backdrop.css';

type SceneState = 'loading' | 'on' | 'off';

export function Backdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<SceneState>(() =>
    typeof window !== 'undefined' && sceneWanted(window.location.search, navigator.userAgent) ? 'loading' : 'off',
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    import('./controller')
      .then(({ startBackdrop }) => {
        if (cancelled) return;
        const backdrop = startBackdrop(canvas, () => setState('off'));
        if (!backdrop) return setState('off');
        stop = backdrop.stop;
        setState('on');
      })
      .catch(() => {
        if (!cancelled) setState('off');
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div className="backdrop" aria-hidden="true" data-testid="backdrop" data-scene={state}>
      {state !== 'off' && <canvas ref={canvasRef} className="backdrop-canvas" />}
    </div>
  );
}
