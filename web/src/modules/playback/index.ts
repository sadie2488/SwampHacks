// Stub for the "playback" module. Replace with the real thing. Contract: start() begins listening to the bus and
// returns a function that stops it. Devices (camera, mic) only start after a bus "enable" event.
import type { Stop } from '@/bus';

export function start(): Stop {
  return () => {};
}
