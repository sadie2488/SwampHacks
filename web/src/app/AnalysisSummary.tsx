import type { SongAnalysis } from '@/contracts';
import { useBusValue } from './hooks';

export function describeAnalysis(a: SongAnalysis) {
  return {
    title: a.title ?? a.source?.file_name ?? a.song_id,
    tempo: `${Math.round(a.tempo_bpm)} BPM`,
    key: a.key ? `${a.key.tonic} ${a.key.mode}` : 'unknown',
    timeSignature: a.time_signature ? `${a.time_signature.numerator}/${a.time_signature.denominator}` : 'unknown',
  };
}

export function AnalysisSummary() {
  const analysis = useBusValue('analysis');
  if (!analysis) return <p className="muted">No song yet. Upload a file or use the demo song.</p>;
  const d = describeAnalysis(analysis);
  return (
    <section className="panel" aria-labelledby="summary-heading" data-testid="analysis-summary">
      <h2 id="summary-heading">About this song</h2>
      <dl className="facts">
        <div>
          <dt>Title</dt>
          <dd data-testid="analysis-title">{d.title}</dd>
        </div>
        <div>
          <dt>Tempo</dt>
          <dd data-testid="analysis-tempo">{d.tempo}</dd>
        </div>
        <div>
          <dt>Key</dt>
          <dd data-testid="analysis-key">{d.key}</dd>
        </div>
        <div>
          <dt>Time signature</dt>
          <dd data-testid="analysis-time-signature">{d.timeSignature}</dd>
        </div>
      </dl>
    </section>
  );
}
