// The one store of layers for the running app, and the small hooks the screens read it with.
// Kept apart from index.tsx so the count-in overlay can read it without pulling in the whole panel.
import { useSyncExternalStore } from 'react';
import { initialState } from './layers';
import { createSettings } from './settings';
import { createStore } from './store';

/** The screen reads it; the controller changes it. */
export const store = createStore(initialState());
/** Snap-to-key choice and the line about the last take, shared by the screen and the controller. */
export const settings = createSettings();

const selectCountBeat = () => store.getState().countBeat ?? null;
/** The count-in number on screen right now (4, 3, 2, 1), or null when no take is counting in. */
export function useCreateCountIn(): number | null {
  return useSyncExternalStore(store.subscribe, selectCountBeat);
}
