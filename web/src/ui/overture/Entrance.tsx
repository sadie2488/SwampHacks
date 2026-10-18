// Screen 1, the entrance: the Overture logo, one button in, and the chrysanthemum spray that blooms near it.
// "Enter with camera + sound" turns on the camera and the microphone (the click is the person's permission);
// "Enter with sound only" never asks for the camera: the pointer then stands in for the hand.
// Either way the record menu comes next, and nothing is blocked if a permission is refused.
import { useEffect, useRef } from 'react';
import { FlowerSpray } from './FlowerSpray';
import { unlockSounds } from './sounds';

export function Entrance({ onEnter }: { onEnter: (camera: boolean) => void }) {
  const enterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    enterRef.current?.focus({ preventScroll: true });
    // any click or key press lets the interface sounds play (browsers' autoplay rule)
    const unlock = () => unlockSounds();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return (
    <section className="entrance" aria-label="Welcome to Overture" data-testid="overture-entrance">
      <FlowerSpray target={enterRef} />
      <p className="entrance-plate">
        Fig. 01
        <i>Chrysanthemum</i>
      </p>
      <div className="entrance-gate">
        <p className="entrance-logo">Overture</p>
        <button ref={enterRef} type="button" className="pill entrance-enter" data-testid="entrance-enter-camera" onClick={() => onEnter(true)}>
          Enter with camera + sound
        </button>
        <button type="button" className="entrance-quiet" data-testid="entrance-enter-sound" onClick={() => onEnter(false)}>
          Enter with sound only
        </button>
      </div>
    </section>
  );
}
