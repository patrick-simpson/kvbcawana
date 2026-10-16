// The sync Worker's own tests (`npm test` here): pure Node (WebCrypto and fetch are global
// there). They run in ci.yml, not in the website's deploy gate, so
// a Worker test can never block a site redeploy (`npm run lint` lints
// worker/).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
