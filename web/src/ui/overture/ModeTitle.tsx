// Inside a mode: the giant serif title, one plain line under it, the guide pill, and the section's flower.
// Two sync points with the music (only while a song plays):
// - every bar start: a copy of the title in the second ink slips a few pixels and settles (about 0.3 s)
// - a strong bar start: the flower flicks open and settles back (at most once per bar)
// Both restart by re-making one small element; only transform and opacity animate.
import { SECTION_FLOWER } from '@/ui/flowers';
import { useBarBeats } from './beats';
import { FlowerStack } from './FlowerSpray';
import { GuidePill } from './GuidePill';
import { GUIDES, type ModeLook } from './modes';

export function ModeTitle({ look, guides }: { look: ModeLook; guides: boolean }) {
  const { bars, blooms } = useBarBeats();
  const word = look.name.toUpperCase();
  return (
    <div className="mode-title">
      <FlowerStack key={`b${blooms}`} flower={SECTION_FLOWER[look.id]} stage={0} className={`mode-flower${blooms ? ' beat' : ''}`} />
      <p className="mode-word" aria-hidden="true">
        <span className="mode-word-clip">
          <span className="mode-word-line" key={look.id}>
            {word}
          </span>
        </span>
        {bars > 0 && (
          <span className="mode-word-slip" key={`s${bars}`}>
            {word}
          </span>
        )}
      </p>
      <p className="mode-sub">{look.sub}</p>
      {guides && <GuidePill want={GUIDES[look.id]} />}
    </div>
  );
}
