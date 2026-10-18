// Play mode loops the song: on arriving in Play (tab, sign, hand click, record) and whenever a song loads while Play is
// open, loop is turned on through the normal command path. Leaving Play leaves loop as it is, and the Loop button can
// still turn it off while in Play.
import { useEffect } from 'react';
import { bus, resumeAudio, sendCommand } from '@/bus';
import type { Screen } from '@/ui/overture/modes';
import { loadDemo } from './song-loader';
import { publishSong } from './SongLoader';

/** True while the Play mode itself is on screen (not the menu, the entrance, or the Command Lab). */
export const autoLoops = (screen: Screen, tab: string): boolean => screen === 'mode' && tab === 'play';

const loopOn = () => sendCommand('playback.loop', 'button', { how: 'set', value: true });

/** Turn loop on now and again after every song load. Returns a function that stops listening. */
export function startPlayLoop(): () => void {
  loopOn();
  return bus.on('analysis', loopOn);
}

/**
 * Play has no song picker, so when it opens with no song loaded the demo song is loaded, the same way the
 * "Use demo song" button does it. Returns a function that drops the result if Play is left before it arrives.
 */
export function ensureSongLoaded(load: () => Promise<Parameters<typeof publishSong>[0]> = () => loadDemo()): () => void {
  if (bus.last('transport')?.loaded) return () => undefined;
  let live = true;
  void (async () => {
    await resumeAudio().catch(() => undefined);
    try {
      const song = await load();
      if (live && !bus.last('transport')?.loaded) publishSong(song);
    } catch (e) {
      console.error('[app] could not load the demo song for Play', e);
    }
  })();
  return () => void (live = false);
}

/** While `on`, keep the song looping (see startPlayLoop) and make sure there is a song to conduct. */
export function usePlayLoop(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const stopLoop = startPlayLoop();
    const stopLoad = ensureSongLoaded();
    return () => {
      stopLoop();
      stopLoad();
    };
  }, [on]);
}
