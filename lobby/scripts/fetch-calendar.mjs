#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Nightly calendar-feed builder (run by .github/workflows/
// update-calendar.yml, or by hand):
//
//   node scripts/fetch-calendar.mjs                    # live fetch
//   node scripts/fetch-calendar.mjs --from-file page.html
//   node scripts/fetch-calendar.mjs --url https://… --out public/calendar-feed.json
//
// Fetches the church calendar page, parses it with the SAME
// src/lib/calendarParse.js the app uses, and writes
// public/calendar-feed.json. Safety rails:
//   • refuses (exit 1) when fewer than MIN_CLUB_EVENTS club rows
//     parse — a site redesign must never wipe a good feed
//   • rewrites the file only when the events actually changed, or
//     the feed is > HEARTBEAT_DAYS old (keeps the runtime staleness
//     check meaningful without daily commit noise)
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { FEED_VERSION, parseCalendarDocument } from '../src/lib/calendarParse.js';

const MIN_CLUB_EVENTS = 5;
const HEARTBEAT_DAYS = 7;
const DEFAULT_URL = 'https://kvbchurch.twotimtwo.com/calendar/index';
const DEFAULT_OUT = 'public/calendar-feed.json';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastError;
}

const url = arg('--url') || DEFAULT_URL;
const out = arg('--out') || DEFAULT_OUT;
const fromFile = arg('--from-file');

const html = fromFile ? readFileSync(fromFile, 'utf8') : await fetchWithRetry(url);
const events = parseCalendarDocument(new JSDOM(html).window.document);
const clubCount = events.filter((e) => e.kind === 'club').length;

if (clubCount < MIN_CLUB_EVENTS) {
  console.error(
    `Parsed only ${clubCount} club events (< ${MIN_CLUB_EVENTS}) — refusing to overwrite the feed. ` +
    'The calendar page layout may have changed.'
  );
  process.exit(1);
}

let existing = null;
if (existsSync(out)) {
  try {
    existing = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    existing = null; // corrupt feed → always rewrite
  }
}

const sameEvents = existing && JSON.stringify(existing.events) === JSON.stringify(events);
const ageMs = existing?.generatedAt ? Date.now() - Date.parse(existing.generatedAt) : Infinity;
const heartbeatDue = !(ageMs < HEARTBEAT_DAYS * 24 * 60 * 60 * 1000);

if (sameEvents && !heartbeatDue) {
  console.log(`No change (${events.length} events, feed ${Math.round(ageMs / 86400000)}d old) — ${out} untouched.`);
  process.exit(0);
}

const feed = {
  version: FEED_VERSION,
  generatedAt: new Date().toISOString(),
  sourceUrl: fromFile ? existing?.sourceUrl || url : url,
  events,
};
writeFileSync(out, `${JSON.stringify(feed, null, 2)}\n`);
console.log(
  `Wrote ${out}: ${events.length} events (${clubCount} club, ` +
  `${events.filter((e) => e.isCancelled).length} cancelled, ` +
  `${events.filter((e) => e.isSpecial).length} special)` +
  (sameEvents ? ' — heartbeat refresh.' : '.')
);
