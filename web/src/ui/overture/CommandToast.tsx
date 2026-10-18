// Command toast: when a voice or hand rule fires, one short word ("Pause", "Faster", "Recording") shows above the
// middle of the screen in the mode's ink, so the presenter and the audience can see the app understood.
// It only listens to bus "fired"; it never takes clicks.
import { useEffect, useState } from 'react';
import { bus } from '@/bus';
import { createFollowGate, wordFor } from './commandWord';
import { MODES } from './modes';
import './command-toast.css';

const SHOW_MS = 1200; // 150 ms in, about 900 ms held, then the fade out
const CREAM = '#f4e4a1';

export function CommandToast() {
  const [toast, setToast] = useState<{ key: number; word: string; ink: string } | null>(null);

  useEffect(() => {
    const gate = createFollowGate();
    let key = 0;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const stop = bus.on('fired', ({ command }) => {
      // Wait one tick so the player and controls have taken the command (toggle words read the new state)
      setTimeout(() => {
        const word =
          command.how === 'follow'
            ? gate(command, performance.now())
            : wordFor(command, { playing: bus.last('transport')?.playing, after: bus.last('controls')?.[command.command] });
        if (!word) return;
        const modeId = command.command === 'app.mode' ? command.value : bus.last('mode');
        const ink = MODES.find((m) => m.id === modeId)?.a ?? CREAM;
        setToast({ key: ++key, word, ink });
        clearTimeout(hide);
        hide = setTimeout(() => setToast(null), SHOW_MS);
      }, 0);
    });
    return () => {
      stop();
      clearTimeout(hide);
    };
  }, []);

  return (
    <div className="command-toast" aria-live="polite" role="status">
      {toast && (
        <span key={toast.key} className="command-toast__word" data-testid="command-toast" style={{ color: toast.ink }}>
          {toast.word}
        </span>
      )}
    </div>
  );
}
