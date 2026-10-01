import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';

// lib/touch.js is the ONE question every touch behaviour on the projector
// asks, and index.css asks the same one in its touch blocks. These pin the
// two together, and the hooks to the media queries they read.

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

/** A matchMedia that answers from `state`, with a way to fire 'change'. */
function fakeMatchMedia(state) {
  const lists = new Map();
  const matchMedia = (query) => {
    if (!lists.has(query)) {
      const listeners = new Set();
      lists.set(query, {
        media: query,
        get matches() { return Boolean(state[query]); },
        addEventListener: (_type, fn) => listeners.add(fn),
        removeEventListener: (_type, fn) => listeners.delete(fn),
        fire: () => listeners.forEach((fn) => fn()),
        listeners,
      });
    }
    return lists.get(query);
  };
  matchMedia.lists = lists;
  return matchMedia;
}

/** A fresh copy of lib/touch.js reading `state` (its lists are cached per module). */
async function load(state) {
  vi.resetModules();
  const matchMedia = fakeMatchMedia(state);
  window.matchMedia = matchMedia;
  const mod = await import('./touch.js');
  return { mod, matchMedia };
}

afterEach(() => {
  cleanup();
  delete window.matchMedia;
  vi.resetModules();
});

describe('the touch question', () => {
  it('asks about the primary pointer, never the window size', async () => {
    const { mod } = await load({});
    expect(mod.TOUCH_QUERY).toBe('(hover: none) and (pointer: coarse)');
    expect(mod.PORTRAIT_QUERY).toBe('(hover: none) and (pointer: coarse) and (orientation: portrait)');
    expect(mod.TOUCH_QUERY).not.toMatch(/width|height/);
  });

  it('is the same question index.css asks, in blocks at the very end of the file', async () => {
    const { mod } = await load({});
    const at = css.indexOf(`@media ${mod.TOUCH_QUERY} {`);
    expect(at).toBeGreaterThan(0);
    // Nothing but touch rules after the first touch block: the desktop's own
    // rules all come before it, so no touch rule can be read as an edit of one.
    const tail = css.slice(at);
    const blocks = [...tail.matchAll(/^@media ([^{]+) \{/gm)].map((m) => m[1]);
    for (const q of blocks) expect([mod.TOUCH_QUERY, mod.PORTRAIT_QUERY]).toContain(q);
    expect(tail.replace(/^@media [^{]+\{[\s\S]*?^\}/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('');
  });

  it('is false on a mouse-and-keyboard PC, true on a phone or tablet', async () => {
    let { mod } = await load({});
    expect(mod.isTouch()).toBe(false);
    expect(mod.isPortrait()).toBe(false);
    ({ mod } = await load({ '(hover: none) and (pointer: coarse)': true }));
    expect(mod.isTouch()).toBe(true);
    expect(mod.isPortrait()).toBe(false);
    ({ mod } = await load({
      '(hover: none) and (pointer: coarse)': true,
      '(hover: none) and (pointer: coarse) and (orientation: portrait)': true,
    }));
    expect(mod.isPortrait()).toBe(true);
  });

  it('is plain desktop where there is no matchMedia at all (jsdom, very old browsers)', async () => {
    vi.resetModules();
    delete window.matchMedia;
    const mod = await import('./touch.js');
    expect(mod.isTouch()).toBe(false);
    expect(mod.isPortrait()).toBe(false);
  });

  it('re-renders when a tablet turns, and lets go of its listener on unmount', async () => {
    const state = { '(hover: none) and (pointer: coarse)': true };
    const { mod, matchMedia } = await load(state);
    const seen = [];
    const Probe = () => {
      const touch = mod.useTouch();
      const portrait = mod.usePortrait();
      seen.push(`${touch}/${portrait}`);
      return null;
    };
    const { unmount } = render(React.createElement(Probe));
    expect(seen.at(-1)).toBe('true/false');
    state[mod.PORTRAIT_QUERY] = true;
    act(() => matchMedia(mod.PORTRAIT_QUERY).fire());
    expect(seen.at(-1)).toBe('true/true');
    unmount();
    expect(matchMedia(mod.PORTRAIT_QUERY).listeners.size).toBe(0);
    expect(matchMedia(mod.TOUCH_QUERY).listeners.size).toBe(0);
  });
});

describe('slideGesture: a finger moves a deck as the arrow keys do', () => {
  // Pure: it reads nothing from the page.
  let slideGesture;
  beforeAll(async () => {
    ({ slideGesture } = await import('./touch.js'));
  });
  const W = 400;
  const g = (over) => slideGesture({ dx: 0, dy: 0, dt: 120, x: 300, width: W, ...over });

  it('a swipe to the left is Next, to the right is Prev, wherever it starts', () => {
    expect(g({ dx: -80, dy: 10 })).toBe('next');
    expect(g({ dx: 80, dy: -10, x: 20 })).toBe('prev');
    expect(g({ dx: -80, x: 20 })).toBe('next');
  });

  it('a tap in the left 30% is Prev, anywhere else Next', () => {
    expect(g({ x: 20 })).toBe('prev');
    expect(g({ x: 0.3 * W - 1 })).toBe('prev');
    expect(g({ x: 0.3 * W })).toBe('next');
    expect(g({ x: 390, dx: 5, dy: -6 })).toBe('next');
  });

  it('a drag up the wall, a wandering finger or a long press is nothing', () => {
    expect(g({ dx: -50, dy: -120 })).toBeNull();
    expect(g({ dx: 25, dy: 5 })).toBeNull();
    expect(g({ dt: 900 })).toBeNull();
    // A wide tablet needs a longer swipe than a phone: 6% of its width.
    expect(slideGesture({ dx: -50, dy: 0, dt: 100, x: 500, width: 1194 })).toBeNull();
    expect(slideGesture({ dx: -75, dy: 0, dt: 100, x: 500, width: 1194 })).toBe('next');
  });
});
