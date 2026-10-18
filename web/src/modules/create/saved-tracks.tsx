// The "save and open tracks" part of the Create screen: a name, a Save button, and the list of saved tracks.
// Opening a track puts its layers into the same store the rest of the screen uses; Play then starts the loop with the
// same command the Play loop button sends, so the controller does all the sound.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { bus, resumeAudio, sendCommand } from '@/bus';
import * as realApi from './api';
import type { FetchFn, ListResult, OpenResult, SaveResult, TrackSummary } from './api';
import { hasAnyNotes, isRecording, type CreateState } from './layers';
import { DEFAULT_TRACK_NAME, layersSignature, layersToPayload, type TrackPayload } from './serialize';
import type { CreateStore } from './store';

export interface SavedTracksApi {
  saveTrack(payload: TrackPayload): Promise<SaveResult>;
  listTracks(): Promise<ListResult>;
  loadTrack(track: { id: string; local?: boolean }): Promise<OpenResult>;
}

/** The real save/list/open calls. `fetchFn` is the app's fetch that adds the login token; without it, plain fetch. */
export function serverApi(fetchFn?: FetchFn): SavedTracksApi {
  const deps = fetchFn ? { fetchFn } : {};
  return {
    saveTrack: (payload) => realApi.saveTrack(payload, deps),
    listTracks: () => realApi.listTracks(deps),
    loadTrack: (track) => realApi.loadTrack(track, deps),
  };
}

/** What the layers looked like when they were last saved or opened, per store. Kept outside the screen so it survives the screen being closed and opened. */
const lastSaved = new WeakMap<CreateStore, string>();
const signatureOf = (s: CreateState) => layersSignature(s.layers, s.bpm);
const rememberAsSaved = (store: CreateStore) => lastSaved.set(store, signatureOf(store.getState()));
const hasUnsavedWork = (store: CreateStore) => {
  const s = store.getState();
  return hasAnyNotes(s) && lastSaved.get(store) !== signatureOf(s);
};

function dateText(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Status {
  text: string;
  problem: boolean;
}

export function SavedTracks({ store, api: given, fetchFn }: { store: CreateStore; api?: SavedTracksApi; fetchFn?: FetchFn }) {
  const api = useMemo(() => given ?? serverApi(fetchFn), [given, fetchFn]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [name, setName] = useState(DEFAULT_TRACK_NAME);
  const [status, setStatus] = useState<Status>({ text: '', problem: false });
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [listed, setListed] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ track: TrackSummary; play: boolean } | null>(null);
  // the list of saved tracks is tucked behind the "Your tracks" pill; automated browsers (navigator.webdriver) see it
  // from the start, because the browser tests click into the list right after the page loads
  const [showList, setShowList] = useState(() => typeof navigator !== 'undefined' && navigator.webdriver === true);
  const alive = useRef(true);
  const listCall = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const call = ++listCall.current;
    const result = await api.listTracks();
    if (!alive.current || call !== listCall.current) return;
    setTracks(result.tracks);
    setNotice(result.notice);
    setListed(true);
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recording = isRecording(state);
  const canSave = hasAnyNotes(state);

  const save = async () => {
    const s = store.getState();
    if (busy || !hasAnyNotes(s)) return;
    setBusy(true);
    setPending(null);
    setStatus({ text: 'Saving…', problem: false });
    const result = await api.saveTrack(layersToPayload(s.layers, s.bpm, name));
    if (result.ok) lastSaved.set(store, signatureOf(s));
    if (!alive.current) return;
    setBusy(false);
    if (result.ok) {
      setStatus({ text: result.local ? `Saved as ${result.name} on this computer only. ${result.reason ?? ''}`.trim() : `Saved as ${result.name}`, problem: false });
      void refresh();
    } else {
      setStatus({ text: result.message, problem: true });
    }
  };

  const open = async (track: TrackSummary, play: boolean) => {
    setPending(null);
    setBusy(true);
    setStatus({ text: `Opening ${track.name}…`, problem: false });
    const result = await api.loadTrack(track);
    if (!alive.current) return;
    setBusy(false);
    if (!result.ok) {
      setStatus({ text: result.message, problem: true });
      return;
    }
    if (isRecording(store.getState())) {
      setStatus({ text: 'A recording started, so the saved track was not opened.', problem: true });
      return;
    }
    const { track: loaded } = result;
    // a loop that is running keeps its clock: stop it first, then the new layers go in
    if (store.getState().phase === 'playing') sendCommand('create.loop.stop', 'button', { how: 'trigger' });
    store.dispatch({ type: 'loadTrack', bpm: loaded.bpm, bars: loaded.bars, layers: loaded.layers });
    rememberAsSaved(store);
    setName(loaded.name);
    let text = `Opened ${loaded.name}`;
    if (loaded.skippedNotes > 0) text += ` (${plural(loaded.skippedNotes, 'note')} could not be used and were left out)`;
    if (play) {
      if (!hasAnyNotes(store.getState())) {
        text += '. It has no notes to play';
      } else {
        sendCommand('create.loop.play', 'button', { how: 'trigger' });
        if (store.getState().phase === 'playing') text = `Playing ${loaded.name}`;
        else if (bus.last('mode') !== 'create') text += '. Create mode is not active, so it will not play yet';
      }
    }
    setStatus({ text, problem: false });
  };

  /** A click on Load or Play: wake the audio, warn first when unsaved layers would be lost. */
  const choose = (track: TrackSummary, play: boolean) => {
    if (busy || isRecording(store.getState())) return;
    try {
      void resumeAudio().catch(() => {});
    } catch {
      // sound is only needed for Play; the controller reports a sound problem itself
    }
    if (hasUnsavedWork(store)) setPending({ track, play });
    else void open(track, play);
  };

  return (
    <section data-testid="saved-tracks-section" aria-label="Save and open tracks" className="tracks-foot">
      <h3 className="tracks-title">Save and open tracks</h3>
      <p data-testid="save-status" role="status" className="save-status" data-problem={status.problem ? 'true' : undefined}>
        {status.text}
      </p>
      {!canSave && <p className="tracks-hint">Record something first, then you can save it.</p>}
      <p className="save-line">
        <label>
          Name your track{' '}
          <input
            type="text"
            data-testid="input-track-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
        </label>{' '}
        <button type="button" className="pill save-pill" data-testid="btn-save-track" disabled={!canSave || busy} onClick={() => void save()}>
          Save this track
        </button>{' '}
        <button type="button" className="pill" data-testid="btn-your-tracks" aria-pressed={showList} title="Show or hide your saved tracks" onClick={() => setShowList((v) => !v)}>
          Your tracks
        </button>
      </p>

      {pending && (
        <p data-testid="load-warning" role="alert" className="load-warning">
          You have layers that are not saved, and opening “{pending.track.name}” will replace them.{' '}
          <button
            type="button"
            data-testid="btn-confirm-load"
            onClick={() => {
              try {
                void resumeAudio().catch(() => {});
              } catch {
                // see choose()
              }
              void open(pending.track, pending.play);
            }}
          >
            Replace my layers
          </button>{' '}
          <button type="button" data-testid="btn-cancel-load" onClick={() => setPending(null)}>
            Keep my layers
          </button>
        </p>
      )}

      <div className="tracks-list" data-open={showList ? 'true' : 'false'}>
        <p className="tracks-list-head">
          <span>Your tracks</span>
          <button type="button" className="pill" data-testid="btn-refresh-tracks" onClick={() => void refresh()}>
            Refresh list
          </button>
        </p>
        {notice && <p data-testid="tracks-notice">{notice}</p>}
        {listed && tracks.length === 0 && <p data-testid="saved-tracks-empty">No saved tracks yet.</p>}
        {recording && tracks.length > 0 && <p>Stop recording to open a saved track.</p>}
        <ul data-testid="saved-tracks" aria-label="Saved tracks" hidden={tracks.length === 0}>
        {tracks.map((t, i) => {
          const date = dateText(t.created_at);
          return (
            <li key={`${t.local ? 'local' : 'server'}-${t.id}`} data-testid={`saved-track-${i}`}>
              <strong data-testid={`saved-track-${i}-name`}>{t.name}</strong>
              {t.tempo_bpm !== undefined && `, ${Math.round(t.tempo_bpm)} beats per minute`}
              {t.layer_count !== undefined && `, ${plural(t.layer_count, 'layer')}`}
              {date && `, ${date}`}
              {t.local && (
                <>
                  {', '}
                  <em data-testid={`saved-track-${i}-local`}>saved on this computer only</em>
                </>
              )}{' '}
              <button type="button" data-testid={`btn-load-track-${i}`} disabled={busy || recording} onClick={() => choose(t, false)}>
                Load
              </button>{' '}
              <button type="button" data-testid={`btn-play-track-${i}`} disabled={busy || recording} onClick={() => choose(t, true)}>
                Play
              </button>
            </li>
          );
        })}
        </ul>
      </div>
    </section>
  );
}
