// Messages between the page (index.ts) and the tracking worker (worker.ts), plus the places the models come from.
// Nothing is vendored into git: the wasm and the model files are fetched from public CDNs the first time the camera starts.
import type { Pt, RawHand } from './gestures';

/** Must match the installed @mediapipe/tasks-vision (a test checks this against node_modules). */
export const TASKS_VISION_VERSION = '1.1.1';
export const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
export const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Frames per second sent to the worker. */
export const TRACKING_FPS = 15;

export type ToWorker =
  | { type: 'init'; wasmUrl: string; handModelUrl: string; faceModelUrl: string; delegate?: 'auto' | 'CPU' | 'GPU' }
  | { type: 'frame'; bitmap: ImageBitmap; t_ms: number };

export type FromWorker =
  /** Tracking is loaded; `delegate` says whether it runs on the graphics card or the processor. */
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'error'; message: string }
  /** This frame couldn't be read; the worker is still fine. */
  | { type: 'dropped' }
  | {
      type: 'result';
      /** The t_ms the frame was sent with. */
      t_ms: number;
      width: number;
      height: number;
      /** Straight from MediaPipe: x not mirrored. gestures.assignSides() flips x and decides left/right. */
      hands: RawHand[];
      face: Pt[] | null;
      /** How long each model took on this frame, in milliseconds. */
      timing?: { hand: number; face: number };
    };

/** The reasons the worker sends in its "error" messages are short phrases: index.ts wraps them in a full sentence for the person. */
export const MODEL_DOWNLOAD_MESSAGE = 'the tracking model could not be downloaded';
