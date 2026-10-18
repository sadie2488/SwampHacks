// How a command changes a control's value. One implementation shared by everyone, so "nudge tempo down" is
// computed once (not once per module) and clamped to the catalog's range.
import { controlInfo } from '@/contracts/catalogs';
import type { CommandEvent, ControlInfo, ControlValue } from '@/contracts';

export type ControlState = Record<string, ControlValue>;

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Drops floating-point noise (0.30000000000000004 -> 0.3) so values like tempo 1 come back exactly. */
export const trimFloat = (n: number) => Number(n.toFixed(6));

/**
 * Rounds to the nearest multiple of `step` (and drops float noise). Without this, 5 taps of "faster" then 5 of
 * "slower" ends at 0.9999999999999997, and the playback engine never returns to its clean path at exactly 1.
 */
export function snapToStep(n: number, step: number): number {
  const size = Math.abs(step);
  return trimFloat(size > 0 && Number.isFinite(size) ? Math.round(n / size) * size : n);
}

/** Starting values: every control that has a default in contracts/control-catalog.json. */
export function defaultControls(controls: ControlInfo[]): ControlState {
  const out: ControlState = {};
  for (const c of controls) if (c.default !== undefined) out[c.id] = c.default;
  return out;
}

/**
 * The new value of one control after a command, or undefined when the command changes no stored value
 * (a trigger such as playback.pause, an unknown control, or a value that makes no sense for the control).
 */
export function nextControlValue(current: ControlValue | undefined, cmd: CommandEvent, info: ControlInfo | undefined = controlInfo(cmd.command)): ControlValue | undefined {
  if (!info || info.kind === 'trigger') return undefined;
  const cur = current ?? info.default;
  if (info.kind === 'toggle') {
    return typeof cmd.value === 'boolean' ? cmd.value : cur !== true;
  }
  // kind === 'value'
  const type = info.value_type ?? 'number';
  if (type === 'number') {
    const [lo, hi] = info.range ?? [-Infinity, Infinity];
    if (cmd.how === 'nudge') {
      const step = typeof cmd.value === 'number' ? cmd.value : info.step ?? 0;
      return typeof cur === 'number' ? clamp(snapToStep(cur + step, step), lo, hi) : undefined;
    }
    // Set and follow values are not snapped to the step: sliders and hand movement need finer values than the step.
    return typeof cmd.value === 'number' && Number.isFinite(cmd.value) ? clamp(trimFloat(cmd.value), lo, hi) : undefined;
  }
  if (type === 'string') {
    if (typeof cmd.value !== 'string') return undefined;
    return info.options && !info.options.includes(cmd.value) ? undefined : cmd.value;
  }
  // range: [start, end] in seconds
  if (Array.isArray(cmd.value) && cmd.value.length === 2 && cmd.value.every((n) => typeof n === 'number')) {
    const [a, b] = cmd.value as [number, number];
    return a <= b ? [a, b] : [b, a];
  }
  return undefined;
}
