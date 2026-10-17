// Practice: play along with the song and get friendly feedback. This panel only talks to the listening part through
// the bus (practiceControl in; practice and feedback out) and to the server for the coach's wording.
import { useEffect, useState } from 'react';
import { bus, sendCommand, type Topics } from '@/bus';
import { FeedbackCard } from './FeedbackCard';
import { afterAudioWakes, useBusValue, useModuleStatus } from './hooks';
import { NO_SONG_MESSAGE, practiceWords } from './practice-logic';

type Action = Topics['practiceControl']['action'];

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const STEPS = ['Turn on the microphone', "Use headphones so the microphone doesn't hear the song", 'Clap along to calibrate the delay', 'Play along with the song'];

export function Practice() {
  const feedback = useBusValue('feedback');
  const [practice, setPractice] = useState(() => bus.last('practice'));
  // The delay stays on screen even if a later message does not repeat it.
  const [latency, setLatency] = useState<number | undefined>(() => (finite(bus.last('practice')?.latencyOffsetMs) ? bus.last('practice')!.latencyOffsetMs : undefined));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () =>
      bus.on(
        'practice',
        (p) => {
          setPractice(p);
          if (finite(p.latencyOffsetMs)) setLatency(p.latencyOffsetMs);
          setNotice(null);
        },
        { replay: true },
      ),
    [],
  );
  useEffect(() => bus.on('analysis', () => setNotice(null)), []);
  const mic = useModuleStatus('audio-live');
  const micOn = mic?.state === 'starting' || mic?.state === 'running';
  // The step to do next: the microphone first, then the clap check, then playing along.
  const nowStep = !micOn ? 0 : latency === undefined ? 2 : 3;

  const send = (action: Action) => () =>
    void afterAudioWakes(() => {
      setNotice(null);
      if (action !== 'start') {
        bus.emit('practiceControl', { action });
        return;
      }
      const transport = bus.last('transport');
      if (!transport?.loaded && !bus.last('analysis')) {
        setNotice(NO_SONG_MESSAGE);
        return;
      }
      bus.emit('practiceControl', { action });
      if (!transport?.playing) sendCommand('playback.play', 'button', { how: 'trigger' });
    });

  return (
    <section className="panel practice" aria-labelledby="practice-heading">
      <p className="kicker" aria-hidden="true">
        Practice: play along
      </p>
      <h2 id="practice-heading">
        <span className="sr-only">Practice: </span>Play it with the reef
      </h2>
      <ol className="practice-steps">
        {STEPS.map((step, i) => (
          <li key={i} aria-current={i === nowStep ? 'step' : undefined}>
            {step}
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" data-testid="btn-calibrate" onClick={send('calibrate')}>
          Calibrate: clap along
        </button>
        <button type="button" data-testid="btn-practice-start" onClick={send('start')}>
          Start practice
        </button>
        <button type="button" data-testid="btn-practice-stop" onClick={send('stop')}>
          Stop
        </button>
      </div>
      <p data-testid="practice-status" data-state={practice?.state ?? 'idle'} role={practice?.state === 'error' ? 'alert' : 'status'}>
        {practiceWords(practice)}
      </p>
      {notice && (
        <p className="notice" data-testid="practice-notice" role="status">
          {notice}
        </p>
      )}
      {latency !== undefined && <p data-testid="practice-latency">Delay measured: {Math.round(latency)} ms</p>}
      {feedback && <FeedbackCard feedback={feedback} />}
    </section>
  );
}
