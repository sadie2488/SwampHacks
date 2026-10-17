// Where the text of mappings.yaml comes from, with live reload.
// When you save mappings.yaml while the app is running, Vite hands us the new text and everyone listening gets it,
// so rule changes apply instantly with no page reload. Used by the mapping engine and the Command Lab (same lane).
import initialText from './mappings.yaml?raw';

let text: string = initialText;
const listeners = new Set<(text: string) => void>();

/** The current text of mappings.yaml. */
export const getMappingsText = (): string => text;

/** Call back whenever the file changes. Returns a function that stops listening. */
export function onMappingsText(listener: (text: string) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Replace the text (used by the live reload below, and handy in tests). */
export function setMappingsText(next: string): void {
  text = next;
  for (const l of [...listeners]) l(next);
}

import.meta.hot?.accept('./mappings.yaml?raw', (mod) => {
  if (mod && typeof mod.default === 'string') setMappingsText(mod.default);
});
