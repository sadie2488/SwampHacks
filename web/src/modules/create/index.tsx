// Stub for Create mode (lane D): hum to notes, instruments, layers and loops.
import type { Stop } from '@/bus';

export function start(): Stop {
  return () => {};
}

export function CreatePanel() {
  return <div data-testid="create-panel" />;
}
