import { useEffect, useState } from 'react';
import { bus, getStatus, isModuleOn, type EnableTarget, type ModuleStatus } from '@/bus';
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

// TouchDesigner keeps retrying while it is switched on and reports a problem each time it cannot find the relay.
// Its button follows the click, not those problems. For the camera and microphone a problem means they are off.
const KEEPS_TRYING: ReadonlySet<EnableTarget> = new Set(['touchdesigner']);

/** What the button should show after a status, given what it shows now. */
function buttonAfter(module: EnableTarget, s: ModuleStatus, now: boolean): boolean {
  if (s.state === 'starting' || s.state === 'running') return true;
  if (s.state === 'idle') return false;
  return KEEPS_TRYING.has(module) ? now : false;
}

function Device({ d, fake }: { d: (typeof DEVICES)[number]; fake: boolean }) {
  // Start from what the module already says, so the button is right even if it was switched on somewhere else.
  const [on, setOn] = useState(() => isModuleOn(d.module) || (KEEPS_TRYING.has(d.module) && getStatus(d.module)?.state === 'error'));
  const [status, setStatus] = useState<ModuleStatus | undefined>(() => getStatus(d.module));

  useEffect(() => {
    const follow = (s: ModuleStatus) => {
      setStatus(s);
      setOn((now) => buttonAfter(d.module, s, now));
    };
    const latest = getStatus(d.module);
    if (latest) follow(latest); // in case it spoke between the first draw and now
    return bus.on('status', (s) => {
      if (s.module === d.module) follow(s);
    });
  }, [d.module]);

  const toggle = () => {
    const next = !on;
    const before = getStatus(d.module);
    bus.emit('enable', { module: d.module, on: next });
    // A module that answers right away (for example "this page cannot use the camera") wins over the click.
    const after = getStatus(d.module);
    setOn(after && after !== before ? buttonAfter(d.module, after, next) : next);
  };

  return (
    <li className="device">
      <button type="button" data-testid={d.testid} aria-pressed={on} onClick={toggle}>
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
