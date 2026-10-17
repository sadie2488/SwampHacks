import type { SongAnalysis } from '@/contracts';
import { useBusValue } from './hooks';

/** Below these, the analysis itself says it is guessing, so we say so too. */
const TEMPO_UNSURE_BELOW = 0.3;
const KEY_UNSURE_BELOW = 0.5;

export const TEMPO_UNSURE_TEXT = "I'm not very sure about the tempo";
export const KEY_UNSURE_TEXT = "I'm not very sure about the key";

const isLow = (confidence: unknown, limit: number) => typeof confidence === 'number' && confidence < limit;

/** The server's plain-words cautions, exactly as sent (only empty or non-text entries are dropped). */
export function warningsOf(a: SongAnalysis): string[] {
  return Array.isArray(a.warnings) ? a.warnings.filter((w): w is string => typeof w === 'string' && w.trim() !== '') : [];
}

export function describeAnalysis(a: SongAnalysis) {
  return {
    title: a.title ?? a.source?.file_name ?? a.song_id,
    tempo: `${Math.round(a.tempo_bpm)} BPM`,
    key: a.key ? `${a.key.tonic} ${a.key.mode}` : 'unknown',
    timeSignature: a.time_signature ? `${a.time_signature.numerator}/${a.time_signature.denominator}` : 'unknown',
    tempoUnsure: isLow(a.tempo_confidence, TEMPO_UNSURE_BELOW),
    keyUnsure: isLow(a.key?.confidence, KEY_UNSURE_BELOW),
  };
}

export function AnalysisSummary() {
  const analysis = useBusValue('analysis');
  if (!analysis) return <p className="muted">No song yet. Upload a file or use the demo song.</p>;
  const d = describeAnalysis(analysis);
  const warnings = warningsOf(analysis);
  return (
    <section className="panel" aria-labelledby="summary-heading" data-testid="analysis-summary">
      <h2 id="summary-heading">About this song</h2>
      {warnings.length > 0 && (
        <div className="notice analysis-warnings" role="status" data-testid="analysis-warnings">
          <p className="analysis-warnings-title">Please note</p>
          <ul>
            {warnings.map((w, i) => (
              <li key={i} data-testid={`analysis-warning-${i}`}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="facts">
        <div>
          <dt>Title</dt>
          <dd data-testid="analysis-title">{d.title}</dd>
        </div>
        <div>
          <dt>Tempo</dt>
          <dd data-testid="analysis-tempo">{d.tempo}</dd>
          {d.tempoUnsure && (
            <dd className="unsure muted" data-testid="analysis-tempo-unsure">
              {TEMPO_UNSURE_TEXT}
            </dd>
          )}
        </div>
        <div>
          <dt>Key</dt>
          <dd data-testid="analysis-key">{d.key}</dd>
          {d.keyUnsure && (
            <dd className="unsure muted" data-testid="analysis-key-unsure">
              {KEY_UNSURE_TEXT}
            </dd>
          )}
        </div>
        <div>
          <dt>Time signature</dt>
          <dd data-testid="analysis-time-signature">{d.timeSignature}</dd>
        </div>
      </dl>
    </section>
  );
}
