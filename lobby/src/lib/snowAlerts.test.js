import { describe, it, expect } from 'vitest';
import {
  SNOW_ALERT_SEC, SNOW_CADENCE, SNOW_INCHES, batteryLevel, inSnowSeason, lockTime, sampleAlertText, snowAlertCopy, snowOutlook,
} from './snowAlerts.js';

// Wednesdays, the shape the calendar feed delivers. 2026-12-02 is a Wednesday.
const club = (date, extra = {}) => ({ date, kind: 'club', title: 'Awana meeting', isCancelled: false, isSpecial: false, ...extra });
const winter = [club('2026-11-25'), club('2026-12-02'), club('2026-12-09'), club('2026-12-16')];
// A forecast from Sunday Nov 29 for eight days, all dry unless set.
const forecast = (snow = {}) => {
  const time = ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
  return { time, inches: time.map((t) => snow[t] ?? 0) };
};

describe('the snow season', () => {
  it('runs November 1 through March 31, every year', () => {
    expect(inSnowSeason('2026-10-31')).toBe(false);
    expect(inSnowSeason('2026-11-01')).toBe(true);
    expect(inSnowSeason('2026-12-25')).toBe(true);
    expect(inSnowSeason('2027-01-01')).toBe(true);
    expect(inSnowSeason('2027-03-31')).toBe(true);
    expect(inSnowSeason('2027-04-01')).toBe(false);
    expect(inSnowSeason('2027-07-04')).toBe(false);
    expect(inSnowSeason('2030-11-15')).toBe(true);
  });

  it('refuses anything that is not a date key', () => {
    expect(inSnowSeason('')).toBe(false);
    expect(inSnowSeason('December')).toBe(false);
    expect(inSnowSeason(undefined)).toBe(false);
  });

  it('keeps the owner’s cadence and a hold long enough to scan', () => {
    expect(SNOW_CADENCE).toEqual({ calm: 6, storm: 2 });
    expect(SNOW_INCHES).toBe(1);
    expect(SNOW_ALERT_SEC).toBe(20);
  });
});

describe('snowOutlook: is snow forecast near the next club night?', () => {
  it('flags an inch or more on the club night itself', () => {
    expect(snowOutlook(winter, '2026-11-29', forecast({ '2026-12-02': 3.2 }))).toEqual({
      date: '2026-12-02', when: 'later', weekday: 'Wednesday', inches: 3.2,
    });
  });

  it('flags snow the day before too: a Tuesday storm closes Wednesday’s roads', () => {
    expect(snowOutlook(winter, '2026-11-29', forecast({ '2026-12-01': 1.4 }))?.date).toBe('2026-12-02');
  });

  it('ignores snow on other days, and anything under an inch', () => {
    expect(snowOutlook(winter, '2026-11-29', forecast({ '2026-11-30': 6, '2026-12-04': 8 }))).toBeNull();
    expect(snowOutlook(winter, '2026-11-29', forecast({ '2026-12-02': 0.9 }))).toBeNull();
  });

  it('says tonight on the night, and tomorrow the day before', () => {
    expect(snowOutlook(winter, '2026-12-02', forecast({ '2026-12-02': 2 }))?.when).toBe('tonight');
    expect(snowOutlook(winter, '2026-12-01', forecast({ '2026-12-02': 2 }))?.when).toBe('tomorrow');
  });

  it('skips a night the calendar cancelled, and a week the shared schedule marks noClub', () => {
    const cancelled = winter.map((e) => (e.date === '2026-12-02' ? { ...e, isCancelled: true } : e));
    expect(snowOutlook(cancelled, '2026-11-29', forecast({ '2026-12-02': 4 }))).toBeNull();
    const special = { '2026-12-02': { noClub: true, label: 'Christmas break' } };
    expect(snowOutlook(winter, '2026-11-29', forecast({ '2026-12-02': 4 }), special)).toBeNull();
  });

  it('only looks at the coming week', () => {
    // The next club night is 9 days out: next month's storm is not this week's news.
    const far = [club('2026-12-09')];
    expect(snowOutlook(far, '2026-11-30', { time: ['2026-12-08', '2026-12-09'], inches: [5, 5] })).toBeNull();
  });

  it('says nothing without a forecast or a feed', () => {
    expect(snowOutlook(winter, '2026-11-29', null)).toBeNull();
    expect(snowOutlook(winter, '2026-11-29', { time: 'x', inches: [] })).toBeNull();
    expect(snowOutlook([], '2026-11-29', forecast({ '2026-12-02': 4 }))).toBeNull();
    expect(snowOutlook(null, '2026-11-29', forecast({ '2026-12-02': 4 }))).toBeNull();
  });

  it('treats a blank forecast day as no snow', () => {
    expect(snowOutlook(winter, '2026-11-29', { time: ['2026-12-02'], inches: [null] })).toBeNull();
  });
});

describe('snowAlertCopy: what the slide says', () => {
  it('is the ordinary-week sign-up pitch without a storm', () => {
    expect(snowAlertCopy(null)).toEqual({
      kicker: 'Snow day?',
      headline: ['Sign up for', 'cancellation', 'texts'],
      storm: false,
    });
  });

  it('names the night when snow is coming', () => {
    const at = (when) => snowAlertCopy({ date: '2026-12-02', when, weekday: 'Wednesday', inches: 3 });
    expect(at('later').kicker).toBe('Wednesday looks snowy');
    expect(at('tomorrow').kicker).toBe('Tomorrow looks snowy');
    expect(at('tonight').kicker).toBe('Tonight looks snowy');
    expect(at('later').storm).toBe(true);
    expect(at('later')).not.toHaveProperty('body');
    // The headline is the same either way: the urgency is in the kicker.
    expect(at('later').headline).toEqual(snowAlertCopy(null).headline);
  });

  it('never uses an em dash or a straight apostrophe', () => {
    for (const o of [null, { date: '2026-12-02', when: 'later', weekday: 'Wednesday', inches: 2 }]) {
      const c = snowAlertCopy(o);
      const all = [c.kicker, ...c.headline].join(' ');
      expect(all).not.toContain('—');
      expect(all).not.toContain("'");
    }
  });
});

describe('sampleAlertText: the phone’s example text', () => {
  it('is the church’s real message, dated the day it airs', () => {
    expect(sampleAlertText(new Date(2026, 11, 11, 16, 30))).toEqual({
      weekday: 'Friday',
      lockDate: 'Fri, Dec 11',
      text: 'Awana has been cancelled on 12/11/26 at KVBC. Clubbers should come prepared with both weeks’ sections next week.',
    });
    expect(sampleAlertText(new Date(2027, 0, 6)).text).toContain('on 1/6/27 at KVBC');
    expect(sampleAlertText(new Date(2027, 0, 6)).weekday).toBe('Wednesday');
  });
});

describe('the phone’s live lock screen', () => {
  it('keeps a Pixel’s 12-hour clock', () => {
    expect(lockTime(new Date(2026, 11, 2, 16, 30))).toBe('4:30');
    expect(lockTime(new Date(2026, 11, 2, 0, 5))).toBe('12:05');
    expect(lockTime(new Date(2026, 11, 2, 12, 0))).toBe('12:00');
    expect(lockTime(new Date(2026, 11, 2, 9, 7))).toBe('9:07');
  });

  it('reads tonight’s check-ins as the battery, stopping at 100', () => {
    expect(batteryLevel(0)).toBe(0);
    expect(batteryLevel(47)).toBe(47);
    expect(batteryLevel(100)).toBe(100);
    expect(batteryLevel(163)).toBe(100);
    expect(batteryLevel(null)).toBe(0);
    expect(batteryLevel(undefined)).toBe(0);
    expect(batteryLevel(-3)).toBe(0);
  });
});
