// The app shell (the Overture look): the entrance, the record menu, and inside a mode the header with the mode pills,
// the giant mode title, and the working panels. The mode pills (the tab-* buttons) are the same buttons on every
// screen: in the menu they sit in the bottom-right corner, inside a mode in the header. Clicking one opens that mode.
import { useCallback, useEffect, useRef, useState } from 'react';
import { bus, isFakeMode, isModuleOn, resumeAudio } from '@/bus';
import type { Mode } from '@/contracts';
import { CommandLab } from '@/modules/command-lab';
import { CreatePanel } from '@/modules/create';
import { Backdrop } from '@/ui/backdrop/Backdrop';
import { bigWordPlaces } from '@/ui/overture/carousel';
import { Entrance } from '@/ui/overture/Entrance';
import { GuideLayer } from '@/ui/overture/GuideLayer';
import { HandPointer } from '@/ui/overture/HandPointer';
import { HoldRing } from '@/ui/overture/HoldRing';
import { InstructionsOverlay } from '@/ui/overture/InstructionsOverlay';
import { MODES, modeLook, type ModeId, type Screen } from '@/ui/overture/modes';
import { RecordMenu } from '@/ui/overture/RecordMenu';
import { ModeTitle } from '@/ui/overture/ModeTitle';
import { ModeVisual } from '@/ui/overture/ModeVisual';
import { panelProps, PanelToggles, usePanels } from '@/ui/overture/PanelToggles';
import { initialScreen, readScreenHints, rememberEntered } from '@/ui/overture/screen';
import { SoundToggle } from '@/ui/overture/SoundToggle';
import { SoundUnlock } from '@/ui/overture/SoundUnlock';
import { needleDrop, swell, unlockOnFirstGesture, unlockSounds } from '@/ui/overture/sounds';
import { changeScreen, PORTAL_MS } from '@/ui/overture/transition';
import { AnalysisWarnings } from './AnalysisSummary';
import { apiFetch } from './api-fetch';
import { useDeviceAutostart } from './device-autostart';
import { CameraPreview } from './CameraPreview';
import { Devices, TouchDesignerToggle } from './Devices';
import { HandsCard } from './HandsCard';
import { LoginButton } from './LoginButton';
import { logoTarget, publishedMode } from './navigation';
import { useModules } from './modules-start';
import { PanelBoundary } from './PanelBoundary';
import { idleLoader, SongLoader, type LoaderState } from './SongLoader';
import { SongView } from './SongView';

type Tab = ModeId;

const TABS: Array<{ id: Tab; label: string; testid: string }> = [
  { id: 'learn', label: 'Learn', testid: 'tab-learn' },
  { id: 'play', label: 'Play', testid: 'tab-play' },
  { id: 'create', label: 'Create', testid: 'tab-create' },
  { id: 'lab', label: 'Command Lab', testid: 'tab-lab' },
];

/** The Command Lab counts as "play" for everything that listens to the mode. */
const modeOf = (tab: Tab): Mode => (tab === 'lab' ? 'play' : tab);
const indexOf = (tab: Tab) => Math.max(0, MODES.findIndex((m) => m.id === tab));
/** "inert" keeps hidden screens out of the keyboard order (React 18 passes it through as a plain attribute). */
const inert = (on: boolean) => (on ? { inert: '' } : {}) as object;

export function App() {
  const [tab, setTab] = useState<Tab>('learn');
  const [screen, setScreen] = useState<Screen>(() => initialScreen(readScreenHints()));
  const [menuSel, setMenuSel] = useState(0);
  const [loader, setLoader] = useState<LoaderState>(idleLoader);
  // restarts the "content rises in" animation on every arrival in a mode (two names so it can restart in place)
  const [arrive, setArrive] = useState<{ kind: string; n: number }>({ kind: 'none', n: 0 });
  // the two header overlays: the guide (how to use this screen) and "what your hands say"
  const [guide, setGuide] = useState(false);
  const [hands, setHands] = useState(false);
  const closeGuide = useCallback(() => setGuide(false), []);
  const songTab = tab === 'learn' || tab === 'play';
  const { isOpen, toggle: togglePanel } = usePanels();
  useModules();
  useDeviceAutostart(screen);

  // On the entrance and the record menu a neutral mode is published, so the last mode's voice and hand rules stop
  // (and the Create loop stops); only the sign shortcuts and the grab stay live.
  const busMode = publishedMode(screen, modeOf(tab));
  useEffect(() => {
    bus.emit('mode', busMode);
  }, [busMode]);
  useEffect(() => unlockOnFirstGesture(), []);

  const openMode = (id: Tab) => {
    unlockSounds();
    if (screen === 'mode' && id === tab) return;
    const kind = screen === 'menu' ? 'portal' : screen === 'mode' ? 'mode' : 'enter';
    const update = () => {
      setTab(id);
      setMenuSel(indexOf(id));
      setScreen('mode');
      setArrive((a) => ({ kind, n: a.n + 1 }));
    };
    if (screen === 'menu') {
      // rush in from the TARGET record (a sign shortcut may name a different record than the one in front)
      setMenuSel(indexOf(id));
      const p = bigWordPlaces(indexOf(id), window.innerWidth, window.innerHeight);
      needleDrop();
      swell(PORTAL_MS);
      changeScreen('portal', update, { ...p.centre, hole: p.hole });
    } else changeScreen(kind, update);
  };
  // app.mode (a held sign, the Command Lab, an email...) opens a mode just like clicking its tab button (not on the entrance)
  const openModeRef = useRef(openMode);
  openModeRef.current = (id: Tab) => screen !== 'entrance' && openMode(id);
  useEffect(
    () =>
      bus.on('command', (c) => {
        const id = TABS.find((t) => c.command === 'app.mode' && t.id === c.value)?.id;
        if (id) openModeRef.current(id);
      }),
    [],
  );
  const openMenu = () =>
    changeScreen('back', () => {
      setMenuSel(indexOf(tab));
      setScreen('menu');
    });
  // the logo goes back to the title screen; the camera and the microphone keep running
  const openEntrance = () => {
    const target = logoTarget(screen);
    if (!target) return;
    changeScreen('back', () => {
      setMenuSel(indexOf(tab));
      setScreen(target);
    });
  };
  const enter = (camera: boolean) => {
    rememberEntered();
    unlockSounds();
    resumeAudio().catch(() => {});
    // the click is the person's go-ahead; if they refuse a permission the app simply carries on without it
    if (camera && !isModuleOn('vision')) bus.emit('enable', { module: 'vision', on: true });
    if (!isModuleOn('audio-live')) bus.emit('enable', { module: 'audio-live', on: true });
    changeScreen('enter', () => setScreen('menu'));
  };

  const shownMode: ModeId = screen === 'menu' ? MODES[menuSel].id : tab;
  return (
    <div className="app" data-screen={screen} data-mode={shownMode} data-arrive={arrive.n ? `${arrive.kind}-${arrive.n % 2}` : undefined}>
      <Backdrop screen={screen} mode={shownMode} menuIndex={menuSel} />
      <GuideLayer screen={screen} mode={tab} />
      <HoldRing />
      <HandPointer screen={screen} mode={shownMode} />
      {/* the entrance's own buttons are the click that turns sound on; elsewhere (e.g. after a reload) say so */}
      {screen !== 'entrance' && <SoundUnlock />}
      {screen === 'entrance' && <Entrance onEnter={enter} />}
      {screen === 'menu' && <RecordMenu sel={menuSel} onSelect={setMenuSel} onChoose={(i) => openMode(MODES[i].id)} />}
      <header className="app-header" {...inert(screen === 'entrance')}>
        <div className="brand-block">
          <h1 className="brand">
            <button type="button" className="brand-home" aria-label="Overture, home" title="Back to the title screen" onClick={openEntrance}>
              Overture
            </button>
          </h1>
          <TouchDesignerToggle />
          <button type="button" className="pill records-pill" title="Back to the four records" onClick={openMenu}>
            Records
          </button>
        </div>
        <div role="tablist" aria-label="Mode" className="tabs">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={screen !== 'menu' ? tab === t.id : menuSel === indexOf(t.id)} aria-controls="mode-panel" data-testid={t.testid} onClick={() => openMode(t.id)} onPointerEnter={() => screen === 'menu' && setMenuSel(indexOf(t.id))} onFocus={() => screen === 'menu' && setMenuSel(indexOf(t.id))}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="header-end">
          <button type="button" className="pill overlay-pill" data-testid="btn-instructions" aria-pressed={guide} title="How to use this screen with your voice and hands (Esc closes)" onClick={() => setGuide((g) => !g)}>
            Guide
          </button>
          {screen === 'mode' && (
            <button type="button" className="pill overlay-pill" data-testid="btn-hands-overlay" aria-pressed={hands} title="What your hands say" onClick={() => setHands((h) => !h)}>
              Hands
            </button>
          )}
          <SoundToggle />
          <LoginButton />
        </div>
      </header>
      {guide && screen !== 'entrance' && <InstructionsOverlay screen={screen === 'menu' ? 'menu' : tab} onClose={closeGuide} />}
      {hands && screen === 'mode' && (
        <aside className="hands-overlay" aria-label="What your hands say">
          <PanelBoundary name="hands">
            <HandsCard />
          </PanelBoundary>
        </aside>
      )}

      <main className="app-main" {...inert(screen !== 'mode')}>
        <div role="tabpanel" id="mode-panel" className={`mode-panel stage stage-${tab}${songTab ? ' stage-song' : ''}`} aria-labelledby={`tab-${tab}`}>
          <ModeTitle look={modeLook(tab)} guides={screen === 'mode'} />
          {/* the mode's own picture over the camera (staff and notes, hum rings, hand readout), driven by real data */}
          {screen === 'mode' && <ModeVisual mode={tab} />}
          {/* the left panel: the song picker (Learn and Play), the devices, and the camera picture right under them */}
          <div className="card side-card float-panel" {...panelProps(tab === 'lab' || isOpen(songTab ? 'song' : 'devices'))}>
            {songTab && (
              <>
                <SongLoader state={loader} setState={setLoader} />
                <AnalysisWarnings />
              </>
            )}
            <Devices fake={isFakeMode()} />
            <CameraPreview />
          </div>
          {songTab && <SongView open={{ practice: isOpen('practice'), player: isOpen('player'), sheet: isOpen('sheet') }} />}
          {tab === 'create' && (
            <div className="stage-main float-panel create-slot" data-layers={isOpen('layers')} data-tracks={isOpen('tracks')} {...panelProps(isOpen('layers') || isOpen('tracks'))}>
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
          {screen === 'mode' && <PanelToggles mode={tab} isOpen={isOpen} toggle={togglePanel} />}
        </div>
      </main>
    </div>
  );
}
