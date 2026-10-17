// How a command changes a control's value. One implementation shared by everyone, so "nudge tempo down" is
// computed once (not once per module) and clamped to the catalog's range.
import { controlInfo } from '@/contracts/catalogs';
import type { CommandEvent, ControlInfo, ControlValue } from '@/contracts';

export type ControlState = Record<string, ControlValue>;

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

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
      return typeof cur === 'number' ? clamp(cur + step, lo, hi) : undefined;
    }
    return typeof cmd.value === 'number' && Number.isFinite(cmd.value) ? clamp(cmd.value, lo, hi) : undefined;
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
