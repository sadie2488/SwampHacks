// The app shell: header, mode tabs, the song view shared by Learn and Play, and the other modules' panels.
import { useEffect, useState } from 'react';
import { bus, isFakeMode, reportStatus, type Stop } from '@/bus';
import type { Mode } from '@/contracts';
import { start as startAudioLive } from '@/modules/audio-live';
import { CommandLab } from '@/modules/command-lab';
import { start as startCommands } from '@/modules/commands';
import { CreatePanel, start as startCreate } from '@/modules/create';
import { start as startPlayback } from '@/modules/playback';
import { Sheet } from '@/modules/sheet';
import { start as startTouchDesigner } from '@/modules/touchdesigner';
import { start as startVision } from '@/modules/vision';
import { Backdrop } from '@/ui/backdrop/Backdrop';
import { AnalysisWarnings } from './AnalysisSummary';
import { apiFetch } from './api-fetch';
import { CameraPreview } from './CameraPreview';
import { Devices } from './Devices';
import { HandsCard } from './HandsCard';
import { History } from './History';
import { LoginButton } from './LoginButton';
import { PanelBoundary } from './PanelBoundary';
import { Practice } from './Practice';
import { idleLoader, SongLoader, type LoaderState } from './SongLoader';
import { Transport } from './Transport';

type Tab = 'learn' | 'play' | 'create' | 'lab';

const TABS: Array<{ id: Tab; label: string; testid: string }> = [
  { id: 'learn', label: 'Learn', testid: 'tab-learn' },
  { id: 'play', label: 'Play', testid: 'tab-play' },
  { id: 'create', label: 'Create', testid: 'tab-create' },
  { id: 'lab', label: 'Command Lab', testid: 'tab-lab' },
];

/** The Command Lab counts as "play" for everything that listens to the mode. */
const modeOf = (tab: Tab): Mode => (tab === 'lab' ? 'play' : tab);

const MODULES: Array<[name: string, start: () => Stop]> = [
  ['playback', startPlayback],
  ['commands', startCommands],
  ['vision', startVision],
  ['audio-live', startAudioLive],
  ['touchdesigner', startTouchDesigner],
  ['create', startCreate],
];

/** Learn and Play: the practice card, the player bar at the bottom, and the sheet music on its paper strip. */
function SongView({ tab }: { tab: Tab }) {
  return (
    <>
      {tab === 'play' && (
        <PanelBoundary name="hands">
          <HandsCard />
        </PanelBoundary>
      )}
      <div className="song-controls">
        <div className="card practice-card">
          <PanelBoundary name="practice">
            <Practice />
          </PanelBoundary>
          <PanelBoundary name="practice history">
            <History />
          </PanelBoundary>
        </div>
        <Transport />
      </div>
      {/* the sheet sits on a calm torn-paper strip, in front of the landscape */}
      <section className="sheet-strip" aria-labelledby="sheet-heading">
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

export function App() {
  const [tab, setTab] = useState<Tab>('learn');
  const [loader, setLoader] = useState<LoaderState>(idleLoader);
  const songTab = tab === 'learn' || tab === 'play';

  // Start every module once. A module that fails to start must not take the page down with it.
  useEffect(() => {
    const stops = MODULES.map(([name, start]) => {
      try {
        return start();
      } catch (e) {
        console.error(`[app] the ${name} module could not start`, e);
        reportStatus(name, 'error', 'This part could not start.');
        return () => {};
      }
    });
    return () => {
      for (const stop of stops) {
        try {
          stop();
        } catch (e) {
          console.error('[app] a module did not stop cleanly', e);
        }
      }
    };
  }, []);

  useEffect(() => {
    bus.emit('mode', modeOf(tab));
  }, [tab]);

  return (
    <div className="app">
      <Backdrop />
      <header className="app-header">
        <h1 className="brand">
          Swamp<span className="brand-accent">Hacks</span> Music
        </h1>
        <div role="tablist" aria-label="Mode" className="tabs">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="mode-panel" data-testid={t.testid} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="header-end">
          <LoginButton />
        </div>
      </header>

      <main className="app-main">
        <div role="tabpanel" id="mode-panel" className={`mode-panel stage stage-${tab}${songTab ? ' stage-song' : ''}`} aria-labelledby={`tab-${tab}`}>
          {/* the left card: the song picker (Learn and Play), the devices, and the camera picture right under them */}
          <div className="card side-card">
            {songTab && (
              <>
                <SongLoader state={loader} setState={setLoader} />
                <AnalysisWarnings />
              </>
            )}
            <Devices fake={isFakeMode()} />
            <CameraPreview />
          </div>
          {songTab && <SongView tab={tab} />}
          {tab === 'create' && (
            <div className="stage-main">
              <PanelBoundary name="Create">
                <CreatePanel fetchFn={apiFetch} />
              </PanelBoundary>
            </div>
          )}
          {tab === 'lab' && (
            <div className="stage-main">
              <PanelBoundary name="Command Lab">
                <CommandLab />
              </PanelBoundary>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
