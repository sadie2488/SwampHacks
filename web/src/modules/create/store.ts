// A tiny store around the layers reducer, so the state lives outside React and can be tested without a screen.
import { initialState, reduce, type Action, type CreateState } from './layers';

export interface CreateStore {
  getState(): CreateState;
  dispatch(action: Action): CreateState;
  /** Called after every change. Returns a function that stops listening. */
  subscribe(listener: (state: CreateState) => void): () => void;
}

export function createStore(initial: CreateState = initialState()): CreateStore {
  let state = initial;
  const listeners = new Set<(s: CreateState) => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduce(state, action);
      if (next !== state) {
        state = next;
        for (const l of [...listeners]) l(state);
      }
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
