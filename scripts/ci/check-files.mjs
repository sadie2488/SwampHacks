// CI: no big files, no datasets / audio / video / model weights, and no secrets files in git.
// Those belong in Vultr storage or in the private .env, never in this public repo.
// Env: BASE_SHA, HEAD_SHA, PR_BODY (for "Override:" lines).
import { changedFiles, fail, git, isSecretPath, matchesAny, parseOverrides, requireEnv } from './lib.mjs';

requireEnv('BASE_SHA', 'HEAD_SHA');
const { BASE_SHA, HEAD_SHA, PR_BODY = '' } = process.env;
const MAX_BYTES = 5 * 1024 * 1024;
const BLOCKED_EXT = /\.(wav|mp3|flac|ogg|m4a|aac|mp4|mov|webm|avi|mkv|y4m|pt|pth|ckpt|onnx|safetensors|h5|npy|npz|pkl|zip|tar|gz|7z)$/i;
const BLOCKED_DIR = /^(data|models)\/|(^|\/)(datasets|checkpoints|weights)\//i;

const overrides = parseOverrides(PR_BODY);
const problems = [];
for (const { path } of changedFiles(BASE_SHA, HEAD_SHA, 'AMT')) {
  if (overrides.some((o) => matchesAny(path, [o.glob]))) continue;
  if (isSecretPath(path)) {
    problems.push(`${path}: looks like a secrets file. Remove it from git, keep it in the private file, and rotate any key that was in it.`);
    continue;
  }
  if (BLOCKED_EXT.test(path) || BLOCKED_DIR.test(path)) {
    problems.push(`${path}: datasets, audio, video, archives and model weights never go in git. Upload to Vultr storage instead.`);
    continue;
  }
  let size = 0;
  try {
    size = Number(git('cat-file', '-s', `${HEAD_SHA}:${path}`));
  } catch {
    continue; // submodule or similar
  }
  if (size > MAX_BYTES) problems.push(`${path}: ${(size / 1048576).toFixed(1)} MB is over the 5 MB limit. Keep big files in Vultr storage.`);
}

if (problems.length) {
  fail('Files that do not belong in git', `${problems.length} problem(s):\n${problems.slice(0, 20).join('\n')}\nIf a person really approves one, add to the pull request text:  Override: <path> | approved by <name>`);
  process.exit(1);
}
console.log('files ok: sizes, types and secrets');
