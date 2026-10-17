import { useEffect, useState } from 'react';
import { bus, type EnableTarget, type ModuleStatus } from '@/bus';
import { useBusValue } from './hooks';

const DEVICES: Array<{ module: EnableTarget; testid: string; statusId: string; on: string; off: string; name: string }> = [
  { module: 'vision', testid: 'btn-enable-vision', statusId: 'status-vision', on: 'Turn off camera', off: 'Turn on camera', name: 'Camera' },
  { module: 'audio-live', testid: 'btn-enable-audio', statusId: 'status-audio-live', on: 'Turn off microphone', off: 'Turn on microphone', name: 'Microphone' },
  { module: 'touchdesigner', testid: 'btn-enable-td', statusId: 'status-touchdesigner', on: 'Stop sending to TouchDesigner', off: 'Send to TouchDesigner', name: 'TouchDesigner' },
];

/** The status in plain words. The raw state is also kept in data-state for tests. */
export function statusWords(s: ModuleStatus | undefined): string {
  if (!s || s.state === 'idle') return s?.message ? `Off (${s.message})` : 'Off';
  if (s.state === 'starting') return s.message ? `Starting... ${s.message}` : 'Starting...';
  if (s.state === 'running') return s.message ? `On (${s.message})` : 'On';
  return `Problem: ${s.message ?? 'something went wrong'}`;
}

function Device({ d, fake }: { d: (typeof DEVICES)[number]; fake: boolean }) {
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<ModuleStatus | undefined>();

  useEffect(
    () =>
      bus.on(
        'status',
        (s) => {
          if (s.module !== d.module) return;
          setStatus(s);
          // If the module could not start (for example the camera was blocked), the button goes back to "turn on".
          if (s.state === 'error') setOn(false);
        },
        { replay: true },
      ),
    [d.module],
  );

  return (
    <li className="device">
      <button
        type="button"
        data-testid={d.testid}
        aria-pressed={on}
        onClick={() => {
          bus.emit('enable', { module: d.module, on: !on });
          setOn(!on);
        }}
      >
        {on ? d.on : d.off}
      </button>{' '}
      {d.name}: <span data-testid={d.statusId} data-state={status?.state ?? 'idle'}>{statusWords(status)}</span>
      {fake && d.module !== 'touchdesigner' && <span className="muted"> (practice data, no real {d.name.toLowerCase()} used)</span>}
    </li>
  );
}

export function Devices({ fake }: { fake: boolean }) {
  const issues = useBusValue('issues') ?? [];
  return (
    <section className="panel" aria-labelledby="devices-heading">
      <h2 id="devices-heading">Devices</h2>
      <ul className="devices">
        {DEVICES.map((d) => (
          <Device key={d.module} d={d} fake={fake} />
        ))}
      </ul>
      <p>
        Mapping problems: <strong data-testid="issues-count">{issues.length}</strong>
      </p>
      {issues.length > 0 && (
        <details>
          <summary>Show the problems</summary>
          <ul>
            {issues.map((i, n) => (
              <li key={n}>
                {i.level === 'error' ? 'Error' : 'Warning'} in {i.where}: {i.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
