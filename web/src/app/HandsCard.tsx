// Play tab: what the camera reads from your hands and head right now, and the mapping rules that just fired.
// Read-only: it only listens to the bus (signal, fired). The full list of every signal and rule is in the Command Lab.
import { useEffect, useState } from 'react';
import { bus } from '@/bus';
import type { CommandEvent } from '@/contracts';

const METERS: Array<{ id: string; label: string }> = [
  { id: 'vision.hand.right.height', label: 'Right hand height' },
  { id: 'vision.hand.left.height', label: 'Left hand height' },
  { id: 'vision.hands.distance', label: 'Hands apart' },
  { id: 'vision.head.tilt', label: 'Head tilt' },
];
const WATCHED = new Set(METERS.map((m) => m.id));
const RECENT = 4;

/** "tempo 1.1", "play", "loop on": the command in a few words, for the little badge. */
export function commandBadge(c: CommandEvent): string {
  const name = c.command.split('.').pop()?.replace(/_/g, ' ') ?? c.command;
  const v = c.value;
  if (typeof v === 'number') return `${name} ${Math.round(v * 100) / 100}`;
  if (typeof v === 'boolean') return `${name} ${v ? 'on' : 'off'}`;
  if (typeof v === 'string') return `${name} ${v}`;
  return name;
}

export function HandsCard() {
  const [values, setValues] = useState<Record<string, number>>({});
  const [fired, setFired] = useState<Array<{ key: number; mapping: string; badge: string }>>([]);

  useEffect(
    () =>
      bus.on('signal', (s) => {
        if (!WATCHED.has(s.id) || typeof s.value !== 'number' || !Number.isFinite(s.value)) return;
        const value = Math.min(1, Math.max(0, s.value));
        setValues((now) => (now[s.id] === value ? now : { ...now, [s.id]: value }));
      }),
    [],
  );

  useEffect(() => {
    let key = 0;
    return bus.on('fired', (f) => {
      key += 1;
      const item = { key, mapping: f.mapping, badge: commandBadge(f.command) };
      setFired((now) => [item, ...now.filter((x) => x.mapping !== f.mapping)].slice(0, RECENT));
    });
  }, []);

  return (
    <section className="card hands-card" aria-labelledby="hands-heading" data-testid="hands-card">
      <p className="kicker" aria-hidden="true">
        What your hands say
      </p>
      <h2 id="hands-heading">
        <span className="sr-only">What your hands say: </span>Wave at the reef
      </h2>
      {METERS.map((m) => {
        const v = values[m.id];
        return (
          <div className="hand-meter" key={m.id} data-testid={`hand-meter-${m.id}`}>
            <div className="hand-meter-name">
              <span>{m.label}</span>
              <span className="hand-meter-value">{v === undefined ? 'no data yet' : v.toFixed(2)}</span>
            </div>
            <div className="bar" aria-hidden="true">
              <span style={{ width: `${Math.round((v ?? 0) * 100)}%` }} />
            </div>
          </div>
        );
      })}
      {Object.keys(values).length === 0 && <p className="small-note">Turn on the camera to see your hands here.</p>}

      <h3 className="kicker">Rules that just lit up</h3>
      {fired.length === 0 ? (
        <p className="small-note" data-testid="hands-fired-empty">
          Nothing yet. Move, clap or say a command.
        </p>
      ) : (
        <ul className="fired-list" data-testid="hands-fired" aria-live="polite">
          {fired.map((f) => (
            <li key={f.key}>
              <span>{f.mapping}</span>
              <em>{f.badge}</em>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
