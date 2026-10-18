// The Overture background behind the whole app: one fixed canvas, never clickable, behind everything.
// The CSS background underneath (the section's dark tint with a faint print of dots) is always there, so if the
// WebGL scene cannot run (no WebGL, ?scene=off, a computer without a graphics chip) the page simply keeps it,
// with no error.
import { useEffect, useRef, useState } from 'react';
import { bigWordPlaces } from '@/ui/overture/carousel';
import type { ScreenName } from './looks';
import { sceneWanted } from './motion';
import './backdrop.css';

type SceneState = 'loading' | 'on' | 'off';
type Controller = import('./controller').Backdrop;

export function Backdrop({ screen = 'mode', mode = 'learn', menuIndex = 0 }: { screen?: ScreenName; mode?: string; menuIndex?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrl = useRef<Controller | null>(null);
  const latest = useRef({ screen, mode });
  latest.current = { screen, mode };
  const prevScreen = useRef(screen);
  const [state, setState] = useState<SceneState>(() =>
    typeof window !== 'undefined' && sceneWanted(window.location.search, navigator.userAgent) ? 'loading' : 'off',
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    import('./controller')
      .then(({ startBackdrop }) => {
        if (cancelled) return;
        const backdrop = startBackdrop(canvas, () => setState('off'));
        if (!backdrop) return setState('off');
        ctrl.current = backdrop;
        backdrop.setLook(latest.current.screen, latest.current.mode);
        setState('on');
      })
      .catch(() => {
        if (!cancelled) setState('off');
      });
    return () => {
      cancelled = true;
      ctrl.current?.stop();
      ctrl.current = null;
    };
  }, []);

  useEffect(() => {
    ctrl.current?.setLook(screen, mode);
    // a ripple runs through the picture from the chosen record as you go into a mode
    if (prevScreen.current === 'menu' && screen === 'mode') {
      const p = bigWordPlaces(menuIndex, window.innerWidth, window.innerHeight);
      ctrl.current?.ripple(p.centre.x, p.centre.y);
    }
    prevScreen.current = screen;
  }, [screen, mode, menuIndex]);

  return (
    <div className="backdrop" aria-hidden="true" data-testid="backdrop" data-scene={state}>
      {state !== 'off' && <canvas ref={canvasRef} className="backdrop-canvas" />}
    </div>
  );
}
