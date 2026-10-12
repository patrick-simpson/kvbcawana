import { describe, expect, it } from 'vitest';
import {
  autoSlideDeck, calendarSlidesFor, effectiveManualSlides, isSlideDriven, promoSlotFor, promosAreOn,
  snowPhoneAsksWeather, tonightTitleOf, visibleManualSlides, wantsSnowForecast,
} from './lobbyDeck.js';

const slide = (id, extra = {}) => ({ id, type: 'text', text: id, ...extra });

describe('effectiveManualSlides', () => {
  const own = [slide('own')];
  it('uses this device\'s deck when there is no published one, or it is not followed', () => {
    expect(effectiveManualSlides(true, null, own)).toBe(own);
    expect(effectiveManualSlides(false, { slides: [slide('pub')] }, own)).toBe(own);
  });
  it('lets an empty published deck win (the operator cleared the slides everywhere)', () => {
    expect(effectiveManualSlides(true, { slides: [] }, own)).toEqual([]);
  });
  it('uses the published deck, and keeps this device\'s video slides in it', () => {
    const video = { id: 'v', type: 'video', videoId: 'vid-1' };
    const got = effectiveManualSlides(true, { slides: [slide('pub')] }, [slide('own'), video]);
    expect(got.map((s) => s.id)).toEqual(expect.arrayContaining(['pub', 'v']));
    expect(got.map((s) => s.id)).not.toContain('own');
  });
});

describe('visibleManualSlides', () => {
  it('retires a dated slide the morning after its last day, on the local date key', () => {
    const slides = [slide('a'), slide('b', { showUntil: '2027-03-01' })];
    expect(visibleManualSlides(slides, '2027-03-01').map((s) => s.id)).toEqual(['a', 'b']);
    expect(visibleManualSlides(slides, '2027-03-02').map((s) => s.id)).toEqual(['a']);
  });
  it('is empty when every slide has expired', () => {
    expect(visibleManualSlides([slide('b', { showUntil: '2027-03-01' })], '2027-04-01')).toEqual([]);
  });
});

describe('calendarSlidesFor', () => {
  const base = {
    events: [], todayStr: '2027-02-03', specialDates: {}, welcomeText: '', showWelcome: true, showNextWeek: true, showRemaining: true,
  };
  it('is no slides with the calendar off', () => {
    expect(calendarSlidesFor({ ...base, enabled: false })).toEqual([]);
  });
  it('builds an array with the calendar on', () => {
    expect(Array.isArray(calendarSlidesFor({ ...base, enabled: true }))).toBe(true);
  });
});

describe('promos', () => {
  it('are on only with the calendar on and not switched off', () => {
    expect(promosAreOn(true, undefined)).toBe(true);
    expect(promosAreOn(true, true)).toBe(true);
    expect(promosAreOn(true, false)).toBe(false);
    expect(promosAreOn(false, true)).toBe(false);
  });
  it('ask for the snow forecast only in season, with the slide possible, off an overlay feed', () => {
    expect(wantsSnowForecast(true, '2027-01-15', false)).toBe(true);
    expect(wantsSnowForecast(true, '2027-09-15', false)).toBe(false);
    expect(wantsSnowForecast(false, '2027-01-15', false)).toBe(false);
    expect(wantsSnowForecast(true, '2027-01-15', true)).toBe(false);
  });
  it('ask for the weather for the snow slide\'s phone in season', () => {
    expect(snowPhoneAsksWeather({ calendarEnabled: true, seasonPromos: true }, '2027-01-15')).toBe(true);
    expect(snowPhoneAsksWeather({ calendarEnabled: true }, '2027-01-15')).toBe(true);
    expect(snowPhoneAsksWeather({ calendarEnabled: true, seasonPromos: false }, '2027-01-15')).toBe(false);
    expect(snowPhoneAsksWeather({ calendarEnabled: false, seasonPromos: true }, '2027-01-15')).toBe(false);
    expect(snowPhoneAsksWeather({ calendarEnabled: true, seasonPromos: true }, '2027-09-15')).toBe(false);
  });
  it('make no slot when off, or without a feed', () => {
    expect(promoSlotFor([], '2026-10-14', { specialDates: {}, enabled: false, snowForecast: null })).toBeNull();
    expect(promoSlotFor(null, '2026-10-14', { specialDates: {}, enabled: true, snowForecast: null })).toBeNull();
  });
});

describe('autoSlideDeck', () => {
  it('appends the promo slot after the calendar slides, or passes them through', () => {
    const cal = [slide('c1')];
    const promo = { id: 'promo' };
    expect(autoSlideDeck(cal, promo)).toEqual([slide('c1'), promo]);
    expect(autoSlideDeck(cal, null)).toBe(cal);
  });
});

describe('tonightTitleOf', () => {
  it('is null with no feed', () => {
    expect(tonightTitleOf([], '2027-02-03', {})).toBeNull();
  });
});

describe('isSlideDriven', () => {
  const q = { overlay: false, backgroundSource: 'manual', autoCount: 1, manualCount: 1 };
  it('is driven by a typed deck of more than one slide on a screen', () => {
    expect(isSlideDriven(q)).toBe(true);
    expect(isSlideDriven({ ...q, autoCount: 0, manualCount: 1 })).toBe(false);
    expect(isSlideDriven({ ...q, backgroundSource: 'video' })).toBe(false);
    expect(isSlideDriven({ ...q, overlay: true })).toBe(false);
  });
});
