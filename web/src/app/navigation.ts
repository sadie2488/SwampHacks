// Where the shell is (entrance, record menu, or inside a mode) and what the rest of the app is told about it. Pure, so
// it can be tested without the React screen.
import type { Mode } from '@/contracts';
import type { Screen } from '@/ui/overture/modes';

/**
 * The mode published while the entrance or the record menu is showing. Learn has no hand or voice rules in
 * mappings.yaml, so only the `mode: any` rules (the sign shortcuts and the grab that enters a record) stay live, and
 * the Create controller stops its loop and recording (it stops whenever the mode is not Create). A test checks that
 * mappings.yaml still has no Learn rules.
 */
export const MENU_MODE: Mode = 'learn';

/** The mode to publish on the bus: the open mode's own, or the neutral one when no mode is on screen. */
export function publishedMode(screen: Screen, openMode: Mode): Mode {
  return screen === 'mode' ? openMode : MENU_MODE;
}

/** The section on screen (a mode tab), or null on the entrance and the record menu. */
export function shownSection<T extends string>(screen: Screen, tab: T): T | null {
  return screen === 'mode' ? tab : null;
}

/**
 * Leaving a section stops what it was doing, right away (Lalitha, Sun 5:40 AM): the song pauses (which also ends a
 * practice run) and a Create loop or recording stops. Returns the commands to send; empty when nothing was left.
 */
export function leaveSectionCommands(from: string | null, to: string | null): string[] {
  if (!from || from === to) return [];
  return from === 'create' ? ['playback.pause', 'create.loop.stop'] : ['playback.pause'];
}

/** Where the header's "Overture" logo goes: the entrance (title screen), from anywhere else. Null = stay. */
export function logoTarget(screen: Screen): Screen | null {
  return screen === 'entrance' ? null : 'entrance';
}
