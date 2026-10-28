import { describe, it, expect } from 'vitest';
import {
  FLAGSHIP_DURATION_SEC, flagshipOnAir, FLAGSHIP_ID, FLAGSHIP_SLIDE, isFlagshipSlide, withFlagship,
  FLAGSHIP_LINES, FLAGSHIP_STYLES, FLAGSHIP_TURN_KEY, FLAGSHIP_VERSIONS, flagshipLabel, flagshipPick,
  nextFlagshipPick, resetFlagshipTurn,
  FLAGSHIP_INTRO, FLAGSHIP_INTRO_EVERY, FLAGSHIP_INTRO_PICK, FLAGSHIP_INTRO_SRC, flagshipIntroLap, introFits,
} from './flagship.js';
import { holdsCheckIns, slideDurationMs } from './slides.js';
import { sanitizeSlides } from './slides.js';

describe('the flagship slide', () => {
  it('is one frozen, built-in descriptor', () => {
    expect(FLAGSHIP_SLIDE).toEqual({ id: FLAGSHIP_ID, type: 'flagship', durationSec: FLAGSHIP_DURATION_SEC });
    expect(Object.isFrozen(FLAGSHIP_SLIDE)).toBe(true);
    expect(isFlagshipSlide(FLAGSHIP_SLIDE)).toBe(true);
    expect(isFlagshipSlide({ type: 'promo' })).toBe(false);
    expect(isFlagshipSlide(null)).toBe(false);
  });

  it('leads every deck, and only once', () => {
    const deck = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
    expect(withFlagship(deck).map((s) => s.id)).toEqual([FLAGSHIP_ID, 'a', 'b']);
    expect(withFlagship([]).map((s) => s.id)).toEqual([FLAGSHIP_ID]);
    expect(withFlagship(null).map((s) => s.id)).toEqual([FLAGSHIP_ID]);
    // Nothing else can make one, but if one ever arrived it would not double up.
    expect(withFlagship([FLAGSHIP_SLIDE, ...deck]).filter(isFlagshipSlide)).toHaveLength(1);
    expect(withFlagship([{ ...FLAGSHIP_SLIDE }, ...deck])[0]).toBe(FLAGSHIP_SLIDE);
  });

  it('never holds check-ins: names play over it', () => {
    expect(holdsCheckIns(FLAGSHIP_SLIDE)).toBe(false);
  });

  it('holds for its own beat sheet, whatever the global slide delay is', () => {
    expect(slideDurationMs(FLAGSHIP_SLIDE, 5)).toBe(FLAGSHIP_DURATION_SEC * 1000);
    expect(slideDurationMs(FLAGSHIP_SLIDE, 0)).toBe(FLAGSHIP_DURATION_SEC * 1000);
  });

  it('cannot be typed, published or saved: the slide allowlist drops the type', () => {
    expect(sanitizeSlides([FLAGSHIP_SLIDE, { id: 's_1', text: 'Real slide', durationSec: 5 }]).map((s) => s.id)).toEqual(['s_1']);
  });

  it('is off the air Wednesdays from 6:30 pm to 8:30 pm, local, and only then', () => {
    const at = (d, h, m) => new Date(2026, 8, d, h, m); // Sep 30 2026 is a Wednesday
    expect(flagshipOnAir(at(30, 18, 29))).toBe(true);
    expect(flagshipOnAir(at(30, 18, 30))).toBe(false);
    expect(flagshipOnAir(at(30, 19, 45))).toBe(false);
    expect(flagshipOnAir(at(30, 20, 29))).toBe(false);
    expect(flagshipOnAir(at(30, 20, 30))).toBe(true);
    expect(flagshipOnAir(at(29, 19, 0))).toBe(true); // Tuesday
    expect(flagshipOnAir(new Date(2026, 9, 1, 19, 0))).toBe(true); // Thursday
    expect(withFlagship([{ id: 'a' }], false).map((s) => s.id)).toEqual(['a']);
  });

});

describe('which welcome plays (owner 2026-10-13: "one of each on each load, mix it up")', () => {
  it('takes the next style and the next wording each showing, never the same twice in a row', () => {
    const six = [0, 1, 2, 3, 4, 5].map(flagshipPick);
    expect(FLAGSHIP_STYLES).toEqual(['bounce', 'pop', 'parade']);
    expect(FLAGSHIP_VERSIONS).toEqual(['glad', 'welcome']);
    for (let i = 1; i < six.length; i += 1) {
      expect(six[i].style).not.toBe(six[i - 1].style);
      expect(six[i].version).not.toBe(six[i - 1].version);
    }
    // Six showings play every pairing once.
    expect(new Set(six.map((p) => `${p.style}/${p.version}`)).size).toBe(6);
    expect(flagshipPick(6)).toEqual(flagshipPick(0));
    expect(flagshipPick(-3)).toEqual(flagshipPick(0));
  });

  it('keeps this screen\'s place in its own storage, carrying on after a reload', () => {
    const data = new Map();
    const store = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
    expect(nextFlagshipPick(store)).toEqual(flagshipPick(0));
    expect(data.get(FLAGSHIP_TURN_KEY)).toBe('1');
    expect(nextFlagshipPick(store)).toEqual(flagshipPick(1));
    data.set(FLAGSHIP_TURN_KEY, '5');
    expect(nextFlagshipPick(store)).toEqual(flagshipPick(5));
    expect(data.get(FLAGSHIP_TURN_KEY)).toBe('0');
    data.set(FLAGSHIP_TURN_KEY, 'garbage');
    expect(nextFlagshipPick(store)).toEqual(flagshipPick(0));
  });

  it('carries on in memory when storage throws, and never throws itself', () => {
    resetFlagshipTurn();
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(nextFlagshipPick(broken)).toEqual(flagshipPick(0));
    expect(nextFlagshipPick(broken)).toEqual(flagshipPick(1));
    expect(nextFlagshipPick(null)).toEqual(flagshipPick(2));
    resetFlagshipTurn();
  });

  it('says the owner\'s own words, and the logo\'s with them, as one label', () => {
    expect(FLAGSHIP_LINES.glad).toBe('We\u2019re so glad you\u2019re here!');
    expect(FLAGSHIP_LINES.welcome).toBe('Welcome to');
    expect(flagshipLabel('glad')).toBe('Kennebec Valley Baptist Church Awana Clubs. Strengthening the next generation of lifelong disciples for Christ. We\u2019re so glad you\u2019re here!');
    expect(flagshipLabel('welcome')).toBe('Welcome to Kennebec Valley Baptist Church Awana Clubs. Strengthening the next generation of lifelong disciples for Christ');
    for (const v of FLAGSHIP_VERSIONS) expect(flagshipLabel(v)).not.toMatch(/\u2014/);
  });
});

describe('the 3D intro', () => {
  it('plays on the second pass of a screen, then every fourth, never on the first', () => {
    const laps = Array.from({ length: 12 }, (_, lap) => lap).filter(flagshipIntroLap);
    expect(laps).toEqual([1, 5, 9]);
    expect(FLAGSHIP_INTRO_EVERY).toBe(4);
    expect(flagshipIntroLap(-3)).toBe(false);
    expect(flagshipIntroLap(1.5)).toBe(false);
    expect(flagshipIntroLap(Number.NaN)).toBe(false);
  });

  it('only plays on a 16:9 screen wide enough for the full logo (the frame the video IS)', () => {
    expect(introFits(1920, 1080)).toBe(true);
    expect(introFits(1280, 720)).toBe(true);
    expect(introFits(3840, 2160)).toBe(true);
    expect(introFits(1366, 768)).toBe(true); // 16:9 to within a pixel
    expect(introFits(722, 406)).toBe(true);
    expect(introFits(640, 360)).toBe(false); // the two-line logo stands in there
    expect(introFits(1024, 768)).toBe(false); // 4:3
    expect(introFits(1920, 1200)).toBe(false); // 16:10
    expect(introFits(1920, 0)).toBe(false);
  });

  it('begins and ends on the bounce style with the glad line, and is timed inside the video', () => {
    expect(FLAGSHIP_INTRO_PICK).toEqual({ style: 'bounce', version: 'glad' });
    expect(FLAGSHIP_STYLES).toContain(FLAGSHIP_INTRO_PICK.style);
    expect(FLAGSHIP_VERSIONS).toContain(FLAGSHIP_INTRO_PICK.version);
    // Both hand-overs (video in, then the tab and waves out) fit inside the
    // video's opening still (frames 1-18 at 30 fps, video/awana-intro).
    expect(FLAGSHIP_INTRO.fade * 2).toBeLessThan(18 / 30);
    // The tab and waves come back after its world has flattened (frame 418)
    // and before it ends (15 s).
    expect(FLAGSHIP_INTRO.homeAt).toBeGreaterThan(418 / 30);
    expect(FLAGSHIP_INTRO.homeAt).toBeLessThan(15);
    expect(FLAGSHIP_INTRO_SRC).toBe('./intro/awana-intro.mp4');
  });
});

describe('the 3D intro\'s fade, written twice', () => {
  it('is the same number in flagship.js and both stylesheets', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = (f) => readFileSync(resolve(__dirname, '../styles', f), 'utf8');
    const fade = `var(--intro-fade, ${FLAGSHIP_INTRO.fade}s)`;
    expect(css('flagship.css')).toContain(fade);
    expect(css('app.css')).toContain(fade);
  });
});
