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
    // Setting "deny" replaces Vite's own list, so its defaults are repeated here, plus the private files of this project.
    fs: {
      allow: [here('..')],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.private.json', '**/relay.private.json'],
    },
    // API_PROXY lets a second copy of the app talk to a second copy of the server (the lead's tests do this)
    proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:8000' },
  },
  worker: { format: 'es' },
  // Camera tracking is only imported inside its worker, which Vite's startup scan does not read. Without this line Vite
  // finds it the first time the camera turns on and reloads every open page, which drops the loaded song.
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Generous: a laptop running many things at once (builds, helpers, the browser) can make a 1-second test take 6.
    testTimeout: 20_000,
  },
});
