// PreToolUse on Read. Keys and passwords are never read into the chat.
import { activeOverride, block, readInput, repoRoot, ruleAllowed } from './lib.mjs';

try {
  const input = readInput();
  const ti = input.tool_input || {};
  const p = String(ti.file_path ?? ti.path ?? '').replace(/\\/g, '/');
  const base = p.split('/').pop() || '';
  const isEnv = /^\.env(\..+)?$/i.test(base) && !/^\.env\.(example|sample|template)$/i.test(base);
  const isKeyDir = /(^|\/)\.(ssh|aws|gnupg)(\/|$)/.test(p);
  const isKeyFile = /^id_(rsa|ed25519|ecdsa|dsa)$/i.test(base) || /\.(pem|key|p12|pfx)$/i.test(base) || /^relay\.private\.json$/i.test(base);
  if ((isEnv || isKeyDir || isKeyFile) && !ruleAllowed(activeOverride(repoRoot(input)), 'read-secrets')) {
    block(`"${base}" holds secrets, so I won't read it. Type keys yourself into the private file; never paste them into chat. (.env.example is fine to read.)`);
  }
  process.exit(0);
} catch (e) {
  block(`The secrets guard hit an error (${e.message}), so I stopped to be safe. Tell the lead.`);
}
