import { describe, it, expect } from 'vitest';
import {
  buildCalendarSlides,
  dateChip,
  daysBetween,
  deriveClubInfo,
  formatShortDate,
  isStoreNight,
  localDateStr,
  splitTitle,
} from './calendarLogic.js';

const club = (date, title = 'Awana meeting', extra = {}) => ({
  date, kind: 'club', title,
  isCancelled: false,
  isSpecial: !/^awana meeting$/i.test(title),
  ...extra,
});
const cancelled = (date) => club(date, 'No Awana this week', { isCancelled: true, isSpecial: false });
const note = (date, title) => ({ date, kind: 'note', title, isCancelled: false, isSpecial: false });

describe('localDateStr', () => {
  it('uses LOCAL components — late evening must not roll to tomorrow', () => {
    // 11:59 PM local on Sep 9. toISOString() in any western timezone
    // would already say Sep 10 — the exact club-hours regression.
    expect(localDateStr(new Date(2026, 8, 9, 23, 59))).toBe('2026-09-09');
    expect(localDateStr(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('splitTitle', () => {
  it('splits headline from note on the first spaced hyphen', () => {
    expect(splitTitle('Water Night - Poster Contest kicks off'))
      .toEqual({ title: 'Water Night', note: 'Poster Contest kicks off' });
    expect(splitTitle('Awards Night - final night of the year!'))
      .toEqual({ title: 'Awards Night', note: 'final night of the year!' });
  });

  it('leaves plain and hyphenated titles alone', () => {
    expect(splitTitle('Backwards Night')).toEqual({ title: 'Backwards Night', note: '' });
    expect(splitTitle('Glow-in-the-dark Night')).toEqual({ title: 'Glow-in-the-dark Night', note: '' });
    expect(splitTitle('A - B - C')).toEqual({ title: 'A', note: 'B - C' });
    expect(splitTitle('')).toEqual({ title: '', note: '' });
  });
});

describe('isStoreNight', () => {
  it('matches any store mention, case-insensitively', () => {
    expect(isStoreNight('Awana Store Night')).toBe(true);
    expect(isStoreNight('STORE night - bring your shekels')).toBe(true);
    expect(isStoreNight('Water Night')).toBe(false);
  });
});

describe('formatShortDate', () => {
  it('formats via the local constructor (never UTC parsing)', () => {
    expect(formatShortDate('2026-09-09')).toBe('Wed, Sep 9');
    expect(formatShortDate('2027-05-26')).toBe('Wed, May 26');
    expect(formatShortDate('garbage')).toBe('');
  });
});

describe('daysBetween', () => {
  it('is exact across the November DST fall-back', () => {
    expect(daysBetween('2026-10-28', '2026-11-04')).toBe(7);
  });
  it('handles same-day and reversed order', () => {
    expect(daysBetween('2026-09-09', '2026-09-09')).toBe(0);
    expect(daysBetween('2026-09-16', '2026-09-09')).toBe(-7);
  });
});

describe('deriveClubInfo', () => {
  const season = [
    cancelled('2026-08-26'),
    club('2026-09-09', 'Water Night - Poster Contest kicks off'),
    club('2026-09-16'),
    cancelled('2026-09-23'),
    club('2026-09-30'),
    note('2026-10-03', 'Build Day'),
    club('2026-10-07', 'Awards Night - final night of the year!'),
  ];

  it('finds tonight by exact local-date match', () => {
    const info = deriveClubInfo(season, '2026-09-09');
    expect(info.tonight?.title).toContain('Water Night');
    expect(info.nextEntry?.date).toBe('2026-09-16');
    expect(info.nightsRemaining).toBe(3); // 16th, 30th, Oct 7 — after tonight
  });

  it('a cancelled date is not "tonight"', () => {
    const info = deriveClubInfo(season, '2026-09-23');
    expect(info.tonight).toBeNull();
    expect(info.nextNight?.date).toBe('2026-09-30');
  });

  it('nextEntry sees cancelled weeks, nextNight skips them', () => {
    const info = deriveClubInfo(season, '2026-09-16');
    expect(info.nextEntry?.isCancelled).toBe(true);
    expect(info.nextNight?.date).toBe('2026-09-30');
  });

  it('day-notes never count as club nights or remaining nights', () => {
    const info = deriveClubInfo(season, '2026-09-30');
    expect(info.nextEntry?.date).toBe('2026-10-07'); // skips the Build Day note
    expect(info.nightsRemaining).toBe(1);
  });

  it('flags season end', () => {
    const info = deriveClubInfo(season, '2026-10-07');
    expect(info.tonight?.title).toContain('Awards Night');
    expect(info.nightsRemaining).toBe(0);
    expect(info.seasonOver).toBe(true);
  });

  it('tolerates garbage input', () => {
    expect(deriveClubInfo(null, '2026-09-09').tonight).toBeNull();
    expect(deriveClubInfo([{}, null, 'x'], '2026-09-09').nightsRemaining).toBe(0);
  });

  // ── shared/schedule.json specialDates (#342) ─────────────────────────────
  // The projector already knew next Wednesday was cancelled; the lobby TV
  // counted it toward "nights remaining" anyway. One shared file, one answer.
  describe('with the shared schedule\'s break weeks', () => {
    const breakWeeks = { '2026-09-16': { noClub: true, label: 'Thanksgiving Break' } };

    it('subtracts a no-club date from nights remaining', () => {
      expect(deriveClubInfo(season, '2026-09-09').nightsRemaining).toBe(3);
      // The 16th is now a break week: 30th and Oct 7 remain.
      expect(deriveClubInfo(season, '2026-09-09', breakWeeks).nightsRemaining).toBe(2);
    });

    it('skips it for nextNight while nextEntry still sees it', () => {
      const info = deriveClubInfo(season, '2026-09-09', breakWeeks);
      expect(info.nextEntry?.date).toBe('2026-09-16');
      expect(info.nextEntry?.isCancelled).toBe(true);
      expect(info.nextNight?.date).toBe('2026-09-30');
    });

    it('is not "tonight" when the shared file cancelled today', () => {
      const info = deriveClubInfo(season, '2026-09-16', breakWeeks);
      expect(info.tonight).toBeNull();
      expect(info.nextNight?.date).toBe('2026-09-30');
    });

    it('carries the shared label without overwriting the calendar title', () => {
      // Both facts matter: the calendar's title may be a real event name, and
      // the shared label is the church's words for why it is not happening.
      const info = deriveClubInfo(season, '2026-09-09', breakWeeks);
      expect(info.nextEntry.noClubLabel).toBe('Thanksgiving Break');
      expect(info.nextEntry.title).toBe('Awana meeting');
    });

    it('leaves a label-only (not no-club) entry completely alone', () => {
      const info = deriveClubInfo(season, '2026-09-09', { '2026-09-16': { label: 'Fall Festival' } });
      expect(info.nightsRemaining).toBe(3);
      expect(info.nextEntry?.isCancelled).toBe(false);
      expect(info.nextEntry.noClubLabel).toBeUndefined();
    });

    it('never double-counts a week the calendar ALREADY cancelled', () => {
      const info = deriveClubInfo(season, '2026-09-16', { '2026-09-23': { noClub: true } });
      expect(info.nightsRemaining).toBe(2); // 30th and Oct 7
    });

    it('ignores a missing or malformed table exactly as before', () => {
      for (const table of [undefined, null, 'nope', 42]) {
        expect(deriveClubInfo(season, '2026-09-09', table).nightsRemaining).toBe(3);
      }
    });
  });
});

describe('buildCalendarSlides', () => {
  const ids = (slides) => slides.map((s) => s.id);
  const byId = (slides, id) => slides.find((s) => s.id === id);

  it('special tonight → "Welcome to X!" with the note as subtext', () => {
    const info = deriveClubInfo([club('2026-09-09', 'Water Night - Poster Contest kicks off'), club('2026-09-16')], '2026-09-09');
    const welcome = byId(buildCalendarSlides(info, {}), 'cal_welcome');
    expect(welcome.text).toBe('Welcome to Water Night!');
    expect(welcome.subtext).toBe('Poster Contest kicks off');
    expect(welcome.eyebrow).toBe('Tonight');
  });

  it('regular tonight → configurable welcome wording', () => {
    const info = deriveClubInfo([club('2026-09-16'), club('2026-09-23')], '2026-09-16');
    const slides = buildCalendarSlides(info, { calendarWelcomeText: 'Welcome to KVB Awana!' });
    expect(byId(slides, 'cal_welcome').text).toBe('Welcome to KVB Awana!');
  });

  it('off-day → points at the next night; special titles announced, regular just dated', () => {
    const special = deriveClubInfo([club('2026-09-09', 'Water Night')], '2026-09-07');
    expect(byId(buildCalendarSlides(special, {}), 'cal_welcome').text).toBe('Water Night — Wed, Sep 9');

    const regular = deriveClubInfo([club('2026-09-16')], '2026-09-14');
    expect(byId(buildCalendarSlides(regular, {}), 'cal_welcome').text).toBe('See you Wed, Sep 16!');
  });

  it('off-day store night is NEVER announced by name', () => {
    const info = deriveClubInfo([club('2026-09-16', 'Awana Store Night')], '2026-09-14');
    const welcome = byId(buildCalendarSlides(info, {}), 'cal_welcome');
    expect(welcome.text).toBe('See you Wed, Sep 16!');
    expect(JSON.stringify(buildCalendarSlides(info, {}))).not.toMatch(/store/i);
  });

  it('next week special → announcement slide with note', () => {
    const info = deriveClubInfo([club('2026-09-09'), club('2026-09-16', 'Backwards Night')], '2026-09-09');
    const next = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(next.text).toBe('Next week: Backwards Night');
  });

  it('next week cancelled → "No club next week" with the comeback date', () => {
    // 2026-09-09 is a Wednesday; the cancelled row is the following week.
    const info = deriveClubInfo(
      [club('2026-09-09'), cancelled('2026-09-16'), club('2026-09-23')],
      '2026-09-09'
    );
    const next = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(next.text).toBe('No club next week');
    // The boilerplate "No Awana this week" title must NOT echo under a
    // "next week" headline — the comeback date is the useful subtext.
    expect(next.subtext).toBe('Back Wed, Sep 23');
  });

  it('cancelled night later THIS week → "this week" phrasing', () => {
    // Tuesday before a cancelled Wednesday: "next week" would be wrong.
    const info = deriveClubInfo(
      [cancelled('2026-09-16'), club('2026-09-23')],
      '2026-09-15'
    );
    const next = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(next.text).toBe('No club this week');
    expect(next.subtext).toBe('Back Wed, Sep 23');
  });

  it('summer break → "Club is on a break", not "next week"', () => {
    // Mid-July: weeks of cancelled rows, club resumes in September.
    const info = deriveClubInfo(
      [cancelled('2026-07-15'), cancelled('2026-07-22'), cancelled('2026-08-26'), club('2026-09-02')],
      '2026-07-14'
    );
    const next = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(next.text).toBe('Club is on a break');
    expect(next.subtext).toBe('Back Wed, Sep 2');
  });

  it('no weather slides in the rotation — weather lives in the corner chip', () => {
    // Break week, regular week, and empty calendar: none emit cal_weather.
    const breakWeek = deriveClubInfo(
      [cancelled('2026-07-15'), cancelled('2026-07-22'), club('2026-09-02')],
      '2026-07-14'
    );
    expect(ids(buildCalendarSlides(breakWeek, {}))).not.toContain('cal_weather');
  });

  it('a real cancellation reason survives; boilerplate does not', () => {
    const info = deriveClubInfo(
      [club('2026-12-16'), club('2026-12-23', 'Christmas Break', { isCancelled: true, isSpecial: false }), club('2026-12-30')],
      '2026-12-16'
    );
    const next = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(next.subtext).toBe('Christmas Break — Back Wed, Dec 30');
  });

  // #342 — the break week came from the SHARED schedule, not the church
  // calendar, so the shared file's label is what names the reason.
  it('a shared-schedule break week names its label on the heads-up slide', () => {
    const info = deriveClubInfo(
      [club('2026-11-18'), club('2026-11-25'), club('2026-12-02')],
      '2026-11-18',
      { '2026-11-25': { noClub: true, label: 'Thanksgiving Break' } },
    );
    const next = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(next.text).toBe('No club next week');
    expect(next.subtext).toBe('Thanksgiving Break — Back Wed, Dec 2');
    // …and the week it cancelled is gone from the count.
    const remaining = byId(buildCalendarSlides(info, {}), 'cal_remaining');
    expect(remaining.text).toBe('1 night remaining');
  });

  it('a shared break week with no label still says no club, with the comeback date', () => {
    const info = deriveClubInfo(
      [club('2026-11-18'), club('2026-11-25'), club('2026-12-02')],
      '2026-11-18',
      { '2026-11-25': { noClub: true } },
    );
    const next = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(next.text).toBe('No club next week');
    expect(next.subtext).toBe('Back Wed, Dec 2');
  });

  it('cancelled with no scheduled return → no comeback date, no boilerplate', () => {
    const info = deriveClubInfo([club('2026-09-09'), cancelled('2026-09-16')], '2026-09-09');
    const next = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(next.text).toBe('No club next week');
    expect(next.subtext).toBe('');
  });

  it('next week regular → nothing to tease, no slide in the slot', () => {
    const info = deriveClubInfo([club('2026-09-09'), club('2026-09-16')], '2026-09-09');
    expect(byId(buildCalendarSlides(info, {}), 'cal_next')).toBeUndefined();
  });

  it('next week is the store → no announcement, title never leaks', () => {
    const info = deriveClubInfo([club('2026-09-09'), club('2026-09-16', 'Awana Store Night - bring shekels')], '2026-09-09');
    const slides = buildCalendarSlides(info, {});
    expect(byId(slides, 'cal_next')).toBeUndefined();
    expect(JSON.stringify(slides)).not.toMatch(/store|shekel/i);
  });

  it('store tonight IS disclosed (masking is forward-looking only)', () => {
    const info = deriveClubInfo([club('2026-09-09', 'Awana Store Night'), club('2026-09-16')], '2026-09-09');
    expect(byId(buildCalendarSlides(info, {}), 'cal_welcome').text).toBe('Welcome to Awana Store Night!');
  });

  it('long break → "Coming up" phrasing instead of "next week"', () => {
    const info = deriveClubInfo([club('2026-12-16'), club('2027-01-06', 'Backwards Night')], '2026-12-16');
    const next = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(next.text).toBe('Coming up: Backwards Night — Wed, Jan 6');
  });

  it('night before the finale reads "Next week: Awards Night"', () => {
    const info = deriveClubInfo(
      [club('2027-05-19'), club('2027-05-26', 'Awards Night - final night of the year!')],
      '2027-05-19'
    );
    const slides = buildCalendarSlides(info, {});
    expect(byId(slides, 'cal_next').text).toBe('Next week: Awards Night');
    expect(byId(slides, 'cal_remaining').text).toBe('1 night remaining');
  });

  it('remaining slide shows only for 1–9 nights, with the book nudge', () => {
    const many = Array.from({ length: 12 }, (_, i) => club(`2026-10-${String(i + 10).padStart(2, '0')}`));
    expect(ids(buildCalendarSlides(deriveClubInfo(many, '2026-10-09'), {}))).not.toContain('cal_remaining');

    const nine = many.slice(0, 10); // tonight + 9 after
    const info = deriveClubInfo(nine, '2026-10-10');
    const remaining = byId(buildCalendarSlides(info, {}), 'cal_remaining');
    expect(remaining.text).toBe('9 nights remaining');
    expect(remaining.subtext).toBe('Is your child on track to finish their book?');
  });

  it('final night shows no remaining slide (0 after tonight)', () => {
    const info = deriveClubInfo([club('2027-05-26', 'Awards Night')], '2027-05-26');
    expect(ids(buildCalendarSlides(info, {}))).not.toContain('cal_remaining');
  });

  it('per-slide config toggles remove exactly their slide', () => {
    const info = deriveClubInfo(
      [club('2026-09-09'), club('2026-09-16', 'Backwards Night'), club('2026-09-23')],
      '2026-09-09'
    );
    expect(ids(buildCalendarSlides(info, { calendarShowWelcome: false }))).not.toContain('cal_welcome');
    expect(ids(buildCalendarSlides(info, { calendarShowRemaining: false }))).not.toContain('cal_remaining');
    expect(ids(buildCalendarSlides(info, { calendarShowNextWeek: false }))).not.toContain('cal_next');
  });

  it('every slide looks like a valid manual slide', () => {
    const info = deriveClubInfo(
      [club('2026-09-09', 'Water Night - fun'), cancelled('2026-09-16'), club('2026-09-23')],
      '2026-09-09'
    );
    for (const s of buildCalendarSlides(info, {})) {
      expect(typeof s.id).toBe('string');
      expect(s.text.length).toBeGreaterThan(0);
      expect(['sky', 'sunset', 'night', 'meadow', 'lavender']).toContain(s.theme);
      expect(s.durationSec).toBe(0);
    }
  });

  it('returns [] for null info or empty calendars', () => {
    expect(buildCalendarSlides(null, {})).toEqual([]);
    expect(buildCalendarSlides(deriveClubInfo([], '2026-09-09'), {})).toEqual([]);
  });
});

// The lobby's frame (src/lib/lobbyFrame.js) sets a calendar slide as kicker,
// headline and a stepped date chip (NEXT CLUB NIGHT / MAKING BOOKMARKS /
// WED SEP 30). The words are the same words; only the date moves onto the
// chip, and `text`/`subtext` above stay the whole sentence.
describe('dateChip', () => {
  it('puts the weekday on the label and the day on the value', () => {
    expect(dateChip('2026-09-30')).toEqual({ label: 'WED', value: 'SEP 30' });
    expect(dateChip('2026-12-02', 'Back')).toEqual({ label: 'BACK WED', value: 'DEC 2' });
  });

  it('names the same local day as formatShortDate', () => {
    for (const d of ['2026-01-01', '2026-03-08', '2026-11-01', '2026-12-31']) {
      const [wd, mo, day] = formatShortDate(d).replace(',', '').split(' ');
      expect(dateChip(d)).toEqual({ label: wd.toUpperCase(), value: `${mo.toUpperCase()} ${day}` });
    }
  });

  it('is null for anything that is not a date', () => {
    expect(dateChip('')).toBeNull();
    expect(dateChip('soon')).toBeNull();
  });
});

describe('calendar slides in the lobby frame', () => {
  const byId = (slides, id) => slides.find((s) => s.id === id);

  it('next club night: the title shouts, the date rides the chip', () => {
    const info = deriveClubInfo([club('2026-09-30', 'Making Bookmarks')], '2026-09-28');
    const s = byId(buildCalendarSlides(info, {}), 'cal_welcome');
    expect(s.text).toBe('Making Bookmarks — Wed, Sep 30');
    expect(s.frame).toEqual({ headline: 'Making Bookmarks', chip: { label: 'WED', value: 'SEP 30' } });
  });

  it('a regular or store night: "See you!" with the date on the chip, never the title', () => {
    const info = deriveClubInfo([club('2026-09-16', 'Awana Store Night')], '2026-09-14');
    const s = byId(buildCalendarSlides(info, {}), 'cal_welcome');
    expect(s.frame).toEqual({ headline: 'See you!', chip: { label: 'WED', value: 'SEP 16' } });
  });

  it('a break: the headline as before, the reason under it, the comeback on the chip', () => {
    const info = deriveClubInfo(
      [club('2026-12-16'), club('2026-12-23', 'Christmas Break', { isCancelled: true, isSpecial: false }), club('2026-12-30')],
      '2026-12-16'
    );
    const s = byId(buildCalendarSlides(info, {}), 'cal_next');
    expect(s.frame).toEqual({ headline: s.text, sub: 'Christmas Break', chip: { label: 'BACK WED', value: 'DEC 30' } });
  });

  it('a break with boilerplate: no reason line', () => {
    const info = deriveClubInfo([club('2026-09-09'), cancelled('2026-09-16'), club('2026-09-23')], '2026-09-09');
    expect(byId(buildCalendarSlides(info, {}), 'cal_next').frame.sub).toBe('');
  });

  it('a special night ahead: the announcement shouts, its date rides the chip', () => {
    const soon = deriveClubInfo([club('2026-09-09'), club('2026-09-16', 'Backwards Night - wear it wrong')], '2026-09-09');
    expect(byId(buildCalendarSlides(soon, {}), 'cal_next').frame).toEqual({
      headline: 'Next week: Backwards Night', sub: 'wear it wrong', chip: { label: 'WED', value: 'SEP 16' },
    });
    const later = deriveClubInfo([club('2026-12-16'), club('2027-01-06', 'Backwards Night')], '2026-12-16');
    expect(byId(buildCalendarSlides(later, {}), 'cal_next').frame.headline).toBe('Coming up: Backwards Night');
  });

  it('tonight and the countdown need no frame of their own', () => {
    const info = deriveClubInfo([club('2026-09-09'), club('2026-09-16')], '2026-09-09');
    const slides = buildCalendarSlides(info, {});
    expect(byId(slides, 'cal_welcome').frame).toBeUndefined();
    expect(byId(slides, 'cal_remaining').frame).toBeUndefined();
  });
});
