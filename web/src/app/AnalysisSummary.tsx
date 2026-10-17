import type { ReactNode } from 'react';
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

/** The song's plain-words cautions. They sit with the song picker, above the sheet music. */
export function AnalysisWarnings() {
  const analysis = useBusValue('analysis');
  const warnings = analysis ? warningsOf(analysis) : [];
  if (warnings.length === 0) return null;
  return (
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
  );
}

/**
 * The song's title and one short line of facts ("C major · 4/4 · 100 BPM"), as shown in the player bar.
 * `extra` goes at the end of that line (the player bar puts the time there). Nothing at all until a song is loaded.
 */
export function SongFacts({ extra }: { extra?: ReactNode }) {
  const analysis = useBusValue('analysis');
  if (!analysis) return null;
  const d = describeAnalysis(analysis);
  return (
    <div className="song-facts" data-testid="analysis-summary">
      <h2 className="song-title" data-testid="analysis-title">
        {d.title}
      </h2>
      <p className="song-meta">
        <span className="fact">
          <span className="sr-only">Key: </span>
          <span data-testid="analysis-key">{d.key}</span>
          {d.keyUnsure && (
            <span className="unsure" data-testid="analysis-key-unsure">
              {KEY_UNSURE_TEXT}
            </span>
          )}
        </span>
        <span className="fact">
          <span className="sr-only">Time signature: </span>
          <span data-testid="analysis-time-signature">{d.timeSignature}</span>
        </span>
        <span className="fact">
          <span className="sr-only">Tempo: </span>
          <span data-testid="analysis-tempo">{d.tempo}</span>
          {d.tempoUnsure && (
            <span className="unsure" data-testid="analysis-tempo-unsure">
              {TEMPO_UNSURE_TEXT}
            </span>
          )}
        </span>
        {extra}
      </p>
    </div>
  );
}

/** Both pieces together, warnings first. */
export function AnalysisSummary() {
  return (
    <>
      <AnalysisWarnings />
      <SongFacts />
    </>
  );
}
