// The desktop app's own unit tests: pure Node, no jsdom. They run in the
// desktop release pipeline (build-desktop.yml), not in the website's deploy
// gate, so a desktop test can never block an urgent site redeploy (the
// root `eslint .` does still lint desktop/).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['src/**/*.test.js'],
    environment: 'node',
  },
});
