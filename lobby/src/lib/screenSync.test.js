import { beforeEach, describe, expect, it } from 'vitest';
import {
  SCREENS_STORAGE, loadScreenSlot, newScreenId, reconcileScreen, saveScreenSlot, screenIdFor, screenPart,
  screenPartChanged, withScreenPart,
} from './screenSync.js';
import { isScreenId } from './syncSpecs.js';

// A screen's own settings, reconciled between its device layer and the
// Worker's copy against the last copy both agreed on.

beforeEach(() => localStorage.clear());

const AT1 = '2026-10-11T18:00:00.000Z';
const AT2 = '2026-10-11T18:05:00.000Z';

describe('the id', () => {
  it('is made once per kind and kept', () => {
    const a = screenIdFor('lobby');
    expect(isScreenId(a)).toBe(true);
    expect(screenIdFor('lobby')).toBe(a);
    expect(screenIdFor('projector')).not.toBe(a);
    expect(JSON.parse(localStorage.getItem(SCREENS_STORAGE)).lobby.id).toBe(a);
  });

  it('is never the same twice', () => {
    expect(new Set(Array.from({ length: 50 }, newScreenId)).size).toBe(50);
  });

  it('a junk slot is no slot', () => {
    localStorage.setItem(SCREENS_STORAGE, JSON.stringify({ lobby: { id: 'x' } }));
    expect(loadScreenSlot('lobby')).toBeNull();
    localStorage.setItem(SCREENS_STORAGE, '{nope');
    expect(loadScreenSlot('lobby')).toBeNull();
  });

  it('a kept record is cleaned on the way out', () => {
    const id = screenIdFor('lobby');
    saveScreenSlot('lobby', { synced: { savedAt: AT1, settings: { audioMuted: true, panicMode: true } } });
    expect(loadScreenSlot('lobby')).toEqual({ id, name: undefined, synced: { savedAt: AT1, settings: { audioMuted: true } } });
  });
});

describe('the screen part of a device layer', () => {
  const layer = { audioMuted: true, manualSlides: [{ text: 'x' }], panicMode: true, pusherAppKey: 'k', standardDisplayMs: 7000 };

  it('is the allowlisted keys only', () => {
    expect(screenPart('lobby', layer)).toEqual({ audioMuted: true });
  });

  it('is replaced without touching anything else; an unset key goes back to its default', () => {
    expect(withScreenPart('lobby', layer, { reduceMotion: true, panicMode: false })).toEqual({
      manualSlides: [{ text: 'x' }], panicMode: true, pusherAppKey: 'k', standardDisplayMs: 7000, reduceMotion: true,
    });
  });
});

describe('reconciling', () => {
  it('no copy on the Worker yet: send this screen\'s up', () => {
    expect(reconcileScreen('lobby', { remote: null, synced: null, overrides: { audioMuted: true } }))
      .toEqual({ do: 'push', settings: { audioMuted: true } });
  });

  it('the Worker\'s copy moved on (changed on /settings): it wins', () => {
    const r = reconcileScreen('lobby', {
      remote: { savedAt: AT2, settings: { audioMuted: false } },
      synced: { savedAt: AT1, settings: { audioMuted: true } },
      overrides: { audioMuted: true },
    });
    expect(r).toEqual({ do: 'apply', settings: { audioMuted: false }, synced: { savedAt: AT2, settings: { audioMuted: false } } });
  });

  it('this screen moved on (changed on the TV): it goes up', () => {
    const r = reconcileScreen('lobby', {
      remote: { savedAt: AT1, settings: { audioMuted: true } },
      synced: { savedAt: AT1, settings: { audioMuted: true } },
      overrides: { audioMuted: false },
    });
    expect(r).toEqual({ do: 'push', settings: { audioMuted: false } });
  });

  it('the same values under a new stamp are agreement, not a change', () => {
    const r = reconcileScreen('lobby', {
      remote: { savedAt: AT2, settings: { audioMuted: true } },
      synced: { savedAt: AT1, settings: { audioMuted: false } },
      overrides: { audioMuted: true, panicMode: true },
    });
    expect(r).toEqual({ do: 'none', synced: { savedAt: AT2, settings: { audioMuted: true } } });
  });

  it('a Worker copy carrying something off the allowlist never reaches the device layer', () => {
    const r = reconcileScreen('lobby', {
      remote: { savedAt: AT2, settings: { panicMode: true, pusherAppKey: 'evil', audioMuted: false } },
      synced: null,
      overrides: {},
    });
    expect(r).toMatchObject({ do: 'apply', settings: { audioMuted: false } });
  });

  it('screenPartChanged says when the TV changed something since the last agreement', () => {
    const synced = { savedAt: AT1, settings: { audioMuted: true } };
    expect(screenPartChanged('lobby', { audioMuted: true, panicMode: true }, synced)).toBe(false);
    expect(screenPartChanged('lobby', { audioMuted: false }, synced)).toBe(true);
    expect(screenPartChanged('lobby', {}, null)).toBe(true);
  });
});
