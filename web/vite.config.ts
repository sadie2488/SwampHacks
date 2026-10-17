import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Aliases: "@/..." = web/src, "@data/..." = the repo's contracts/ folder (catalogs as JSON),
// "@fixtures/..." = the repo's fake data. Keys never go in VITE_ variables (they ship to the browser).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@data': here('../contracts'),
      '@fixtures': here('../fixtures'),
      '@': here('./src'),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [here('..')] },
    proxy: { '/api': 'http://localhost:8000' },
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
