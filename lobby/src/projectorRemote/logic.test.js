import { describe, expect, it } from 'vitest';
import { actionFor, pressWords, projectorsFrom, targetWords, targetsFor } from './logic.js';
import { sanitizeScreenAction } from '../lib/syncSpecs.js';

const list = (screens) => projectorsFrom({ screens });

describe('the opening-ceremony remote', () => {
  it('keeps only projectors, the ones that are on first', () => {
    const p = list([
      { id: 'a', kind: 'lobby', name: 'Lobby', online: true },
      { id: 'b', kind: 'projector', name: 'Spare', online: false },
      { id: 'c', kind: 'projector', name: 'Gym projector', online: true },
    ]);
    expect(p.map((x) => x.id)).toEqual(['c', 'b']);
    expect(targetsFor(p).map((x) => x.id)).toEqual(['c']);
    expect(projectorsFrom(null)).toEqual([]);
  });

  it('words the projector line for every case', () => {
    expect(targetWords(null)).toBe('Looking for the projector…');
    expect(targetWords([])).toMatch(/No projector is set up yet/);
    expect(targetWords(list([{ id: 'b', kind: 'projector', name: 'Gym', online: false }]))).toBe('Gym is off. Turn the projector computer on.');
    expect(targetWords(list([{ id: 'b', kind: 'projector', name: 'Gym', online: true }]))).toBe('Gym · on');
  });

  it('sends only actions the projector accepts', () => {
    for (const what of ['next', 'prev', 'us-flag', 'awana-flag', 'verse', 'backup-end']) {
      const a = actionFor(what);
      expect(sanitizeScreenAction('projector', a.action, a.data)).toEqual(a);
    }
    expect(actionFor('fireworks')).toBeNull();
  });

  it('says what happened to a press', () => {
    expect(pressWords('next', [])).toMatch(/No projector is on/);
    expect(pressWords('next', [{ ok: true, status: 200, body: { delivered: true } }])).toBe('Next: sent ✓');
    expect(pressWords('verse', [{ ok: true, status: 200, body: { delivered: false } }])).toMatch(/did not answer/);
    expect(pressWords('prev', [{ ok: false, status: 0, body: null }])).toMatch(/internet/);
  });
});
