import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASPECT, LOGO_ARRIVAL, MIN_WIDTH_PX, logoFor, logoLetters, parseChurchLogo } from './churchLogo.js';

// The church's logo (owner 2026-10-13): the kit's files are what every screen
// draws, so the parse and the size rules are pinned against them.

const kit = (name) => readFileSync(resolve(__dirname, 'brand', 'logos', name), 'utf8');

describe('the church logo', () => {
  it('reads every version of the kit file into its lines, in arrival order', () => {
    const full = parseChurchLogo(kit('kvbc-awana-full.svg'));
    expect(full.viewBox).toBe('2 1 1910 487');
    expect(full.parts.map((p) => p.part)).toEqual(['church', 'awana', 'tagline']);
    expect(full.label).toMatch(/Strengthening the next generation/);
    expect(parseChurchLogo(kit('kvbc-awana-two-line.svg')).parts.map((p) => p.part)).toEqual(['church', 'awana']);
    expect(parseChurchLogo(kit('kvbc-awana-stacked.svg')).viewBox).toBe('3 1 1034 805');
  });

  it('is one colour in every file: currentColor, white or ink, never two', () => {
    for (const v of ['full', 'two-line', 'stacked']) {
      for (const [suffix, fill] of [['', 'currentColor'], ['-white', '#FFF'], ['-ink', '#231F20']]) {
        const svg = kit(`kvbc-awana-${v}${suffix}.svg`);
        const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]).filter((f) => f !== 'none');
        expect(new Set(fills)).toEqual(new Set([fill]));
        expect(svg).not.toMatch(/stroke=|filter|Gradient|opacity/);
      }
    }
  });

  it('knows each version\'s shape from its viewBox', () => {
    for (const [v, file] of [['full', 'kvbc-awana-full.svg'], ['two-line', 'kvbc-awana-two-line.svg'], ['stacked', 'kvbc-awana-stacked.svg']]) {
      const [, , w, h] = parseChurchLogo(kit(file)).viewBox.split(' ').map(Number);
      expect(ASPECT[v]).toBeCloseTo(w / h, 6);
    }
  });

  it('picks the biggest version a width can read, and keeps the tagline out of corners', () => {
    expect(logoFor(600, { allowFull: true })).toBe('full');
    expect(logoFor(600)).toBe('two-line');
    expect(logoFor(MIN_WIDTH_PX['two-line'])).toBe('two-line');
    expect(logoFor(MIN_WIDTH_PX['two-line'] - 1)).toBe('stacked');
    expect(logoFor(80)).toBe('stacked');
  });

  it('arrives church line first, then Awana Clubs, then the tagline, in about a second and a quarter', () => {
    expect(LOGO_ARRIVAL.church.at).toBeLessThan(LOGO_ARRIVAL.awana.at);
    expect(LOGO_ARRIVAL.awana.at).toBeLessThan(LOGO_ARRIVAL.tagline.at);
    const end = Math.max(...Object.values(LOGO_ARRIVAL).map((b) => b.at + b.dur));
    expect(end).toBeLessThanOrEqual(1.25);
  });

  it('refuses a file that is not the kit\'s shape', () => {
    expect(() => parseChurchLogo('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')).toThrow();
    expect(() => parseChurchLogo('<svg><path class="kvbc-church" d="M0 0"/><path class="kvbc-awana" d="M0 0"/></svg>')).toThrow();
  });

  it('splits Awana Clubs into its ten letters, each with its counters, left to right', () => {
    // The flagship's bouncy letters (owner 2026-10-13) cut the traced line
    // up in code; the kit's file stays the one drawing.
    for (const name of ['kvbc-awana-full.svg', 'kvbc-awana-two-line.svg']) {
      const awana = parseChurchLogo(kit(name)).parts.find((p) => p.part === 'awana');
      const letters = logoLetters(awana.d);
      expect(letters).toHaveLength('AwanaClubs'.length);
      for (let i = 1; i < letters.length; i += 1) expect(letters[i].x0).toBeGreaterThan(letters[i - 1].x1);
      // Every sub-path of the line lands in exactly one letter: A, a, a and b keep their holes.
      const subpaths = (d) => (d.match(/[Mm]/g) || []).length;
      expect(letters.reduce((n, l) => n + subpaths(l.d), 0)).toBe(subpaths(awana.d));
      expect(letters.map((l) => subpaths(l.d))).toEqual([2, 1, 2, 1, 2, 1, 1, 1, 2, 1]);
      // Each letter starts with an absolute moveto, so it draws in place on its own.
      for (const l of letters) expect(l.d).toMatch(/^M[\d.]+ [\d.]+/);
    }
  });

  it('keeps a split path drawing exactly where the whole one did', () => {
    // Relative moves after a close are relative to the sub-path's start.
    const letters = logoLetters('m10 10h5v5h-5zm20 0h5v5h-5zm2 1h1v1h-1z');
    expect(letters).toEqual([
      { d: 'M10 10h5v5h-5z', x0: 10, x1: 15 },
      { d: 'M30 10h5v5h-5zM32 11h1v1h-1z', x0: 30, x1: 35 },
    ]);
    expect(() => logoLetters('l1 2')).toThrow();
  });
});
