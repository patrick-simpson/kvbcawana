import { describe, expect, it } from 'vitest';
import { sanitizeTheme } from './theme.js';

const BASE = 'https://patrick-simpson.github.io/Awana-Check-in-Display/shared/theme.json';

// The real shared/theme.json shape.
const SHARED = {
  version: 1,
  clubs: {
    tnt: {
      name: 'T&T',
      color: '#00A651',
      aliases: ['t&t', 'truth and training'],
      art: { logo: 'art/tnt-logo.png' },
    },
    sparks: { name: 'Sparks', color: '#E8192C', aliases: ['spark'], art: {} },
  },
};

describe('sanitizeTheme', () => {
  it('parses the shared theme into per-club overrides', () => {
    const t = sanitizeTheme(SHARED, BASE);
    expect(t.tnt.primary).toBe('#00A651');
    expect(t.tnt.logoUrl).toBe('https://patrick-simpson.github.io/Awana-Check-in-Display/shared/art/tnt-logo.png');
    expect(t.tnt.aliases).toContain('t&t');
    expect(t.tnt.deep).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.tnt.confetti).toHaveLength(3);
    expect(t.sparks.logoUrl).toBeUndefined();
  });

  it('drops clubs with bad colors and rejects junk payloads', () => {
    expect(sanitizeTheme(null, BASE)).toBeNull();
    expect(sanitizeTheme({ clubs: 'nope' }, BASE)).toBeNull();
    const t = sanitizeTheme({ clubs: { sparks: { color: 'red' }, tnt: { color: '#00A651' } } }, BASE);
    expect(t.sparks).toBeUndefined();
    expect(t.tnt).toBeDefined();
  });

  it('refuses path-traversal and non-http art URLs', () => {
    const t = sanitizeTheme({
      clubs: {
        tnt: { color: '#00A651', art: { logo: '../../evil.png' } },
        sparks: { color: '#E8192C', art: { logo: 'javascript:alert(1)' } },
      },
    }, BASE);
    expect(t.tnt.logoUrl).toBeUndefined();
    expect(t.sparks.logoUrl).toBeUndefined();
  });

  it('uses the catalog deep and tint when theme.json carries them', () => {
    const t = sanitizeTheme({
      clubs: { journey: { color: '#8A649D', deep: '#56467F', tint: '#DED5EA' } },
    }, BASE);
    expect(t.journey.deep).toBe('#56467F');
    expect(t.journey.accent).toBe('#DED5EA');
  });

  it('falls back to the derived shades for a bad deep or tint, keeping the club', () => {
    const t = sanitizeTheme({
      clubs: { journey: { color: '#8A649D', deep: 'purple', tint: 42 } },
    }, BASE);
    expect(t.journey.primary).toBe('#8A649D');
    expect(t.journey.deep).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.journey.deep).not.toBe('purple');
    expect(t.journey.accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('prefers the white knockout mark for banners, which sit on the club color', () => {
    const t = sanitizeTheme({
      clubs: {
        trek: { color: '#047E71', art: { logo: 'brand/logos/trek-color.svg', logoWhite: 'brand/logos/trek-white.svg' } },
        sparks: { color: '#F04A4B', art: { logo: 'brand/logos/sparks-color.svg' } },
      },
    }, BASE);
    expect(t.trek.logoUrl).toBe('https://patrick-simpson.github.io/Awana-Check-in-Display/shared/brand/logos/trek-white.svg');
    expect(t.sparks.logoUrl).toBe('https://patrick-simpson.github.io/Awana-Check-in-Display/shared/brand/logos/sparks-color.svg');
  });

  it('refuses a bad logoWhite and falls back to the color mark', () => {
    const t = sanitizeTheme({
      clubs: { tnt: { color: '#58BD79', art: { logo: 'brand/logos/tnt-color.svg', logoWhite: '../../evil.svg' } } },
    }, BASE);
    expect(t.tnt.logoUrl).toBe('https://patrick-simpson.github.io/Awana-Check-in-Display/shared/brand/logos/tnt-color.svg');
  });
});
