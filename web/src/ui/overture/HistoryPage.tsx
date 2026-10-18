// The History page: the third record (its id stays 'play' because the contracts' Mode type is learn | play | create).
// It replaced the Play section Sun 6 AM. Nothing on this page loads or plays a song by itself.
// First cut: the title, one line, and "Past creations" (the tracks saved in Create). The progress graph and the
// coach's feedback come next.
import { useState } from 'react';
import { apiFetch } from '@/app/api-fetch';
import { PastCreations } from '@/modules/create';
import './history-page.css';

export function HistoryPage() {
  const [creations, setCreations] = useState(false);

  return (
    <section className="history-page" data-testid="history-page" aria-labelledby="history-page-title">
      <header className="history-head">
        <h2 id="history-page-title" className="history-title">
          History
        </h2>
        <p className="history-lead">Your feedback and progress, in one place.</p>
      </header>

      <div className="history-body">
        <p className="history-empty" data-testid="history-page-empty">
          Your practice feedback and progress will appear here
        </p>
      </div>

      <footer className="history-foot">
        <button type="button" className="pill" data-testid="btn-past-creations" aria-pressed={creations} title="The tracks you saved in Create" onClick={() => setCreations((c) => !c)}>
          Past creations
        </button>
        <span className="history-muted">{creations ? 'Load or Play puts a track into Create. Open Create to hear it.' : 'The tracks you saved in Create.'}</span>
      </footer>
      {creations && (
        <div className="history-creations" data-testid="history-creations">
          <PastCreations fetchFn={apiFetch} />
        </div>
      )}
    </section>
  );
}
