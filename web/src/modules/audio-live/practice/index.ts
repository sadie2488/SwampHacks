// Practice mode: compare the player with the song and coach them. See controller.ts for the story.
export { startPracticeController, createPracticeController, setFakeScript } from './controller';
export type { PracticeController, PracticeDeps } from './controller';
export { computeCalibration, runCalibration, CALIBRATION_PROBLEM } from './calibration';
export type { CalibrationEnv, CalibrationResult } from './calibration';
export { compareNotes, timingClass } from './compare';
export type { CompareOptions, CompareResult, ExpectedNote, NoteResult, PlayedNote } from './compare';
export { buildFeedback } from './feedback';
export { melodyOf } from './melody';
export { FAKE_SESSION_ID, feedScriptedPerformance, playedToEvents, scriptPlayed } from './script';
export type { ScriptOptions } from './script';
