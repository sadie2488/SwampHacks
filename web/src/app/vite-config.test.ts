// The dev server may read files from the whole repo, so private files must stay on the deny list.
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';

async function resolved() {
  // defineConfig may hand back a plain object or a function that makes one
  const exported: unknown = config;
  const c = typeof exported === 'function' ? await exported({ command: 'serve', mode: 'development' }) : await exported;
  return c as { server?: { fs?: { allow?: string[]; deny?: string[] } } };
}

describe('dev server file safety', () => {
  it('keeps Vite\'s own deny list and adds the private files', async () => {
    const deny = (await resolved()).server?.fs?.deny ?? [];
    for (const pattern of ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.private.json', '**/relay.private.json']) {
      expect(deny).toContain(pattern);
    }
  });

  it('still allows files from the repo (the contracts and fixtures folders)', async () => {
    expect((await resolved()).server?.fs?.allow?.length).toBeGreaterThan(0);
  });
});
