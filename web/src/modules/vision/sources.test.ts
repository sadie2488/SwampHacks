import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FACE_MODEL_URL, HAND_MODEL_URL } from './protocol';
import { LOCAL_FACE_MODEL_URL, LOCAL_HAND_MODEL_URL, LOCAL_WASM, readLocal } from './sources';

const answer = (status: number, type: string) => vi.fn(async () => new Response(null, { status, headers: { 'content-type': type } }));

describe('local-first tracking files', () => {
  it('looks for the models in /models/ and the wasm inside the website', () => {
    expect(LOCAL_HAND_MODEL_URL).toBe('/models/hand_landmarker.task');
    expect(LOCAL_FACE_MODEL_URL).toBe('/models/face_landmarker.task');
    expect(LOCAL_WASM.wasmLoaderPath).toMatch(/vision_wasm_internal.*\.js/);
    expect(LOCAL_WASM.wasmBinaryPath).toMatch(/vision_wasm_internal.*\.wasm/);
    expect(LOCAL_WASM.wasmLoaderPath.startsWith('http')).toBe(false);
  });

  it('reads a local file that is really there, in one request', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
    expect(Array.from((await readLocal(LOCAL_HAND_MODEL_URL, f))!)).toEqual([1, 2, 3]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('says "missing" when the file is not there, the page answers instead, or the request fails', async () => {
    expect(await readLocal(LOCAL_FACE_MODEL_URL, answer(404, 'text/plain'))).toBeNull();
    // the dev server answers a missing file with index.html and status 200
    expect(await readLocal(LOCAL_FACE_MODEL_URL, answer(200, 'text/html'))).toBeNull();
    expect(await readLocal(LOCAL_FACE_MODEL_URL, vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))).toBeNull();
  });

  it('the download script fetches the same model addresses the app falls back to', () => {
    const script = readFileSync(new URL('./fetch-models.mjs', import.meta.url), 'utf8');
    expect(script).toContain(HAND_MODEL_URL);
    expect(script).toContain(FACE_MODEL_URL);
  });
});
