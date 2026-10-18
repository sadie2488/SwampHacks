// A calm pill shown only while the browser keeps sound asleep: "Click anywhere to turn sound on". It never catches
// clicks itself (pointer-events: none), so it can never block a button; any click or key press anywhere wakes the sound.
import { useEffect, useState } from 'react';
import { watchSoundUnlock } from './sound-unlock';
import './sound-unlock.css';

export function SoundUnlock() {
  const [asleep, setAsleep] = useState(false);
  useEffect(() => watchSoundUnlock(setAsleep), []);
  if (!asleep) return null;
  return (
    <p className="sound-unlock" data-testid="sound-unlock" role="status">
      <i aria-hidden="true" />
      Click anywhere to turn sound on
    </p>
  );
}
