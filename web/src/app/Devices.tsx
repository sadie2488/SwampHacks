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

function Device({ d, fake, sparkle = false }: { d: (typeof DEVICES)[number]; fake: boolean; sparkle?: boolean }) {
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

  const words = statusWords(status);
  const fakeNote = fake && d.module !== 'touchdesigner' ? ` (practice data, no real ${d.name.toLowerCase()} used)` : '';
  // "Off" / "On" is already said by the row itself; anything more (a problem, what it is doing) shows as a note.
  const plain = !status || status.state === 'idle' || words === 'On';

  const label = (
    <>
      <span className="device-name">{d.name}</span> <span className="device-state">{on ? 'on' : 'off'}</span>
    </>
  );
  const Wrap = sparkle ? 'span' : 'li';
  return (
    <Wrap className={sparkle ? 'td-sparkle-wrap' : 'device'} data-on={on}>
      <button type="button" className={sparkle ? 'td-sparkle' : 'device-toggle'} data-testid={d.testid} data-device={d.module} aria-pressed={on} title={`${on ? d.on : d.off}. ${d.name}: ${words}${fakeNote}`} onClick={toggle}>
        {sparkle ? (
          <>
            <SparkleIcon />
            <span className="sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </button>
      <span className={plain || sparkle ? 'sr-only' : 'device-note'} data-testid={d.statusId} data-state={status?.state ?? 'idle'} title={words}>
        {words}
      </span>
    </Wrap>
  );
}

/** A four-point sparkle in a thin circle (the TouchDesigner switch next to the logo). */
function SparkleIcon() {
  return (
    <svg className="td-sparkle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4.5c.5 4.3 2.7 6.6 7.5 7.5-4.8.9-7 3.2-7.5 7.5-.5-4.3-2.7-6.6-7.5-7.5 4.8-.9 7-3.2 7.5-7.5z" />
    </svg>
  );
}

/** The TouchDesigner on/off switch as a small sparkle button (it sits next to the Overture logo). */
export function TouchDesignerToggle() {
  return <Device d={DEVICES.find((x) => x.module === 'touchdesigner')!} fake={false} sparkle />;
}

export function Devices({ fake }: { fake: boolean }) {
  const issues = useBusValue('issues') ?? [];
  return (
    <section className="devices-section" aria-labelledby="devices-heading">
      <h2 id="devices-heading" className="kicker devices-heading">
        Devices
      </h2>
      <ul className="devices">
        {/* TouchDesigner has its own sparkle switch next to the logo */}
        {DEVICES.filter((d) => d.module !== 'touchdesigner').map((d) => (
          <Device key={d.module} d={d} fake={fake} />
        ))}
      </ul>
      {fake && <p className="small-note">Practice data: no real camera or microphone is used.</p>}
      <p className="small-note">
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
