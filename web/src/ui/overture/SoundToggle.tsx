// Turns the interface sounds (ticks, needle drop, swell, bloom tone) on or off. Never touches the song itself.
import { useEffect, useState } from 'react';
import { onSoundsMuted, setSoundsMuted, soundsMuted } from './sounds';

export function SoundToggle() {
  const [muted, setMuted] = useState(soundsMuted);
  useEffect(() => onSoundsMuted(setMuted), []);
  return (
    <button type="button" className="pill sound-toggle" aria-pressed={!muted} title="Interface sounds (the music is not affected)" onClick={() => setSoundsMuted(!muted)}>
      <span aria-hidden="true" className="sound-icon" data-on={!muted} />
      Sounds {muted ? 'off' : 'on'}
    </button>
  );
}
