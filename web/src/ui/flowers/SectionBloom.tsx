// A section's flower: its three states stacked (fill tinted with the second ink under the line tinted with the main
// ink); data-stage picks which state shows and `.beat` plays the "flick open, settle back" (bloom.css). Only opacity
// animates. Tinting happens once per picture (tint.ts); until it is ready the flower is simply not drawn yet.
import { useEffect, useState } from 'react';
import { SECTION_FLOWERS, SECTION_LOOKS, STATES, type SectionId } from './sections';
import { tinted, tintedNow } from './tint';

type Layer = { url: string; colour: string };

function layers(section: SectionId): Layer[] {
  const look = SECTION_LOOKS[section];
  const f = SECTION_FLOWERS[section];
  return STATES.flatMap((st) => [
    ...(f[st].fill ? [{ url: f[st].fill!, colour: look.b }] : []),
    ...(f[st].line ? [{ url: f[st].line, colour: look.a }] : []),
  ]);
}

/** The tinted picture for every layer, or null while they are being made. */
function useTinted(section: SectionId): Map<string, string> | null {
  const read = () => {
    const all = layers(section).map((l) => [l.url, tintedNow(l.url, l.colour)] as const);
    return all.every(([, t]) => t) ? new Map(all as Array<[string, string]>) : null;
  };
  const [map, setMap] = useState(read);
  useEffect(() => {
    let live = true;
    const now = read();
    if (now) setMap(now);
    else Promise.all(layers(section).map((l) => tinted(l.url, l.colour))).then(() => live && setMap(read()));
    return () => {
      live = false;
    };
  }, [section]);
  return map;
}

export function SectionBloom({ section, stage = 0, className = '' }: { section: SectionId; stage?: 0 | 1 | 2; className?: string }) {
  const map = useTinted(section);
  const f = SECTION_FLOWERS[section];
  return (
    <div className={`bloom section-bloom ${className}`} data-stage={stage} data-flower={SECTION_LOOKS[section].flower} aria-hidden="true">
      {map &&
        STATES.map((st) => (
          <span key={st} className={`bloom-state bloom-${st}`}>
            {f[st].fill && <img src={map.get(f[st].fill!)} alt="" draggable={false} className="bloom-fill" />}
            {f[st].line && <img src={map.get(f[st].line)} alt="" draggable={false} />}
          </span>
        ))}
    </div>
  );
}
