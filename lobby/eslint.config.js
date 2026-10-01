import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/', 'node_modules/', 'desktop/node_modules/', 'desktop/release/', 'worker/node_modules/', 'worker/.wrangler/', 'public/', 'coverage/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // PRIVACY INVARIANT (see CLAUDE.md): all realtime data must flow
      // through the sanitized socket in src/hooks/useSocket.js. A second
      // Pusher stack anywhere else would bypass the per-event allowlist
      // sanitizers, so importing pusher-js is mechanically forbidden.
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'pusher-js',
          message: 'Realtime data must flow through the sanitized socket — use src/hooks/useSocket.js instead of importing pusher-js directly.',
        }],
      }],
    },
  },
  {
    // The one sanctioned pusher-js import site.
    files: ['src/hooks/useSocket.js'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // CLI scripts (the nightly calendar-feed builder) report via stdout.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-console': 'off' },
  },
  {
    // Playwright specs run in Node, drive a browser, and log freely.
    files: ['e2e/**/*.js', 'playwright.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    // The service worker runs in its own global scope.
    files: ['src/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: {
      // __PRECACHE_MANIFEST__ is replaced at build time.
      'no-undef': 'off',
    },
  },
];
