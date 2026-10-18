// Inside a mode: the giant serif title set on five thin staff lines (the first word big, the other words smaller and
// sitting at different heights on the staff, like notes), one plain line under it, the guide pill, and the
// section's flower. Two sync points with the music (only while a song plays):
// - every bar start: a copy of the big word in the second ink slips a few pixels and settles (about 0.3 s)
// - a strong bar start: the flower flicks open and settles back (at most once per bar)
// Both restart by re-making one small element; only transform and opacity animate.
import type { CSSProperties } from 'react';
import { SectionBloom } from '@/ui/flowers/SectionBloom';
import { useBarBeats } from './beats';
import { GuidePill } from './GuidePill';
import { GUIDES, type ModeLook } from './modes';

/** Where each smaller word sits on the staff, in half-gaps above the bottom line (even = on a line, odd = a space). */
const NOTE_STEPS = [4, 1, 6, 3];

/** The mode's title words: the big one first, then the rest ("Learn" + "By", "Ear"; "Command" + "Lab"). */
export function titleWords(look: ModeLook): [string, string[]] {
  const [first, ...rest] = look.big.join(' ').toUpperCase().split(/\s+/).filter(Boolean);
  return [first ?? look.name.toUpperCase(), rest];
}

export function ModeTitle({ look, guides }: { look: ModeLook; guides: boolean }) {
  const { bars, blooms } = useBarBeats();
  const [word, notes] = titleWords(look);
  return (
    <div className="mode-title">
      <SectionBloom key={`b${blooms}`} section={look.id} className={`mode-flower${blooms ? ' beat' : ''}`} />
      <p className="mode-word" aria-hidden="true" key={look.id}>
        <span className="mode-staff" />
        <span className="mode-word-clip">
          <span className="mode-word-line">{word}</span>
        </span>
        {bars > 0 && (
          <span className="mode-word-slip" key={`s${bars}`}>
            {word}
          </span>
        )}
        {notes.map((n, i) => (
          <span key={n + i} className="mode-note" style={{ '--step': NOTE_STEPS[i % NOTE_STEPS.length], '--i': i } as CSSProperties}>
            <span className="mode-note-in">{n}</span>
          </span>
        ))}
      </p>
      <p className="mode-sub">{look.sub}</p>
      {guides && <GuidePill want={GUIDES[look.id]} />}
    </div>
  );
}
