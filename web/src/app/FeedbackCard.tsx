import { useEffect, useState } from 'react';
import { sendCommand } from '@/bus';
import type { Feedback } from '@/contracts';
import { afterAudioWakes, useBusValue } from './hooks';
import { barsText, capitalize, cleanBars, coachingFor, coachLabel, knownCoaching, LOOP_SPEED, loopTarget, needsCoaching, tempoLine, type Coaching } from './practice-logic';

/** The friendly tips: instant facts first, then the coach's wording when the server answers (or the built-in wording). */
function useCoaching(feedback: Feedback): { coaching: Coaching | null; waiting: boolean } {
  const [got, setGot] = useState<{ for: Feedback; value: Coaching } | null>(null);
  useEffect(() => {
    if (!needsCoaching(feedback) || knownCoaching(feedback)) return;
    let cancelled = false;
    void coachingFor(feedback).then((value) => {
      if (!cancelled) setGot({ for: feedback, value });
    });
    return () => {
      cancelled = true;
    };
  }, [feedback]);
  const coaching = knownCoaching(feedback) ?? (got?.for === feedback ? got.value : null);
  return { coaching, waiting: !coaching && needsCoaching(feedback) };
}

/** Slow loop of the trouble spot: the same commands a button, a gesture or a voice command would send. */
const loopThisSpot = (range: [number, number]) => () =>
  void afterAudioWakes(() => {
    sendCommand('playback.loop_section', 'button', { how: 'set', value: range });
    sendCommand('playback.loop', 'button', { how: 'set', value: true });
    sendCommand('playback.tempo', 'button', { how: 'set', value: LOOP_SPEED });
    sendCommand('playback.play', 'button', { how: 'trigger' });
  });

export function FeedbackCard({ feedback }: { feedback: Feedback }) {
  const analysis = useBusValue('analysis');
  const { coaching, waiting } = useCoaching(feedback);
  const target = loopTarget(feedback, analysis);
  const strengths = Array.isArray(feedback.strengths) ? feedback.strengths : [];
  const issues = Array.isArray(feedback.issues) ? feedback.issues : [];

  return (
    <section className="feedback-card" aria-labelledby="feedback-heading" data-testid="feedback-card">
      <h3 id="feedback-heading">How it went</h3>
      <p data-testid="feedback-summary">{feedback.summary}</p>
      {feedback.tempo && <p data-testid="feedback-tempo">{tempoLine(feedback.tempo)}</p>}

      {strengths.length > 0 && (
        <>
          <h4>What went well</h4>
          <ul data-testid="feedback-strengths">
            {strengths.map((s, n) => (
              <li key={n}>{s}</li>
            ))}
          </ul>
        </>
      )}

      {issues.length > 0 && (
        <>
          <h4>What to work on</h4>
          <ul data-testid="feedback-issues">
            {issues.map((issue, n) => {
              const bars = cleanBars(issue.bars);
              return (
                <li key={n} data-kind={issue.kind} data-severity={issue.severity}>
                  {bars && <strong>{capitalize(barsText(bars))}: </strong>}
                  {issue.message}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {feedback.next_step && (
        <p>
          <strong>Next step:</strong> <span data-testid="feedback-next-step">{feedback.next_step}</span>
        </p>
      )}

      {target && (
        <p>
          <button type="button" data-testid="btn-loop-bar" disabled={!target.range} onClick={target.range ? loopThisSpot(target.range) : undefined}>
            Loop {barsText(target.bars)} at {Math.round(LOOP_SPEED * 100)}% speed
          </button>
          {!target.range && <span className="muted"> Load the song to use this.</span>}
        </p>
      )}

      <div className="feedback-coach" aria-live="polite">
        {waiting && <p data-testid="feedback-coaching-pending">Writing friendly tips...</p>}
        {coaching && (
          <>
            <p className="badge" data-testid="feedback-coaching-label" data-source={coaching.source}>
              {coachLabel(coaching.source)}
            </p>
            <p data-testid="feedback-coaching">{coaching.text}</p>
          </>
        )}
      </div>
    </section>
  );
}
