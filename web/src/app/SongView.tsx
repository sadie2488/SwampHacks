// Learn and Play: the practice card, the player bar at the bottom, and the sheet music on its calm paper band.
// (The hands meters moved to their own overlay, opened from the header: see App.tsx.)
import { Sheet } from '@/modules/sheet';
import { History } from './History';
import { PanelBoundary } from './PanelBoundary';
import { Practice } from './Practice';
import { Transport } from './Transport';
import { panelProps } from '@/ui/overture/PanelToggles';

const ALL_OPEN = { practice: true, player: true, sheet: true };

export function SongView({ open = ALL_OPEN }: { open?: { practice: boolean; player: boolean; sheet: boolean } }) {
  return (
    <>
      <div className="song-controls">
        <div className="card practice-card float-panel" {...panelProps(open.practice)}>
          <PanelBoundary name="practice">
            <Practice />
          </PanelBoundary>
          <PanelBoundary name="practice history">
            <History />
          </PanelBoundary>
        </div>
        <div className="panel-slot" {...panelProps(open.player)}>
          <Transport />
        </div>
      </div>
      {/* the sheet sits on a calm, plain paper band: nothing from the moving background shows through it */}
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
    </>
  );
}
