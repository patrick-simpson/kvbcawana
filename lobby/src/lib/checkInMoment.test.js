import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  momentFor, kickerFor, sublineFor, stickerFor, nameBox, nameRoomU, nameSizeU, nameUnderKicker, COPY_LEFT_U, COPY_RIGHT_U,
  KICKER_MARGIN_U, KICKER_TRACKING, KICKER_U, NAME_LINE_HEIGHT, NAME_MARK_CLEAR_U, NAME_ROOM_U, NAME_MIN_U, NAME_SHADOW_U,
  NAME_STEPS, RUN_EXIT_MS, WAVE_EXIT,
} from './checkInMoment.js';
import { markExtents } from './brand.js';
import { hostClearancePx } from './embed.js';

describe('momentFor', () => {
  it('ranks birthday over first-timer over welcome-back over welcome', () => {
    expect(momentFor({ isBirthday: true, isFirstTimer: true, welcomeBack: true })).toBe('birthday');
    expect(momentFor({ isFirstTimer: true, welcomeBack: true })).toBe('first');
    expect(momentFor({ welcomeBack: true })).toBe('back');
    expect(momentFor({})).toBe('welcome');
  });
});

describe('kickerFor', () => {
  it('names the kind of arrival', () => {
    expect(kickerFor({}, 'birthday')).toBe('Happy birthday');
    expect(kickerFor({}, 'first')).toBe('Welcome to Awana Clubs');
    expect(kickerFor({}, 'back')).toBe('Welcome back');
    expect(kickerFor({ presentation: 'late' }, 'welcome')).toBe('Welcome');
  });

  it('says a replayed recap is not happening now', () => {
    expect(kickerFor({ presentation: 'replay' }, 'welcome')).toBe('Also joined us tonight');
    expect(kickerFor({ presentation: 'replay' }, 'birthday')).toBe('Also joined us tonight');
  });
});

describe('sublineFor', () => {
  it('a birthday-week ribbon replaces the day-claiming tagline', () => {
    expect(sublineFor('birthday')).toMatch(/special day/);
    expect(sublineFor('birthday', { ribbon: 'Birthday this Friday!' })).toBe('Birthday this Friday!');
  });

  it('first-timers and returning kids get their own line, and ignore phrase and ribbon', () => {
    expect(sublineFor('first', { phrase: 'Go Sparks!' })).toMatch(/very first time/);
    expect(sublineFor('back', { ribbon: 'Birthday this Friday!' })).toMatch(/brand-new season/);
  });

  it('a plain welcome carries the ribbon and the club phrase, or nothing', () => {
    expect(sublineFor('welcome')).toBeNull();
    expect(sublineFor('welcome', { phrase: 'Go Sparks!' })).toBe('Go Sparks!');
    expect(sublineFor('welcome', { ribbon: 'Birthday this Friday!' })).toBe('Birthday this Friday!');
    expect(sublineFor('welcome', { ribbon: 'Birthday this Friday!', phrase: 'Go Sparks!' }))
      .toBe('Birthday this Friday! · Go Sparks!');
    expect(sublineFor('welcome', { phrase: '   ' })).toBeNull();
  });
});

describe('stickerFor', () => {
  it('only birthdays and first-timers get the hot sticker', () => {
    expect(stickerFor('birthday')).toEqual(['Happy', 'birthday!']);
    expect(stickerFor('first')).toEqual(['New!']);
    expect(stickerFor('back')).toBeNull();
    expect(stickerFor('welcome')).toBeNull();
  });

  it('never claims an age: no numbers on a birthday sticker', () => {
    expect(stickerFor('birthday').join(' ')).not.toMatch(/\d/);
  });
});

describe('nameSizeU', () => {
  const em = (perChar) => (t) => [...t].length * perChar;

  it('uses the catalog step for short names', () => {
    expect(nameSizeU('MAYA', em(0.7)).size).toBe(10.6);
    expect(nameSizeU('SOPHIA', em(0.7)).size).toBe(10.6);
    expect(nameSizeU('ISABELLA', em(0.7)).size).toBe(9.1);
    expect(nameSizeU('CHRISTOPHER', em(0.7)).size).toBe(7.6);
  });

  it('holds the mockup\'s cap heights: its Galindo steps (10u, 8.6u, 7.2u) times 1.057, Paytone One\'s shorter caps', () => {
    expect(NAME_STEPS.map(([, u]) => u)).toEqual([10.6, 9.1, 7.6]);
    [10, 8.6, 7.2].forEach((mock, i) => expect(Math.abs(NAME_STEPS[i][1] - mock * 1.057)).toBeLessThanOrEqual(0.05));
  });

  it('shrinks a name that would not fit the column at its step', () => {
    const { size, wraps } = nameSizeU('BARTHOLOMEW', em(1));
    expect(size).toBeCloseTo(NAME_ROOM_U / 11, 1);
    expect(size * 11).toBeLessThanOrEqual(NAME_ROOM_U + 0.01);
    expect(wraps).toBe(false);
  });

  it('never goes below the floor, and only wraps between words', () => {
    const long = 'MARY ELIZABETH ANNE-CATHERINE MARGARET';
    const r = nameSizeU(long, em(0.8));
    expect(r.size).toBe(NAME_MIN_U);
    expect(r.wraps).toBe(true);
    const oneWord = 'X'.repeat(60);
    const w = nameSizeU(oneWord, em(0.8));
    expect(w.size).toBe(NAME_MIN_U);
    expect(w.wraps).toBe(false);
  });

  it('survives a measure that reports nothing', () => {
    expect(nameSizeU('MAYA', () => 0).size).toBe(10.6);
    expect(nameSizeU('', em(1)).size).toBe(10.6);
  });
});

describe('nameRoomU: the column ends short of an embedding host\'s toggle', () => {
  // Inside the Journey kiosk's frame, Journey's 48px buttons float over the
  // bottom-right corner, in the rows a name sits on, and a name long
  // enough to fill the column (MAXIMILIANA WOLFESCHLEGEL, MARY KATHERINE) ran
  // under it on every screen.
  const em = (perChar) => (t) => [...t].length * perChar;
  const clearU = (vw, vh) => {
    const u = Math.min(vw / 100, (vh * 1.7778) / 100);
    return { stageU: vw / u, clear: hostClearancePx(vw) / u, u };
  };

  it('is NAME_ROOM_U standalone, on any screen', () => {
    expect(nameRoomU(100, 0)).toBe(NAME_ROOM_U);
    expect(nameRoomU(100, COPY_RIGHT_U)).toBe(NAME_ROOM_U);
    // A screen wider than 16:9 has more than 100u across: still the same column.
    expect(nameRoomU(133, 0)).toBe(NAME_ROOM_U);
  });

  it.each([[640, 480], [592, 432], [1280, 720], [1920, 1080]])(
    'embedded at %ix%i, a name that fills its room ends left of the toggle',
    (vw, vh) => {
      const { stageU, clear, u } = clearU(vw, vh);
      const room = nameRoomU(stageU, clear);
      expect(room).toBeLessThan(NAME_ROOM_U);
      // The name's right edge, in px, against the toggle's left edge.
      const nameRight = (COPY_LEFT_U + room) * u;
      const toggleLeft = vw - Math.max(0.03 * vw, 24) - 48;
      expect(nameRight).toBeLessThan(toggleLeft);
      // And a long name really is sized to it.
      const long = 'MAXIMILIANA WOLFESCHLEGEL';
      // (nameSizeU rounds the size to 0.01u, so it may run 0.005u an em
      // over, inside the air the room leaves for the shadow.)
      const width = long.length * 0.62;
      const { size } = nameSizeU(long, em(0.62), room);
      expect(size * width).toBeLessThanOrEqual(room + 0.005 * width + 1e-9);
    },
  );

  it('keeps the air NAME_ROOM_U leaves for the shadow', () => {
    const air = 100 - COPY_LEFT_U - COPY_RIGHT_U - NAME_ROOM_U;
    expect(nameRoomU(100, 12.5)).toBeCloseTo(100 - COPY_LEFT_U - 12.5 - air, 9);
  });

  it('a name that fits at its step is not touched by it', () => {
    expect(nameSizeU('BARTHOLOMEW', em(0.7), nameRoomU(100, 12.5)).size).toBe(nameSizeU('BARTHOLOMEW', em(0.7)).size);
  });

  it('its column is the stylesheet\'s .checkin__copy', () => {
    const css = readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8');
    const rule = css.match(/\n\.checkin__copy \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain(`left: calc(${COPY_LEFT_U} * var(--u))`);
    expect(rule).toContain(`right: calc(${COPY_RIGHT_U} * var(--u))`);
  });
});

describe('nameBox: room for a tall mark, clear of the kicker and the line', () => {
  const ink = (under, whole = under) => ({ under: markExtents(under), whole: markExtents(whole) });
  const at = { sizeU: 10.6, line: true };

  it('a plain name has none, at the plain line height', () => {
    for (const name of ['MAYA', 'BARTHOLOMEW', 'QUINN', 'JJ']) {
      expect(nameBox(ink(name), at)).toEqual({ lineHeight: NAME_LINE_HEIGHT, padTop: 0, padBottom: 0 });
    }
  });

  it('an accent under the kicker drops it clear, a stacked one further; one past its end needs nothing', () => {
    const emile = nameBox(ink('É'), at);
    const nguyen = nameBox(ink('NGUYỄ'), at);
    expect(emile.padTop).toBeGreaterThan(0.15);
    expect(emile.padBottom).toBe(0);
    expect(nguyen.padTop).toBeGreaterThan(emile.padTop);
    // JOSÉ under a short WELCOME: only JO sits under it.
    expect(nameBox(ink('JO', 'JOSÉ'), at)).toMatchObject({ padTop: 0, padBottom: 0 });
  });

  it('keeps the mark NAME_MARK_CLEAR_U off the kicker\'s letters, using its margin and foot', () => {
    // Real ink: É to 1.045em. The box's top is 0.737em up at the plain line
    // height; the kicker's caps stand KICKER_MARGIN_U + its foot above that.
    const { padTop } = nameBox({ under: { ascent: 1.045, descent: 0 }, whole: { ascent: 1.045, descent: 0 } }, at);
    const markTopU = (1.045 - 0.737 - padTop) * at.sizeU;
    expect(markTopU).toBeCloseTo(KICKER_MARGIN_U + 0.1465 * KICKER_U - NAME_MARK_CLEAR_U, 1);
  });

  it('a comma below gets room over the line under the name, and none when there is no line', () => {
    const stefan = nameBox(ink('ȘTEFAN'), at);
    expect(stefan.padTop).toBe(0);
    expect(stefan.padBottom).toBeGreaterThan(0.1);
    expect(nameBox(ink('ȘTEFAN'), { ...at, line: false }).padBottom).toBe(0);
    // Real ink: the comma and the shadow under it end exactly at the box.
    const real = nameBox({ under: { ascent: 0.7, descent: 0.351 }, whole: { ascent: 0.7, descent: 0.351 } }, at);
    expect(0.213 + real.padBottom).toBeCloseTo(0.351 + 0.45 / at.sizeU, 2);
  });

  it('finds the letters under the kicker by measuring them', () => {
    const em = (t) => [...t].length * 0.7;
    // 10u of kicker over a 10u name: a letter is 7u, so two start under it.
    expect(nameUnderKicker('ÉMILE', 10, 10, em)).toBe('ÉM');
    expect(nameUnderKicker('JOSÉ', 10, 10, em)).toBe('JO');
    expect(nameUnderKicker('JOSÉ', 30, 10, em)).toBe('JOSÉ');
    expect(nameUnderKicker('', 30, 10, em)).toBe('');
  });

  it('a name that wraps opens its rows until one row\'s marks clear the next', () => {
    const whole = markExtents('ȘTEFAN-ANDREI NGUYỄN');
    const wrapped = nameBox({ under: whole, whole }, { ...at, wraps: true });
    expect(wrapped.lineHeight).toBeGreaterThanOrEqual(whole.ascent + whole.descent + 0.1 - 1e-9);
    expect(nameBox(ink('MARY ELIZABETH'), { ...at, wraps: true }).lineHeight).toBe(NAME_LINE_HEIGHT);
  });

  it('its kicker numbers are the stylesheet\'s', () => {
    const css = readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8');
    const rule = css.match(/\.checkin__kicker \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain(`font-size: calc(${KICKER_U} * var(--u))`);
    expect(rule).toContain(`letter-spacing: ${KICKER_TRACKING}em`);
    expect(rule).toContain(`margin-bottom: calc(${KICKER_MARGIN_U} * var(--u))`);
    const name = css.match(/\.checkin__name \{([^}]*)\}/)?.[1] ?? '';
    expect(name).toContain(`line-height: ${NAME_LINE_HEIGHT}`);
    expect(name).toContain(`text-shadow: calc(${NAME_SHADOW_U} * var(--u)) calc(${NAME_SHADOW_U} * var(--u))`);
  });
});

describe('RUN_EXIT_MS', () => {
  it('covers the slowest wave drop, so the next run never starts its hold mid-exit', () => {
    for (const w of Object.values(WAVE_EXIT)) {
      expect(RUN_EXIT_MS).toBeGreaterThanOrEqual((w.delay + w.duration) * 1000);
    }
    // ...and not by much: the gap is dead air between two children.
    expect(RUN_EXIT_MS).toBeLessThan(1000);
  });
});
