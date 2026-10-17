import { useEffect, useState } from 'react';
import { bus, getStatus, resumeAudio, type ModuleStatus, type Topics } from '@/bus';

/** The latest value of a bus topic (undefined until something is published). Re-renders when it changes. */
export function useBusValue<K extends keyof Topics>(topic: K): Topics[K] | undefined {
  const [value, setValue] = useState<Topics[K] | undefined>(() => bus.last(topic));
  useEffect(() => bus.on(topic, (v) => setValue(() => v), { replay: true }), [topic]);
  return value;
}

/** The latest status one module has reported (undefined until it says something). Starts from what the bus already knows. */
export function useModuleStatus(module: string): ModuleStatus | undefined {
  const [status, setStatus] = useState<ModuleStatus | undefined>(() => getStatus(module));
  useEffect(() => {
    setStatus(getStatus(module));
    return bus.on('status', (s) => {
      if (s.module === module) setStatus(s);
    });
  }, [module]);
  return status;
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
