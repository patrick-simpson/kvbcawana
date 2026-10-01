import { describe, it, expect } from 'vitest';
import { sanitize } from './useSocket.js';

// PRIVACY INVARIANT — these tests guard the rule that only firstName,
// club, isBirthday and isFirstTimer can ever reach the screen. If a
// change makes one of these fail, it is leaking private data.
describe('sanitize', () => {
  it('keeps only the four public fields and drops everything else', () => {
    const result = sanitize({
      firstName: 'Amelia',
      club: 'Sparks',
      isBirthday: true,
      isFirstTimer: false,
      lastName: 'Smith',
      allergies: 'peanuts',
      parentPhone: '555-0123',
      photoUrl: 'https://example.com/kid.jpg',
      notes: 'medical info',
    });

    expect(result).toEqual({
      firstName: 'Amelia',
      club: 'Sparks',
      isBirthday: true,
      isFirstTimer: false,
    });
    expect(Object.keys(result)).toHaveLength(4);
  });

  it('rejects payloads without a usable firstName', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize('hi')).toBeNull();
    expect(sanitize({})).toBeNull();
    expect(sanitize({ firstName: '' })).toBeNull();
    expect(sanitize({ firstName: '   ' })).toBeNull();
    expect(sanitize({ firstName: 42 })).toBeNull();
  });

  it('trims and length-limits the name and club', () => {
    const result = sanitize({
      firstName: `  ${'A'.repeat(60)}  `,
      club: `  ${'B'.repeat(60)}  `,
    });
    expect(result.firstName).toBe('A'.repeat(40));
    expect(result.club).toBe('B'.repeat(40));
  });

  it('coerces flags to strict booleans', () => {
    const result = sanitize({ firstName: 'Noah', isBirthday: 'yes', isFirstTimer: 1 });
    expect(result.isBirthday).toBe(false);
    expect(result.isFirstTimer).toBe(false);
    expect(sanitize({ firstName: 'Noah', club: 123 }).club).toBe('');
  });
});

// AWANA CHECK-IN BROADCAST CONTRACT v1 — see CONTRACT.md. The printer
// repo (Print-TwoTimTwo-Labels/print-server) builds this exact payload
// and runs mirrored tests against the same canonical fixture. If this
// block fails, the two repos have drifted apart and the welcome screen
// will silently go dark — fix the contract on both sides together.
describe('printer contract', () => {
  // Must match print-server/test/checkin-payload.test.js verbatim.
  const CANONICAL_FIXTURE = {
    firstName: 'Amelia',
    club: 'Sparks',
    isBirthday: false,
    isFirstTimer: true,
  };

  it('accepts the canonical printer payload unchanged', () => {
    expect(sanitize(CANONICAL_FIXTURE)).toEqual(CANONICAL_FIXTURE);
  });

  it('accepts the test-broadcast payload the print server dashboard sends', () => {
    const testEvent = { firstName: 'Test', club: 'Sparks', isBirthday: false, isFirstTimer: false };
    expect(sanitize(testEvent)).toEqual(testEvent);
  });

  it('passes exactly the four contract keys through', () => {
    expect(Object.keys(sanitize(CANONICAL_FIXTURE)).sort()).toEqual([
      'club', 'firstName', 'isBirthday', 'isFirstTimer',
    ]);
  });
});
