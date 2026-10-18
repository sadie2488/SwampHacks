// Downloads the two camera tracking models once into web/public/models/, so hand tracking works without internet.
// Run from anywhere: node web/src/modules/vision/fetch-models.mjs
// The files are big and never go in git (the .gitignore line "models/" covers this folder).
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep in step with HAND_MODEL_URL and FACE_MODEL_URL in protocol.ts (a test checks this).
const MODELS = [
  { file: 'hand_landmarker.task', url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' },
  { file: 'face_landmarker.task', url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
];

const here = dirname(fileURLToPath(import.meta.url));
const folder = join(here, '..', '..', '..', 'public', 'models');
const shown = (p) => relative(process.cwd(), p) || '.';

async function fetchOne({ file, url }) {
  const target = join(folder, file);
  if (existsSync(target) && statSync(target).size > 0) {
    console.log(`- ${file}: already there, skipped`);
    return true;
  }
  console.log(`- ${file}: downloading...`);
  let bytes;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    const why = e instanceof Error ? (e.cause?.code ?? e.message) : String(e);
    console.log(`- ${file}: could not download it (${why}). Are you online?`);
    return false;
  }
  // Write to a side file first, so a half-finished download never looks like a finished one.
  writeFileSync(`${target}.part`, bytes);
  renameSync(`${target}.part`, target);
  console.log(`- ${file}: saved (${(bytes.length / 1e6).toFixed(1)} MB)`);
  return true;
}

async function main() {
  mkdirSync(folder, { recursive: true });
  console.log(`Camera tracking models -> ${shown(folder)}`);
  let ok = true;
  for (const m of MODELS) ok = (await fetchOne(m)) && ok;
  if (ok) console.log('Done. Hand tracking will now load from this computer.');
  else {
    console.log('Some models are missing. The app still works online (it downloads them itself). Try again with internet.');
    process.exitCode = 1;
  }
}

await main();
