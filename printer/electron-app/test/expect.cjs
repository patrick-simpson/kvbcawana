// The few vitest matchers the display tests use, on node:assert, so the tests
// moved from lobby/desktop/src read as they did there while running on
// `node --test` (the printer's checks need no vitest).
'use strict';
const assert = require('node:assert/strict');

function matches(actual, expected) {
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.keys(expected).every((k) => matches(actual[k], expected[k]));
  }
  return Object.is(actual, expected);
}

function expect(actual) {
  const api = {
    toBe: (v) => assert.ok(Object.is(actual, v), `expected ${JSON.stringify(actual)} to be ${JSON.stringify(v)}`),
    toEqual: (v) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual ?? null)), JSON.parse(JSON.stringify(v ?? null))),
    toMatchObject: (v) => assert.ok(matches(actual, v), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(v)}`),
    toBeNull: () => assert.equal(actual, null),
    toBeLessThanOrEqual: (v) => assert.ok(actual <= v, `expected ${actual} <= ${v}`),
    toBeGreaterThan: (v) => assert.ok(actual > v, `expected ${actual} > ${v}`),
    not: {
      toBe: (v) => assert.ok(!Object.is(actual, v), `expected ${JSON.stringify(actual)} not to be ${JSON.stringify(v)}`),
      toBeNull: () => assert.notEqual(actual, null),
    },
  };
  return api;
}

module.exports = { expect };
