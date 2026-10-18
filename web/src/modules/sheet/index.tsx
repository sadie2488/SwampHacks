// Sheet-music view (shell lane). Other modules only import this file: `import { Sheet } from '@/modules/sheet'`.
// The bar grid is shared so practice feedback numbers bars exactly like the sheet does.
export { Sheet } from './Sheet';
export { notesToMusicXml } from './notes-to-musicxml';
export { barAt, barOfQuarter, barStartAt, beatsPerBar, quartersPerBar, quartersPerBeat, sheetGrid, type SheetGrid } from './bar-grid';
export { DEFAULT_LEARN_VIEW, learnView, setLetters, type LearnView } from './learn-view';
