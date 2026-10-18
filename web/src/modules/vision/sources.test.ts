import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FACE_MODEL_URL, HAND_MODEL_URL } from './protocol';
import { LOCAL_FACE_MODEL_URL, LOCAL_HAND_MODEL_URL, LOCAL_WASM, isThere, pick } from './sources';

const answer = (status: number, type: string) => vi.fn(async () => new Response(null, { status, headers: { 'content-type': type } }));

describe('local-first tracking files', () => {
  it('looks for the models in /models/ and the wasm inside the website', () => {
    expect(LOCAL_HAND_MODEL_URL).toBe('/models/hand_landmarker.task');
    expect(LOCAL_FACE_MODEL_URL).toBe('/models/face_landmarker.task');
    expect(LOCAL_WASM.wasmLoaderPath).toMatch(/vision_wasm_internal.*\.js/);
    expect(LOCAL_WASM.wasmBinaryPath).toMatch(/vision_wasm_internal.*\.wasm/);
    expect(LOCAL_WASM.wasmLoaderPath.startsWith('http')).toBe(false);
  });

  it('uses a local file that is really there, asking with HEAD only', async () => {
    const f = answer(200, 'application/octet-stream');
    expect(await pick(LOCAL_HAND_MODEL_URL, HAND_MODEL_URL, f)).toBe(LOCAL_HAND_MODEL_URL);
    expect(f).toHaveBeenCalledWith(LOCAL_HAND_MODEL_URL, expect.objectContaining({ method: 'HEAD' }));
  });

  it('falls back to the internet when the local file is missing, answered by the page, or the request fails', async () => {
    expect(await pick(LOCAL_FACE_MODEL_URL, FACE_MODEL_URL, answer(404, 'text/plain'))).toBe(FACE_MODEL_URL);
    // the dev server answers a missing file with index.html and status 200
    expect(await pick(LOCAL_FACE_MODEL_URL, FACE_MODEL_URL, answer(200, 'text/html'))).toBe(FACE_MODEL_URL);
    const offline = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await isThere(LOCAL_FACE_MODEL_URL, offline)).toBe(false);
  });

  it('the download script fetches the same model addresses the app falls back to', () => {
    const script = readFileSync(new URL('./fetch-models.mjs', import.meta.url), 'utf8');
    expect(script).toContain(HAND_MODEL_URL);
    expect(script).toContain(FACE_MODEL_URL);
  });
});
