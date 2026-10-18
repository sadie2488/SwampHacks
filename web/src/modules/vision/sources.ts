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
 * True when `url` really holds a file. Asks with HEAD, so nothing big is downloaded twice. The dev server answers a
 * missing file with the page itself (200, text/html) instead of a 404, which keeps the console free of red lines;
 * that answer counts as missing too.
 */
export async function isThere(url: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/** The local copy if it is there, otherwise the internet address. */
export async function pick(local: string, remote: string, fetcher: typeof fetch = fetch): Promise<string> {
  return (await isThere(local, fetcher)) ? local : remote;
}

/** The wasm fileset: the copy inside the website, or the internet one if that copy can't be reached or SIMD is missing. */
export async function pickWasm(remoteBase: string, fetcher: typeof fetch = fetch): Promise<{ fileset: Fileset; local: boolean }> {
  if ((await FilesetResolver.isSimdSupported()) && (await isThere(LOCAL_WASM.wasmLoaderPath, fetcher))) {
    return { fileset: LOCAL_WASM, local: true };
  }
  return { fileset: await FilesetResolver.forVisionTasks(remoteBase), local: false };
}
