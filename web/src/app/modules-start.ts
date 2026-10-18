// Starts every module once. A module that fails to start must not take the page down with it.
import { useEffect } from 'react';
import { reportStatus, type Stop } from '@/bus';
import { start as startAudioLive } from '@/modules/audio-live';
import { start as startCommands } from '@/modules/commands';
import { start as startCreate } from '@/modules/create';
import { start as startPlayback } from '@/modules/playback';
import { start as startTouchDesigner } from '@/modules/touchdesigner';
import { start as startVision } from '@/modules/vision';

const MODULES: Array<[name: string, start: () => Stop]> = [
  ['playback', startPlayback],
  ['commands', startCommands],
  ['vision', startVision],
  ['audio-live', startAudioLive],
  ['touchdesigner', startTouchDesigner],
  ['create', startCreate],
];

export function useModules(): void {
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
}
