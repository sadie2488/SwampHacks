// Where the tracking worker gets its files: copies on this computer first, the internet only if a copy is missing.
// The wasm files ship inside the website (Vite copies them from node_modules on every build and serves them in dev).
// The two models come from web/public/models/, filled once by `node web/src/modules/vision/fetch-models.mjs`.
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { FilesetResolver } from '@mediapipe/tasks-vision';

export type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

const base = import.meta.env?.BASE_URL ?? '/';
export const LOCAL_HAND_MODEL_URL = `${base}models/hand_landmarker.task`;
export const LOCAL_FACE_MODEL_URL = `${base}models/face_landmarker.task`;
export const LOCAL_WASM: Fileset = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl };

/**
 * The bytes of a file on this computer, or null when it isn't there. The dev server answers a missing file with the
 * page itself (200, text/html) instead of a 404, so the console stays free of red lines; that answer counts as missing.
 * One plain GET: a HEAD check first showed up in Chrome as an aborted request.
 */
export async function readLocal(url: string, fetcher: typeof fetch = fetch): Promise<Uint8Array | null> {
  try {
    const res = await fetcher(url);
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** The wasm inside the website, unless this computer lacks SIMD (then only the internet has the right version). */
export async function localWasm(): Promise<Fileset | null> {
  return (await FilesetResolver.isSimdSupported()) ? LOCAL_WASM : null;
}

/** The internet copy of the wasm. */
export const remoteWasm = (remoteBase: string): Promise<Fileset> => FilesetResolver.forVisionTasks(remoteBase);
