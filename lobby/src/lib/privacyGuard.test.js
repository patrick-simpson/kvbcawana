import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Second lock on the privacy invariant (the first is the eslint
// no-restricted-imports rule): Pusher is retired and pusher-js is gone from
// package.json, and every event reaches the screen through the one live-channel
// binding in src/hooks/useSocket.js, where it is bound through its strict
// allowlist sanitizer. A second realtime stack anywhere (shipped code or a
// test double for one) would open a path for unsanitized payloads to reach the
// screen, so nothing may import or mock pusher-js again.

const SRC_ROOT = join(__dirname, '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('privacy guard: no second realtime stack', () => {
  it('no source file or test imports or mocks pusher-js', () => {
    const offenders = walk(SRC_ROOT)
      .map((file) => relative(SRC_ROOT, file))
      .filter((rel) => rel !== join('lib', 'privacyGuard.test.js'))
      .filter((rel) => /['"]pusher-js['"]/.test(readFileSync(join(SRC_ROOT, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('pusher-js is not a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(SRC_ROOT, '..', 'package.json'), 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('pusher-js');
  });

  it('only useSocket.js opens the live channel', () => {
    const offenders = walk(SRC_ROOT)
      .map((file) => relative(SRC_ROOT, file))
      .filter((rel) => !/\.test\.(js|jsx)$/.test(rel) && rel !== join('hooks', 'useSocket.js'))
      .filter((rel) => /\/v1\/live/.test(readFileSync(join(SRC_ROOT, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
