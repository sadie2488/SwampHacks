// The guide: a few large, calm lines over the current screen on how to use it with your voice and hands.
// See-through (the camera picture stays visible under it) and it lets clicks through; Esc or the header button closes it.
import { useEffect } from 'react';
import { GUIDE_LINES } from './instructions';
import { modeLook, type ModeId } from './modes';

export function InstructionsOverlay({ screen, onClose }: { screen: ModeId | 'menu'; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = screen === 'menu' ? 'The records' : modeLook(screen).name;
  return (
    <section className="guide-overlay" id="guide-overlay" aria-labelledby="guide-overlay-title" data-testid="instructions-overlay">
      <div className="guide-overlay-inner">
        <p className="guide-overlay-kicker">How to use</p>
        <h2 id="guide-overlay-title" className="guide-overlay-title">
          {title}
        </h2>
        <ol className="guide-overlay-lines">
          {GUIDE_LINES[screen].map((l) => (
            <li key={l.big}>
              <span className="guide-big">{l.big}</span>
              <span className="guide-small">{l.small}</span>
            </li>
          ))}
        </ol>
        <p className="guide-overlay-close">Press Esc to close</p>
      </div>
    </section>
  );
}
