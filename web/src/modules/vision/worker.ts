// Background worker: runs MediaPipe hand and face tracking on frames sent by the page, so the page itself stays smooth.
// It only finds points. What they mean (fist, tilt, ...) is worked out in gestures.ts on the page side.
import { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import { MODEL_DOWNLOAD_MESSAGE, type FromWorker, type ToWorker } from './protocol';
import { LOCAL_FACE_MODEL_URL, LOCAL_HAND_MODEL_URL, pick, pickWasm, type Fileset } from './sources';
import type { RawHand } from './gestures';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromWorker): void => ctx.postMessage(m);

/** A file we needed from the internet didn't arrive. */
class DownloadError extends Error {}

// MediaPipe loads its wasm helper script with importScripts(), which module workers don't allow. For that case it calls
// self.import(url) if we provide one. We fetch the script and run it in the global scope (it sets self.ModuleFactory).
(self as unknown as { import: (url: string) => Promise<void> }).import = async (url: string) => {
  let code: string;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new DownloadError(`HTTP ${res.status} for ${url}`);
    code = await res.text();
  } catch (e) {
    throw e instanceof DownloadError ? e : new DownloadError(String(e));
  }
  (0, eval)(code);
};

async function download(url: string): Promise<Uint8Array> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new DownloadError(`HTTP ${res.status} for ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw e instanceof DownloadError ? e : new DownloadError(String(e));
  }
}

/** The copy on this computer when there is one (see sources.ts), else the internet copy. */
async function localFirst(local: string, remote: string): Promise<{ bytes: Uint8Array; local: boolean }> {
  const url = await pick(local, remote);
  if (url === local) {
    try {
      return { bytes: await download(local), local: true };
    } catch {
      // the local copy vanished or broke: use the internet one
    }
  }
  return { bytes: await download(remote), local: false };
}

let hands: HandLandmarker | null = null;
let face: FaceLandmarker | null = null;
let files: { handModel: Uint8Array; faceModel: Uint8Array; fileset: Fileset } | null = null;
let delegate: 'GPU' | 'CPU' = 'CPU';
let switching = false;
let lastStamp = 0;
let failures = 0;

function closeModels(): void {
  for (const m of [hands, face]) {
    try {
      m?.close();
    } catch {
      // already gone
    }
  }
  hands = face = null;
}

/** (Re)create both models on the graphics card (GPU) or the processor (CPU). */
async function build(d: 'GPU' | 'CPU'): Promise<void> {
  if (!files) throw new Error('models not downloaded yet');
  closeModels();
  // One after the other: both load the same wasm helper script into this worker.
  hands = await HandLandmarker.createFromOptions(files.fileset, { baseOptions: { modelAssetBuffer: files.handModel, delegate: d }, runningMode: 'VIDEO', numHands: 2 });
  face = await FaceLandmarker.createFromOptions(files.fileset, { baseOptions: { modelAssetBuffer: files.faceModel, delegate: d }, runningMode: 'VIDEO', numFaces: 1 });
  delegate = d;
}

async function init(m: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  try {
    const [handModel, faceModel, wasm] = await Promise.all([
      localFirst(LOCAL_HAND_MODEL_URL, m.handModelUrl),
      localFirst(LOCAL_FACE_MODEL_URL, m.faceModelUrl),
      pickWasm(m.wasmUrl),
    ]);
    console.info(`[vision worker] files: models ${handModel.local && faceModel.local ? 'from this computer' : 'from the internet'}, engine ${wasm.local ? 'from this computer' : 'from the internet'}`);
    files = { handModel: handModel.bytes, faceModel: faceModel.bytes, fileset: wasm.fileset };
    // The graphics card is much faster when it works; if it doesn't on this computer, fall back to the processor.
    const order: Array<'GPU' | 'CPU'> = m.delegate === 'CPU' ? ['CPU'] : m.delegate === 'GPU' ? ['GPU'] : ['GPU', 'CPU'];
    let problem: unknown;
    for (const d of order) {
      try {
        await build(d);
        problem = undefined;
        break;
      } catch (e) {
        problem = e;
        console.warn(`[vision worker] ${d} tracking did not start`, e);
      }
    }
    if (problem) throw problem;
    post({ type: 'ready', delegate });
  } catch (e) {
    console.error('[vision worker] could not start', e);
    post({ type: 'error', message: e instanceof DownloadError ? MODEL_DOWNLOAD_MESSAGE : `the tracking engine failed to load (${e instanceof Error ? e.message : String(e)})` });
  }
}

function track(bitmap: ImageBitmap, t_ms: number): void {
  if (!hands || !face || switching) {
    bitmap.close();
    post({ type: 'dropped' });
    return;
  }
  try {
    // MediaPipe wants times that always go up.
    const stamp = Math.max(Math.round(t_ms), lastStamp + 1);
    lastStamp = stamp;
    const t0 = performance.now();
    const h = hands.detectForVideo(bitmap, stamp);
    const t1 = performance.now();
    const f = face.detectForVideo(bitmap, stamp);
    const t2 = performance.now();
    const rawHands: RawHand[] = h.landmarks.map((points, i) => {
      const guess = (h.handedness[i] ?? [])[0];
      return { label: guess?.categoryName === 'Right' ? 'Right' : 'Left', score: guess?.score ?? 0.5, points: points.map((p) => ({ x: p.x, y: p.y, z: p.z })) };
    });
    const facePoints = f.faceLandmarks[0]?.map((p) => ({ x: p.x, y: p.y, z: p.z })) ?? null;
    failures = 0;
    post({ type: 'result', t_ms, width: bitmap.width, height: bitmap.height, hands: rawHands, face: facePoints, timing: { hand: t1 - t0, face: t2 - t1 } });
  } catch (e) {
    console.error('[vision worker] a frame failed', e);
    failures++;
    if (delegate === 'GPU' && failures >= 3) {
      // The graphics card path keeps failing: switch to the processor and carry on.
      switching = true;
      failures = 0;
      build('CPU')
        .catch((err) => post({ type: 'error', message: `the tracking engine could not switch to the processor (${err instanceof Error ? err.message : String(err)})` }))
        .finally(() => (switching = false));
      post({ type: 'dropped' });
    } else if (failures >= 10) {
      // One bad frame is fine; many in a row means something is really wrong.
      const why = e instanceof Error ? e.message : String(e);
      post({
        type: 'error',
        message: /activeTexture|webgl|\bgl\b/i.test(why)
          ? 'this browser cannot draw the graphics tracking needs (WebGL). In Chrome settings turn on "Use graphics acceleration when available", then reload'
          : `the tracking engine kept failing (${why})`,
      });
    } else post({ type: 'dropped' });
  } finally {
    bitmap.close();
  }
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'init') void init(m);
  else if (m.type === 'frame') track(m.bitmap, m.t_ms);
};
