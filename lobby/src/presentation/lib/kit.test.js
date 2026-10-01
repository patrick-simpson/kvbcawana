import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import tokens from '../../../shared/brand/tokens.json';
import { CELEBRATION, CLUB_ORDER, FAR_WAVE_KEEP, HOUSE, KIT_CLUBS, URGENT_COLOR, WARNING_TONES, shade } from './kit.js';
import { THEME } from './shared-config.js';

// The projector reads the family kit (shared/brand/) directly, so these pin
// that it really is the kit's values on screen, and that nothing old crept
// back in.

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
const OLD_BRAND = ['#E8192C', '#0072CE', '#00A651', '#FFC107', '#F7941D', '#FFB627'];

describe('the projector kit', () => {
  it('is the kit tokens, not a copy', () => {
    expect(HOUSE.orange).toBe(tokens.house.orange);
    expect(HOUSE.hot).toBe(tokens.house.hot);
    expect(KIT_CLUBS.tnt.primary).toBe(tokens.clubs.tnt.primary);
    expect(Object.values(HOUSE).every((v) => typeof v === 'string')).toBe(true);
  });

  it('runs the clubs in the catalog order, T&T in its green and Puggles in its blue', () => {
    expect(CLUB_ORDER).toEqual(['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey']);
    expect(KIT_CLUBS.tnt.primary).toBe('#58BD79');
    expect(KIT_CLUBS.puggles.primary).toBe('#1DB6D9');
  });

  it('celebrates in every club colour, the sun and white', () => {
    for (const id of CLUB_ORDER) expect(CELEBRATION).toContain(KIT_CLUBS[id].primary);
    expect(CELEBRATION).toContain(HOUSE.sun);
    expect(CELEBRATION).toContain('#FFFFFF');
  });

  it('warns in the kit\'s own colours, and the urgent red is the hot, never a club', () => {
    expect(WARNING_TONES['two-minute']).toEqual({ digits: HOUSE.sun, plate: HOUSE.orangeDeep });
    expect(WARNING_TONES['final-thirty']).toEqual({ digits: HOUSE.hot, plate: HOUSE.hotDeep });
    expect(URGENT_COLOR).toBe(HOUSE.hot);
    for (const id of CLUB_ORDER) expect(URGENT_COLOR).not.toBe(KIT_CLUBS[id].primary);
  });

  it('shade keeps a share of each channel (the far edge wave)', () => {
    expect(shade('#2F8A4E', FAR_WAVE_KEEP)).toBe('#1F5A33');
    expect(shade('#FFFFFF', 0)).toBe('#000000');
    expect(shade('#123456', 1)).toBe('#123456');
    expect(shade('red', 0.5)).toBe('red');
  });

  it('index.css pulls the kit tokens.css into the bundle', () => {
    expect(css).toMatch(/@import\s+["']\.\.\/\.\.\/shared\/brand\/tokens\.css["']/);
  });

  it('index.css bundles the kit\'s three voices and no retired face', () => {
    // Figtree's license reserves no font name, so it may come from @fontsource.
    expect(css).toContain('@import "@fontsource-variable/figtree');
    // Paytone One and Londrina Solid do (the kit's README, "Reserved Font Names
    // and the OFL"): they come only from the kit's full files, below, and never
    // from an @fontsource subset.
    for (const reserved of ['londrina', 'paytone']) expect(css).not.toContain(`fontsource/${reserved}`);
    for (const retired of ['lilita-one', 'barlow-condensed', 'nunito-sans', 'caveat', 'fontsource/galindo']) {
      expect(css).not.toContain(retired);
    }
    expect(css).toMatch(/--font-display:\s*"Paytone One", "Baloo 2 Variable"/);
    expect(css).toMatch(/--font-condensed:\s*"Londrina Solid"/);
  });

  const faces = (text, family) => [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map(([, body]) => Object.fromEntries(body.split(';').map((l) => l.trim()).filter(Boolean).map((l) => {
      const at = l.indexOf(':');
      return [l.slice(0, at).trim(), l.slice(at + 1).trim().replace(/\s+/g, ' ').replace(/"/g, "'")];
    })))
    .filter((d) => d['font-family'] === `'${family}'`);
  const lobbyCss = readFileSync(resolve(__dirname, '../../styles/app.css'), 'utf8');

  it('the shout is the lobby\'s own Paytone One face: the kit\'s full files, the same overrides', () => {
    const lobby = faces(lobbyCss, 'Paytone One');
    const projector = faces(css, 'Paytone One');
    expect(projector).toHaveLength(1);
    expect(lobby).toHaveLength(1);
    expect(projector[0]).toEqual(lobby[0]);
    expect(projector[0].src).toContain("url('../../shared/brand/fonts/paytone-one-full-400-normal.woff2') format('woff2')");
    expect(projector[0].src).toContain("url('../../shared/brand/fonts/PaytoneOne-Regular.ttf') format('truetype')");
  });

  it('the label voice is the lobby\'s own Londrina Solid face: the kit\'s full 400 files, never a subset', () => {
    const lobby = faces(lobbyCss, 'Londrina Solid');
    const projector = faces(css, 'Londrina Solid');
    // One @font-face each: a second (a latin cut) would be a Modified Version of a reserved name.
    expect(projector).toHaveLength(1);
    expect(lobby).toHaveLength(1);
    expect(projector[0]).toEqual(lobby[0]);
    expect(projector[0].src).toBe(
      "url('../../shared/brand/fonts/londrina-solid-full-400-normal.woff2') format('woff2'), url('../../shared/brand/fonts/LondrinaSolid-Regular.ttf') format('truetype')",
    );
    expect(projector[0]['unicode-range']).toBeUndefined();
    expect(projector[0]['font-weight']).toBe('400');
  });

  it('every club colour token in index.css is theme.json\'s', () => {
    for (const id of CLUB_ORDER) {
      const m = css.match(new RegExp(`--color-club-${id}:\\s*(#[0-9A-Fa-f]{6})`));
      expect(m, id).not.toBeNull();
      expect(m[1].toUpperCase()).toBe(THEME.clubs[id].color.toUpperCase());
    }
  });

  it('no old brand colour is left in the projector\'s own source', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const root = resolve(__dirname, '..');
    const walk = (dir) => readdirSync(dir).flatMap((f) => {
      const p = resolve(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const files = walk(root).filter((f) => /\.(jsx?|css)$/.test(f) && !/\.test\.jsx?$/.test(f));
    for (const f of files) {
      const text = readFileSync(f, 'utf8').toUpperCase();
      for (const hex of OLD_BRAND) expect(text.includes(hex), `${hex} in ${f}`).toBe(false);
    }
  });
});
