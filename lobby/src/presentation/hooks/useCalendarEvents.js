import { useEffect, useState } from 'react';
import { CHURCH } from '../church.config.js';

const REFRESH_MS = 30 * 60 * 1000;
const MAX_EVENTS = 6;

/* ── Primary source: the JSON feed the sibling display repo's nightly
      GitHub Action publishes (validated defensively — any surprise in
      shape falls through to the direct scrape). ─────────────────────── */

function parseFeed(data) {
  if (typeof data !== 'object' || data === null) return null;
  const feed = data;
  if (feed.version !== 1 || !Array.isArray(feed.events)) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const events = [];

  for (const item of feed.events) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item;
    if (typeof e.date !== 'string' || typeof e.title !== 'string') continue;
    if (e.isCancelled === true) continue; // parity with the scraper's "skipped" rule
    const date = new Date(`${e.date}T12:00:00`);
    if (Number.isNaN(date.getTime()) || date < today) continue;
    const daysUntil = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isSpecial =
      typeof e.isSpecial === 'boolean'
        ? e.isSpecial
        : !e.title.toLowerCase().includes('awana meeting');
    events.push({ date, title: e.title, isSpecial, daysUntil });
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, MAX_EVENTS);
}

/* ── Secondary source: scrape the church calendar HTML directly
      (CORS-permitting). ─────────────────────────────────────────────── */

/**
 * A span parsed via DOMParser is never attached to the live document,
 * so getComputedStyle (which the old code used) returns empty values.
 * Visibility must be judged from the markup itself.
 */
function isHiddenInMarkup(el) {
  const style = el.getAttribute('style') ?? '';
  return /display\s*:\s*none/i.test(style) || el.classList.contains('hidden');
}

function parseCalendarHTML(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const events = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    doc.querySelectorAll('.dayline').forEach((dayDiv) => {
      // Date lives in the id (format: D2026-03-25)
      const id = dayDiv.id;
      if (!id || !id.startsWith('D')) return;

      const date = new Date(id.slice(1) + 'T12:00:00');
      if (Number.isNaN(date.getTime()) || date < today) return;

      // Weeks marked "skipped" have no Awana meeting
      if (dayDiv.querySelector('.msg.skipped')) return;

      let title = 'Awana Meeting';
      const msgDiv = dayDiv.querySelector('.msg');
      if (msgDiv) {
        for (const span of msgDiv.querySelectorAll('span.desc')) {
          if (isHiddenInMarkup(span)) continue;
          const text = span.textContent?.trim();
          if (text) {
            title = text;
            break;
          }
        }
      }

      const daysUntil = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const isSpecial = !title.toLowerCase().includes('awana meeting');
      events.push({ date, title, isSpecial, daysUntil });
    });

    return events.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

async function fetchCalendarEvents(signal) {
  // Primary: the published JSON feed…
  try {
    const res = await fetch(CHURCH.calendar.feedUrl, { signal });
    if (res.ok) {
      const parsed = parseFeed(await res.json());
      if (parsed && parsed.length > 0) return parsed;
    }
  } catch (err) {
    if (signal.aborted) throw err;
  }
  // …secondary: scrape the calendar HTML directly.
  try {
    const res = await fetch(CHURCH.calendar.scrapeUrl, { signal });
    return parseCalendarHTML(await res.text());
  } catch {
    return [];
  }
}

/**
 * Upcoming church-calendar events. Silent failure → empty list; the
 * app renders fine without them. Refetches every 30 minutes and when
 * the page becomes visible again.
 */
export function useCalendarEvents() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const controller = new AbortController();

    const refresh = () => {
      fetchCalendarEvents(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setEvents(result);
        })
        .catch(() => {});
    };

    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return events;
}
