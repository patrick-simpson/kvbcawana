import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Second lock on the privacy invariant (the first is the eslint
// no-restricted-imports rule): the ONLY file allowed to touch pusher-js
// is src/hooks/useSocket.js, where every event is bound through its
// strict allowlist sanitizer. Any other import would open a path for
// unsanitized payloads to reach the screen.

const SRC_ROOT = join(__dirname, '..');
const ALLOWED = ['hooks/useSocket.js'];

// Test files are excluded, and the reason is not convenience. This guard exists
// to keep a second Pusher stack out of the SHIPPED BUNDLE, where it would bypass
// the sanitizers. A test's `vi.mock('pusher-js', …)` does the opposite: it
// replaces the transport with a fake so no real socket is ever opened, which is
// how the sealed-transport tests drive frames through the real binding. Test
// files are not in the bundle, so they cannot carry the risk this guards.
const isTest = (rel) => /\.test\.(js|jsx)$/.test(rel);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('privacy guard: pusher-js import surface', () => {
  it('only useSocket.js imports pusher-js', () => {
    const offenders = walk(SRC_ROOT)
      .map((file) => relative(SRC_ROOT, file))
      .filter((rel) => !ALLOWED.includes(rel) && !isTest(rel))
      .filter((rel) => /['"]pusher-js['"]/.test(readFileSync(join(SRC_ROOT, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('every test that touches pusher-js only MOCKS it', () => {
    // The exclusion above is only safe while it stays true. A test that
    // constructs a real Pusher would be a genuine second stack, mocked or not.
    const tests = walk(SRC_ROOT)
      .map((file) => relative(SRC_ROOT, file))
      .filter((rel) => isTest(rel))
      .filter((rel) => /['"]pusher-js['"]/.test(readFileSync(join(SRC_ROOT, rel), 'utf8')));
    for (const rel of tests) {
      const src = readFileSync(join(SRC_ROOT, rel), 'utf8');
      expect(src, `${rel} references pusher-js without mocking it`)
        .toMatch(/vi\.(mock|doMock)\(\s*['"]pusher-js['"]/);
      expect(src, `${rel} imports pusher-js for real`)
        .not.toMatch(/^\s*import\s+[^;]*from\s+['"]pusher-js['"]/m);
    }
  });
});
