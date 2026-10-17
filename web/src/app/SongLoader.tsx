import { useRef } from 'react';
import { bus, resumeAudio } from '@/bus';
import type { SongAnalysis } from '@/contracts';
import { LoadError, loadDemo, loadUpload, OFFLINE_NOTICE, type LoadedSong } from './song-loader';

export interface LoaderState {
  busy: boolean;
  /** True after the built-in demo was used because the server could not be reached. */
  offline: boolean;
  message: { kind: 'info' | 'error'; text: string } | null;
}
export const idleLoader: LoaderState = { busy: false, offline: false, message: null };

/** Hand a loaded song to everyone who needs it. The audio goes first so playback has it when the analysis arrives. */
export function publishSong(song: LoadedSong, fileName?: string): SongAnalysis {
  if (song.buffer) bus.emit('songAudio', { songId: song.analysis.song_id, buffer: song.buffer, fileName });
  bus.emit('analysis', song.analysis);
  return song.analysis;
}

export function SongLoader({ state, setState }: { state: LoaderState; setState: (s: LoaderState) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (job: () => Promise<LoadedSong>, fileName?: string) => {
    setState({ busy: true, offline: state.offline, message: null });
    try {
      await resumeAudio().catch(() => undefined);
      const song = await job();
      publishSong(song, fileName);
      setState({
        busy: false,
        offline: song.offline,
        message: song.offline && fileName ? { kind: 'info', text: 'Your file could not be analyzed without the server, so the built-in demo song is shown instead.' } : null,
      });
    } catch (e) {
      if (!(e instanceof LoadError)) console.error('[app] could not load the song', e);
      const text = e instanceof LoadError ? e.message : 'Something went wrong while loading the song. Please try again.';
      setState({ busy: false, offline: state.offline, message: { kind: 'error', text } });
    }
  };

  return (
    <section className="song-loader" aria-labelledby="song-heading">
      <p className="kicker" aria-hidden="true">
        Pick a song
      </p>
      <h2 id="song-heading">
        <span className="sr-only">Pick a song: </span>What’s on the stand?
      </h2>
      <div className="row">
        {/* the real file picker is hidden inside its label, which looks like the other pill buttons */}
        <label className="upload-button">
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            className="visually-hidden-input"
            data-testid="song-file"
            disabled={state.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void run(() => loadUpload(file), file.name);
              if (fileInput.current) fileInput.current.value = ''; // lets the same file be picked again
            }}
          />
          Upload a song file
        </label>
        <button type="button" data-testid="use-demo" disabled={state.busy} onClick={() => void run(() => loadDemo())}>
          Use demo song
        </button>
      </div>
      {state.busy && <p role="status">Loading the song...</p>}
      {state.offline && (
        <p className="notice" role="status" data-testid="offline-notice">
          {OFFLINE_NOTICE}
        </p>
      )}
      {state.message && (
        <p className={state.message.kind === 'error' ? 'error' : 'muted'} role={state.message.kind === 'error' ? 'alert' : 'status'} data-testid="load-message">
          {state.message.text}
        </p>
      )}
    </section>
  );
}
