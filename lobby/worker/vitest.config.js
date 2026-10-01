// The sync Worker's own tests: pure Node (WebCrypto and fetch are global
// there). They run in deploy-worker.yml, not in the website's deploy gate, so
// a Worker test can never block a site redeploy (root `eslint .` still lints
// worker/).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
