// The sync Worker's lint (it moved out of lobby/ to the repo root on
// 2026-10-16 and brought the lobby's rules for plain JS with it).
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '.wrangler/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
