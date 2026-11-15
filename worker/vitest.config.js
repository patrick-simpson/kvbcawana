// The sync Worker's own tests (`npm test` here): pure Node (WebCrypto and fetch are global
// there). They run in ci.yml, not in the website's deploy gate, so
// a Worker test can never block a site redeploy (`npm run lint` lints
// worker/).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // fileURLToPath, not `.pathname`: on Windows a URL's pathname is "/C:/...", which
    // vitest read as "C:/C:/..." and found no test files (owner's PC, 2026-11-15).
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
