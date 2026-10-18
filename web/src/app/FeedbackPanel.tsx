// Feedback: its own Learn panel. It shows the latest feedback card after a practice run (the bus remembers it, so
// the card is still there when the panel is opened again) and a short note until the first run.
import { FeedbackCard } from './FeedbackCard';
import { useBusValue } from './hooks';

export function FeedbackPanel() {
  const feedback = useBusValue('feedback');
  return (
    <section className="panel feedback-panel" aria-labelledby="feedback-panel-heading" data-testid="feedback-panel">
      <p className="kicker" aria-hidden="true">
        Feedback
      </p>
      <h2 id="feedback-panel-heading">
        <span className="sr-only">Feedback: </span>After your run
      </h2>
      {feedback ? (
        <FeedbackCard feedback={feedback} />
      ) : (
        <p className="muted" data-testid="feedback-empty">
          Finish a practice run and your feedback shows up here.
        </p>
      )}
    </section>
  );
}
