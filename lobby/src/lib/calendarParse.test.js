import { describe, it, expect } from 'vitest';
import calendarHtml from './__fixtures__/calendar-2026.html?raw';
import {
  isRegularTitle,
  parseCalendarHtml,
  sanitizeEvents,
  sanitizeFeed,
} from './calendarParse.js';

// Handy hand-rolled daylines mirroring the three real page shapes.
const CLUB_NIGHT = `
  <div id='D2026-09-16' class='dayline '>
    <div class="mtg-container">
      <div class='msg'><span class='desc'>Awana meeting</span></div>
      <div class='msg'>
        <span class="fields" style="display:none" calendar_date="2026-09-16"></span>
        <span class="desc" style="display: none">Awana meeting</span>
      </div>
    </div>
  </div>`;

const SPECIAL_NIGHT = `
  <div id='D2026-09-09' class='dayline '>
    <div class="mtg-container">
      <div class='msg'><span class='desc'>Water Night - Poster Contest kicks off</span></div>
      <div class='msg'>
        <span class="fields" style="display:none" calendar_date="2026-09-09"></span>
        <span class="desc" style="display: none">Awana meeting</span>
      </div>
    </div>
  </div>`;

const CANCELLED_WEEK = `
  <div id='D2026-07-15' class='dayline '>
    <div class='msg skipped'>
      <div>No Awana this week </div>
      <span class="fields" style="display:none" calendar_date="2026-07-15"></span>
      <span class="desc" style="display: none">Awana meeting</span>
    </div>
  </div>`;

const DAY_NOTE = `
  <div id='D2027-03-06' class='dayline '>
    <div class='day-note'>Build Day </div>
  </div>`;

describe('parseCalendarHtml on the real fixture', () => {
  const events = parseCalendarHtml(calendarHtml);

  it('finds every day entry across the club year', () => {
    expect(events).toHaveLength(53);
    expect(events[0]).toEqual({
      date: '2026-07-15', kind: 'club', title: 'No Awana this week', isCancelled: true, isSpecial: false,
    });
    expect(events.at(-1).date).toBe('2027-06-30');
  });

  it('is sorted ascending with unique dates', () => {
    const dates = events.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('classifies cancelled weeks via .msg.skipped', () => {
    expect(events.filter((e) => e.isCancelled)).toHaveLength(17);
  });

  it('treats Saturday day-notes as notes, NOT cancelled club nights', () => {
    // Their day-number cell also carries the `skipped` class — the trap.
    const buildDay = events.find((e) => e.date === '2027-03-06');
    const grandPrix = events.find((e) => e.date === '2027-03-20');
    expect(buildDay).toEqual({ date: '2027-03-06', kind: 'note', title: 'Build Day', isCancelled: false, isSpecial: false });
    expect(grandPrix.title).toBe('Grand Prix');
    expect(grandPrix.kind).toBe('note');
  });

  it('reads the VISIBLE description as the title (hidden copy always says "Awana meeting")', () => {
    const waterNight = events.find((e) => e.date === '2026-09-09');
    expect(waterNight.title).toBe('Water Night - Poster Contest kicks off');
    expect(waterNight.isSpecial).toBe(true);

    const regular = events.find((e) => e.date === '2026-09-16');
    expect(regular.title).toBe('Awana meeting');
    expect(regular.isSpecial).toBe(false);
  });

  it('flags every non-"Awana meeting" live night as special (including Prayer Meeting)', () => {
    const specials = events.filter((e) => e.isSpecial).map((e) => e.date);
    expect(specials).toContain('2026-11-18'); // Prayer Meeting
    expect(specials).toContain('2027-05-26'); // Awards Night
    expect(specials).toHaveLength(11);
  });
});

describe('parseCalendarHtml on synthetic snippets', () => {
  it('parses each dayline shape', () => {
    const events = parseCalendarHtml(`<html><body>${CLUB_NIGHT}${SPECIAL_NIGHT}${CANCELLED_WEEK}${DAY_NOTE}</body></html>`);
    expect(events.map((e) => [e.date, e.kind, e.isCancelled, e.isSpecial])).toEqual([
      ['2026-07-15', 'club', true, false],
      ['2026-09-09', 'club', false, true],
      ['2026-09-16', 'club', false, false],
      ['2027-03-06', 'note', false, false],
    ]);
  });

  it('falls back to the dayline id when the calendar_date attribute is missing', () => {
    const html = CLUB_NIGHT.replace(' calendar_date="2026-09-16"', '');
    expect(parseCalendarHtml(html)[0].date).toBe('2026-09-16');
  });

  it('drops daylines with no usable date instead of throwing', () => {
    const html = CLUB_NIGHT.replace(' calendar_date="2026-09-16"', '').replace("id='D2026-09-16'", "id='nope'");
    expect(parseCalendarHtml(html)).toEqual([]);
  });

  it('never throws on garbage input', () => {
    expect(parseCalendarHtml('')).toEqual([]);
    expect(parseCalendarHtml('<html></html>')).toEqual([]);
    expect(parseCalendarHtml('not html at all }{')).toEqual([]);
    expect(parseCalendarHtml(null)).toEqual([]);
    expect(parseCalendarHtml(12)).toEqual([]);
  });
});

describe('isRegularTitle', () => {
  it('matches only the plain meeting title, case-insensitively', () => {
    expect(isRegularTitle('Awana meeting')).toBe(true);
    expect(isRegularTitle('  AWANA MEETING ')).toBe(true);
    expect(isRegularTitle('Water Night')).toBe(false);
    expect(isRegularTitle('')).toBe(false);
    expect(isRegularTitle(undefined)).toBe(false);
  });
});

describe('sanitizeEvents / sanitizeFeed', () => {
  const good = { date: '2026-09-09', kind: 'club', title: 'Water Night', isCancelled: false, isSpecial: true };

  it('keeps valid entries and recomputes isSpecial from the title', () => {
    const [event] = sanitizeEvents([{ ...good, isSpecial: false }]);
    expect(event.isSpecial).toBe(true); // derived, not trusted
  });

  it('drops malformed entries without touching good ones', () => {
    const events = sanitizeEvents([
      good,
      { date: '2026-13-99', kind: 'club', title: 'Bad date' },
      { date: '2026-10-01', kind: 'party', title: 'Bad kind' },
      { date: '2026-10-08', kind: 'club', title: '' },
      'nonsense',
      null,
      { date: '2026-09-09', kind: 'club', title: 'Duplicate date' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Water Night');
  });

  it('tolerates non-array input', () => {
    expect(sanitizeEvents(null)).toEqual([]);
    expect(sanitizeEvents('x')).toEqual([]);
  });

  it('sanitizeFeed validates the envelope too', () => {
    expect(sanitizeFeed(null)).toEqual({ generatedAt: null, events: [] });
    expect(sanitizeFeed({ generatedAt: 'not a date', events: [good] }).generatedAt).toBeNull();
    const feed = sanitizeFeed({ generatedAt: '2026-07-13T04:00:00.000Z', events: [good] });
    expect(feed.generatedAt).toBe('2026-07-13T04:00:00.000Z');
    expect(feed.events).toHaveLength(1);
  });

  it('cancelled entries are never special', () => {
    const [event] = sanitizeEvents([{ date: '2026-12-23', kind: 'club', title: 'No Awana this week', isCancelled: true }]);
    expect(event.isCancelled).toBe(true);
    expect(event.isSpecial).toBe(false);
  });
});
