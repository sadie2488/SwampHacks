import { useEffect, useState } from 'react';
import { bus, resumeAudio, type Topics } from '@/bus';

/** The latest value of a bus topic (undefined until something is published). Re-renders when it changes. */
export function useBusValue<K extends keyof Topics>(topic: K): Topics[K] | undefined {
  const [value, setValue] = useState<Topics[K] | undefined>(() => bus.last(topic));
  useEffect(() => bus.on(topic, (v) => setValue(() => v), { replay: true }), [topic]);
  return value;
}

/** Browsers only start audio after a click: wake the shared audio engine first, then do the action. */
export async function afterAudioWakes(action: () => void): Promise<void> {
  try {
    await resumeAudio();
  } catch {
    // no audio available (or already running): the command still goes out
  }
  action();
}
