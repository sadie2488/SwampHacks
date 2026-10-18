// @vitest-environment jsdom
// The hold ring shows only while a hold is filling, in the target mode's name and ink.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bus } from '@/bus';
import type {} from '@/modules/commands';
import { HoldRing } from './HoldRing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const ring = () => container.querySelector<HTMLElement>('[data-testid="hold-ring"]');
const hold = (progress: number, value = 'play') =>
  act(async () => bus.emit('holdProgress', { rule: 'hold Y to go to Play', control: 'app.mode', value, progress }));

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<HoldRing />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('HoldRing', () => {
  it('shows nothing until a hold starts', () => {
    expect(ring()).toBeNull();
  });

  it('shows the mode name and ink while filling, and hides at 0', async () => {
    await hold(0.25);
    expect(ring()?.textContent).toBe('Play');
    const arc = ring()!.querySelectorAll('circle')[2];
    expect(arc.getAttribute('stroke')).toBe('#ff7a00');
    await hold(0.5);
    expect(Number(arc.style.strokeDashoffset)).toBeGreaterThan(0);
    await hold(0, 'lab');
    expect(ring()).toBeNull();
    await hold(0.1, 'lab');
    expect(ring()?.textContent).toBe('Command Lab');
  });
});
