import { describe, expect, it, vi } from 'vitest';
import { dispatchEvent, simulateEvent, SIMULATABLE_EVENTS } from './useSocket.js';
import vectors from '../lib/__fixtures__/contract-vectors.json';

// The point of these tests is a single claim: a SIMULATED event is filtered by
// exactly the same allowlist sanitizer as a real one.
//
// Before demo mode existed, the debug panel called the render handlers
// directly, so every fake payload bypassed the privacy boundary. That made the
// panel a hole in the one guarantee this app is built around — and it meant a
// simulator could render a shape the wire could never actually deliver, so the
// panel could show a screen that looked fine while production was broken.

const HANDLER_FOR = {
  checkin: 'onCheckin',
  recap: 'onRecap',
  checkout: 'onCheckout',
  tally: 'onTally',
  birthdays: 'onBirthdays',
  ops: 'onOps',
  canary: 'onCanary',
  tonight: 'onTonight',
  points: 'onPoints',
  schedule: 'onSchedule',
  notice: 'onNotice',
  slides: 'onSlides',
  settings: 'onSettings',
};

describe('simulateEvent', () => {
  it('covers every contract event', () => {
    // If the contract grows an event and the simulator map doesn't, this fails
    // rather than silently leaving the new event unsimulatable.
    expect([...SIMULATABLE_EVENTS].sort()).toEqual(Object.keys(vectors.events).sort());
  });

  it('strips a field the sanitizer does not allow', () => {
    const onCheckin = vi.fn();
    const ok = simulateEvent('checkin', {
      firstName: 'Test Kid',
      club: 'Sparks',
      // A simulator (or a careless edit to one) must not be able to smuggle
      // these onto the screen any more than the wire can.
      lastName: 'Should-Not-Appear',
      allergies: ['peanut'],
      birthYear: 2018,
    }, { onCheckin });

    expect(ok).toBe(true);
    expect(onCheckin).toHaveBeenCalledTimes(1);
    const received = onCheckin.mock.calls[0][0];
    expect(received.firstName).toBe('Test Kid');
    expect(received).not.toHaveProperty('lastName');
    expect(received).not.toHaveProperty('allergies');
    expect(received).not.toHaveProperty('birthYear');
    expect(JSON.stringify(received)).not.toContain('Should-Not-Appear');
    expect(JSON.stringify(received)).not.toContain('peanut');
  });

  it('rejects a malformed payload instead of rendering it', () => {
    const onCheckin = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // No firstName — the sanitizer refuses this, so the handler must never see
    // it. This is what makes the debug panel a live contract check: a drifted
    // simulator visibly does nothing rather than faking a working screen.
    const ok = simulateEvent('checkin', { club: 'Sparks' }, { onCheckin });

    expect(ok).toBe(false);
    expect(onCheckin).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores an unknown event name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(simulateEvent('not-a-real-event', { firstName: 'Test Kid' }, {})).toBe(false);
    warn.mockRestore();
  });

  it('routes each event to its own handler and no other', () => {
    for (const event of SIMULATABLE_EVENTS) {
      const valid = vectors.events[event].valid[0];
      const handlers = Object.fromEntries(
        Object.values(HANDLER_FOR).map((name) => [name, vi.fn()]),
      );
      const ok = simulateEvent(event, valid, handlers);
      expect(ok, `${event} should dispatch its first valid vector`).toBe(true);

      const target = HANDLER_FOR[event];
      expect(handlers[target], `${event} → ${target}`).toHaveBeenCalledTimes(1);
      for (const [name, fn] of Object.entries(handlers)) {
        if (name !== target) expect(fn, `${event} must not call ${name}`).not.toHaveBeenCalled();
      }
    }
  });

  it('drops every reject vector for every event', () => {
    // Same corpus the sanitizer suite uses. If a payload can't ride the wire,
    // a simulator must not be able to put it on the screen either.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const event of SIMULATABLE_EVENTS) {
      for (const bad of vectors.events[event].reject ?? []) {
        const handlers = { [HANDLER_FOR[event]]: vi.fn() };
        const payload = Object.prototype.hasOwnProperty.call(bad, 'payload') ? bad.payload : bad;
        expect(
          simulateEvent(event, payload, handlers),
          `${event} must reject: ${bad.reason ?? JSON.stringify(payload)}`,
        ).toBe(false);
        expect(handlers[HANDLER_FOR[event]]).not.toHaveBeenCalled();
      }
    }
    warn.mockRestore();
  });
});

describe('dispatchEvent', () => {
  it('returns the sanitized payload so the caller can track liveness', () => {
    const safe = dispatchEvent('checkin', { firstName: 'Demo Kid', club: 'Trek' }, {});
    expect(safe).toMatchObject({ firstName: 'Demo Kid', club: 'Trek' });
  });

  it('returns null when the sanitizer rejects', () => {
    expect(dispatchEvent('checkin', { club: 'Trek' }, {})).toBeNull();
  });

  // Local-only delivery hints. Settings' "Preview a check-in" needs to say
  // "this is a rehearsal, do not move the public count", and that fact must
  // travel BESIDE the payload, never inside it: on the wire any publisher
  // could set it, and the sanitizer would have to allowlist a field that means
  // nothing to the contract.
  describe('the local-only meta argument', () => {
    it('hands meta to the handler as a second argument', () => {
      const onCheckin = vi.fn();
      dispatchEvent('checkin', { firstName: 'Demo Kid', club: 'Trek' }, { onCheckin },
        { countsTowardTally: false });
      expect(onCheckin).toHaveBeenCalledTimes(1);
      expect(onCheckin.mock.calls[0][1]).toEqual({ countsTowardTally: false });
    });

    it('is undefined when the caller does not pass one (the live socket path)', () => {
      const onCheckin = vi.fn();
      dispatchEvent('checkin', { firstName: 'Demo Kid', club: 'Trek' }, { onCheckin });
      expect(onCheckin.mock.calls[0][1]).toBeUndefined();
    });

    it('never leaks into the sanitized payload, however it is spelled', () => {
      const onCheckin = vi.fn();
      // A payload that tries to smuggle the same hint over the wire.
      dispatchEvent('checkin', {
        firstName: 'Demo Kid', club: 'Trek', countsTowardTally: false, __test: true,
      }, { onCheckin });
      const received = onCheckin.mock.calls[0][0];
      expect(received).not.toHaveProperty('countsTowardTally');
      expect(received).not.toHaveProperty('__test');
    });

    it('simulateEvent forwards it', () => {
      const onCheckin = vi.fn();
      simulateEvent('checkin', { firstName: 'Demo Kid', club: 'Trek' }, { onCheckin },
        { countsTowardTally: false });
      expect(onCheckin.mock.calls[0][1]).toEqual({ countsTowardTally: false });
    });
  });

  it('tolerates a bare function handler for checkin only', () => {
    const fn = vi.fn();
    expect(dispatchEvent('checkin', { firstName: 'Test Kid', club: 'Trek' }, fn)).toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(1);

    // A bare function is shorthand for onCheckin; other events must not be
    // funnelled into it.
    const fn2 = vi.fn();
    dispatchEvent('tally', { counts: { Sparks: 3 }, total: 3, at: Date.now() }, fn2);
    expect(fn2).not.toHaveBeenCalled();
  });
});
