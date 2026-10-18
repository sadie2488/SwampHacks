// Play mode loops the song: on arriving in Play (tab, sign, hand click, record) and whenever a song loads while Play is
// open, loop is turned on through the normal command path. Leaving Play leaves loop as it is, and the Loop button can
// still turn it off while in Play.
import { useEffect } from 'react';
import { bus, sendCommand } from '@/bus';
import type { Screen } from '@/ui/overture/modes';

/** True while the Play mode itself is on screen (not the menu, the entrance, or the Command Lab). */
export const autoLoops = (screen: Screen, tab: string): boolean => screen === 'mode' && tab === 'play';

const loopOn = () => sendCommand('playback.loop', 'button', { how: 'set', value: true });

/** Turn loop on now and again after every song load. Returns a function that stops listening. */
export function startPlayLoop(): () => void {
  loopOn();
  return bus.on('analysis', loopOn);
}

/** While `on`, keep the song looping (see startPlayLoop). */
export function usePlayLoop(on: boolean): void {
  useEffect(() => (on ? startPlayLoop() : undefined), [on]);
}
