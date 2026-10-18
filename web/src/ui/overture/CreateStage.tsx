// The Create screen as one open playground (no panels to open or close), in the spirit of gesturesynth: one hand
// says WHAT, the other HOW, a legend always in view with the active gesture lit, and a readable readout of what is
// sounding. The controls are the Create module's own screen (CreatePanel keeps every control and its data-testid);
// this file gives them their places: hum rings and the heard note on the left, instruments and the big Record button
// in the middle, the layers strip under them, the save line bottom right. ModeVisual draws the rings on its canvas
// at HUM_RINGS so they sit right above the "Hum something" words.
import { apiFetch } from '@/app/api-fetch';
import { PanelBoundary } from '@/app/PanelBoundary';
import { CreatePanel } from '@/modules/create';
import './create-stage.css';

/** Where the hum rings are drawn (window pixels, laptops and up): the middle of the hum column's top part. */
export const HUM_RINGS = { cx: 198, cy: 344, r: 80 };

export function CreateStage() {
  return (
    <PanelBoundary name="Create">
      <CreatePanel fetchFn={apiFetch} />
    </PanelBoundary>
  );
}
