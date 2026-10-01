// Read the church calendar page with the SAME parser the signage and the
// nightly GitHub Action use (src/lib/calendarParse.js), on linkedom instead of
// a browser DOM. The Worker can fetch the page because a server is not bound
// by the browser's CORS rule, which is what kept "Refresh calendar now" from
// ever reading the real calendar.

import { parseHTML } from 'linkedom';
import { FEED_VERSION, parseCalendarDocument } from '../../src/lib/calendarParse.js';

export const DEFAULT_CALENDAR_URL = 'https://kvbchurch.twotimtwo.com/calendar/index';
/** A redesign that parses to fewer club nights must never wipe a good feed. */
export const MIN_CLUB_EVENTS = 5;

/** @param {string} html */
export function parseCalendar(html) {
  const { document } = parseHTML(String(html || ''));
  return parseCalendarDocument(document);
}

/**
 * @param {string} url
 * @param {{fetchFn?: typeof fetch, now?: () => number}} [opts]
 * @returns {Promise<{ok: true, feed: {version: number, generatedAt: string, sourceUrl: string, events: object[]}, clubCount: number}
 *   | {ok: false, error: string}>} never throws
 */
export async function scrapeCalendar(url, opts = {}) {
  const fetchFn = opts.fetchFn || fetch;
  const now = opts.now || Date.now;
  let html;
  try {
    const res = await fetchFn(url, {
      headers: { 'User-Agent': 'awana-sync (church lobby signage)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, error: `The calendar page answered HTTP ${res.status}.` };
    html = await res.text();
  } catch {
    return { ok: false, error: 'Could not reach the church calendar page.' };
  }
  let events;
  try {
    events = parseCalendar(html);
  } catch {
    return { ok: false, error: 'The calendar page could not be read.' };
  }
  const clubCount = events.filter((e) => e.kind === 'club').length;
  if (clubCount < MIN_CLUB_EVENTS) {
    return { ok: false, error: `Only ${clubCount} club nights were found, so the last good calendar was kept. The calendar page may have changed.` };
  }
  return {
    ok: true,
    clubCount,
    feed: { version: FEED_VERSION, generatedAt: new Date(now()).toISOString(), sourceUrl: url, events },
  };
}
