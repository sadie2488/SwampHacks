// Learn and Play: the practice card and the feedback card in the right column, the player bar at the bottom, and
// the sheet music on its calm paper band. (The hands meters moved to their own overlay, opened from the header.)
import { Sheet } from '@/modules/sheet';
import { FeedbackPanel } from './FeedbackPanel';
import { History } from './History';
import { PanelBoundary } from './PanelBoundary';
import { Practice } from './Practice';
import { Transport } from './Transport';
import { panelProps } from '@/ui/overture/PanelToggles';

export type SongViewOpen = { practice: boolean; feedback: boolean; player: boolean; sheet: boolean };

const ALL_OPEN: SongViewOpen = { practice: true, feedback: true, player: true, sheet: true };

/** Learn has the practice card, the feedback card and the sheet music; Play is a different page and only has the player. */
export function SongView({ mode = 'learn', open = ALL_OPEN }: { mode?: 'learn' | 'play'; open?: SongViewOpen }) {
  const learn = mode === 'learn';
  return (
    <>
      <div className="song-controls">
        {learn && (
          <div className="right-column">
            <div className="card practice-card float-panel" {...panelProps(open.practice)}>
              <PanelBoundary name="practice">
                <Practice />
              </PanelBoundary>
              <PanelBoundary name="practice history">
                <History />
              </PanelBoundary>
            </div>
            <div className="card feedback-card-panel float-panel" {...panelProps(open.feedback)}>
              <PanelBoundary name="feedback">
                <FeedbackPanel />
              </PanelBoundary>
            </div>
          </div>
        )}
        <div className="panel-slot" {...panelProps(open.player)}>
          <Transport />
        </div>
      </div>
      {/* the sheet sits on a calm, plain paper band: nothing from the moving background shows through it */}
      {learn && (
        <section className="sheet-strip float-panel" aria-labelledby="sheet-heading" {...panelProps(open.sheet)}>
          <div className="sheet-strip-inner">
            <h2 id="sheet-heading" className="kicker">
              Sheet music
            </h2>
            <PanelBoundary name="sheet music">
              <Sheet />
            </PanelBoundary>
          </div>
        </section>
      )}
    </>
  );
}
