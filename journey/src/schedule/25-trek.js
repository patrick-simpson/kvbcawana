/* ── Trek: small group time (owner 2026-10-12) ─────────────────────────
   On a CLUB NIGHT, 7:00-7:30 PM, the screen is Trek's title card ("TREK ·
   SMALL GROUP TIME", #trek-view) instead of the Check-in Display. Three
   things feed it, none of them a new connection of its own:

   - Is tonight a club night? Exactly the lobby's answer: the shared rule
     lobby/shared/clubNight.js (copied byte for byte beside this script by
     scripts/family-assets.mjs, loaded once as an ES module) asked with the
     lobby's own two files, its shared/schedule.json (noClub and special
     dates) and its calendar-feed.json (the season, cancelled nights). Both
     are same-origin under ../lobby/, read at startup and every six hours,
     the last good copy kept in the asset cache for a dead connection. Until
     the rule has loaded, no night is a club night (the card never guesses).
   - How many Trek kids are here: the embedded lobby (the frame under this
     page, which already holds the one live socket) leaves the latest tally's
     per-club counts in this origin's localStorage (`awanaClubCounts.v1`,
     numbers only: lobby/src/lib/clubCountsStore.js); its `storage` event
     redraws the chip. A count from another day, or none, hides the chip.
   - Tonight's Trek lesson: only a calendar entry on tonight's date that
     names Trek in so many words ("Trek: <title>", "Trek - <title>", "Trek
     Lesson 4: <title>"), uncancelled, and only when exactly one title
     matches. Anything else shows no title: never a guess.

   Journey's own count chip (owner 2026-10-12) reads the same entry
   (byClub.journey): over the Journey view (splash, slides, the menus) but
   never while a lesson video is up (playing, paused or loading), a reading
   overlay is open, or the Trek card shows (renderJourneyChip()).

   The schedule side (scheduledPhase() 'trek', the poll waiting for a running
   lesson, lessonDoneView()) lives with the other views; this file only knows
   the night and draws the card. */
const CLUB_COUNTS_KEY = 'awanaClubCounts.v1';
// A tally older than this (or from another day) is not tonight's count.
const TREK_COUNT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// The printer's clock may run a little ahead of the kiosk's.
const TREK_COUNT_SKEW_MS = 60 * 60 * 1000;
const TREK_NIGHT_REFRESH_MS = 6 * 60 * 60 * 1000;
const TREK_SCHEDULE_URL = new URL('shared/schedule.json', CHECKIN_DISPLAY_URL).href;
const TREK_FEED_URL = new URL('calendar-feed.json', CHECKIN_DISPLAY_URL).href;
// The rule sits beside this script (src/shared/clubNight.js) and is asked for
// with this script's own ?v=, so a deploy never pairs new code with a stale
// rule from the disk cache. (A test hands it over: window.journeyClubNightModule.)
const CLUB_NIGHT_MODULE_URL = (() => {
  const own = document.currentScript && document.currentScript.src;
  const url = new URL('shared/clubNight.js', own || new URL('src/schedule.js', window.location.href).href);
  if (own) url.search = new URL(own).search;
  return url.href;
})();
// "Trek: <title>" / "Trek - <title>" / "Trek · <title>" / "Trek Lesson 4: <title>".
const TREK_TITLE_PATTERN = /^\s*trek\b(?:\s*[:|·•–—-]\s*(.+?)|\s+(lesson\b.+?))\s*$/i;
const TREK_TITLE_MAX = 80;

/** True when `now` falls on a club night by the lobby's rule (time of day aside). */
function trekSmallGroupTime(now) {
  if (!trekNight.ready || !trekNight.rule) return false;
  try {
    return trekNight.rule.clubNightToday(now, { schedule: trekNight.schedule, feed: trekNight.feed }) === true;
  } catch {
    return false;
  }
}

/** Tonight's date key in the church's zone (the calendar's dates), else the kiosk's own. */
function trekDateKey(now) {
  if (trekNight.rule && typeof trekNight.rule.zonedParts === 'function') {
    const zone = trekNight.schedule && typeof trekNight.schedule.timezone === 'string' ? trekNight.schedule.timezone : undefined;
    try {
      return trekNight.rule.zonedParts(now, zone).dateKey;
    } catch {
      /* the kiosk's own date below */
    }
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A lesson the Trek card must not cut: its video, its slides, or the steps just before. */
function journeyLessonRunning() {
  return (
    slideshowActive() ||
    lessonIntroActive() ||
    journeyVideo.hasAttribute('src') ||
    isCaptionPromptOpen() ||
    !journeyLoading.classList.contains('hidden')
  );
}

/**
 * Tonight's Trek count from the lobby's stored entry, or null when there is
 * none worth showing (missing, malformed, another day's, no Trek entry).
 * Pure: the raw localStorage string and the time.
 */
function trekCountFrom(raw, nowMs) {
  return clubCountFrom(raw, nowMs, 'trek');
}

/** Tonight's count for one club id ('trek', 'journey') from the stored entry, or null. */
function clubCountFrom(raw, nowMs, club) {
  if (typeof raw !== 'string') return null;
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!entry || entry.v !== 1 || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return null;
  const age = nowMs - entry.at;
  if (age > TREK_COUNT_MAX_AGE_MS || age < -TREK_COUNT_SKEW_MS) return null;
  if (new Date(entry.at).toDateString() !== new Date(nowMs).toDateString()) return null;
  const n = entry.byClub && entry.byClub[club];
  return Number.isInteger(n) && n >= 0 && n <= 999 ? n : null;
}

/**
 * Tonight's Trek lesson title from the calendar's events, or null. Only a
 * title that says it is Trek's, on `dateKey`, not cancelled, and only one
 * distinct such title (two different ones = no title).
 */
function trekLessonTitleFor(events, dateKey) {
  if (!Array.isArray(events)) return null;
  const titles = new Set();
  for (const event of events) {
    if (!event || event.date !== dateKey || event.isCancelled === true || typeof event.title !== 'string') continue;
    const match = event.title.match(TREK_TITLE_PATTERN);
    if (!match) continue;
    const title = (match[1] || match[2] || '').replace(/\s+/g, ' ').trim();
    if (title) titles.add(title);
  }
  if (titles.size !== 1) return null;
  const [title] = titles;
  return title.length <= TREK_TITLE_MAX ? title : null;
}

function readClubCounts() {
  try {
    return localStorage.getItem(CLUB_COUNTS_KEY);
  } catch {
    return null;
  }
}

/* Draws what the card knows right now. Cheap (one storage read, no network)
   and touches only what changed, so the chip's entrance never replays for
   the same number. */
function renderTrekCard() {
  const now = new Date();
  const count = trekCountFrom(readClubCounts(), now.getTime());
  const countText = count == null ? '' : String(count);
  if (trekChipCount.textContent !== countText) trekChipCount.textContent = countText;
  trekChip.classList.toggle('hidden', count == null);
  const title = trekNight.feed ? trekLessonTitleFor(trekNight.feed.events, trekDateKey(now)) : null;
  if (trekLessonTitle.textContent !== (title || '')) trekLessonTitle.textContent = title || '';
  trekLesson.classList.toggle('hidden', !title);
}

/* Journey's count chip: up only while the Journey view shows something that
   is not a lesson video (the splash, the placeholder, the teaching slides,
   the caption question, the Settings menus over them), and a count is
   known. Cheap; re-asked whenever one of the layers it depends on changes. */
function journeyChipWanted() {
  return (
    !journeyView.classList.contains('hidden') &&
    trekView.classList.contains('hidden') &&
    journeyVideo.classList.contains('hidden') &&
    journeyLoading.classList.contains('hidden') &&
    !readerOverlayOpen()
  );
}

function renderJourneyChip() {
  const count = journeyChipWanted() ? clubCountFrom(readClubCounts(), Date.now(), 'journey') : null;
  const text = count == null ? '' : String(count);
  if (journeyChipCount.textContent !== text) journeyChipCount.textContent = text;
  journeyChip.classList.toggle('hidden', count == null);
  // Over the teaching slides it moves into the pillarbox bar, off Awana's
  // slide (style.css, #journey-chip.beside-slides).
  journeyChip.classList.toggle('beside-slides', count != null && !slidesView.classList.contains('hidden'));
}

const isPlainObject = (data) => !!data && typeof data === 'object' && !Array.isArray(data);
const isTrekFeed = (data) => isPlainObject(data) && Array.isArray(data.events);

/* One same-origin JSON file: the network first (the calendar changes), the
   last good copy (asset cache) when it cannot answer. A copy is stored only
   after it parsed and passed `valid`. */
async function trekJson(url, valid) {
  try {
    const res = await fetchWithTimeout(url, { cache: 'no-cache' }, 5000);
    if (res.ok) {
      const text = await res.text();
      const data = JSON.parse(text);
      if (valid(data)) {
        if ('caches' in window) {
          try {
            const cache = await caches.open(ASSET_CACHE_NAME);
            await cache.put(url, new Response(text, { headers: { 'content-type': 'application/json' } }));
          } catch {
            /* not storable now: still usable live */
          }
        }
        return data;
      }
    }
  } catch {
    /* offline, timed out, or not JSON: the stored copy below */
  }
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(ASSET_CACHE_NAME);
    const hit = await cache.match(url);
    const data = hit ? await hit.json() : null;
    return valid(data) ? data : null;
  } catch {
    return null;
  }
}

async function loadClubNightRule() {
  if (window.journeyClubNightModule) return window.journeyClubNightModule;
  try {
    return await import(CLUB_NIGHT_MODULE_URL);
  } catch {
    return null;
  }
}

/* Learns tonight (startup, then every six hours). A failed read keeps what
   was known; a rule that never loads keeps every night an ordinary one. */
async function loadTrekNight() {
  const [rule, schedule, feed] = await Promise.all([
    trekNight.rule || loadClubNightRule(),
    trekJson(TREK_SCHEDULE_URL, isPlainObject),
    trekJson(TREK_FEED_URL, isTrekFeed),
  ]);
  if (schedule) trekNight.schedule = schedule;
  if (feed) trekNight.feed = feed;
  if (rule && typeof rule.clubNightToday === 'function') {
    trekNight.rule = rule;
    trekNight.ready = true;
  }
  // A club night learned inside 7:00-7:30 flips now, not at the next poll.
  pollSchedule();
  if (!trekView.classList.contains('hidden')) renderTrekCard();
}

if (!CONFIGURE_MODE) {
  loadTrekNight();
  setInterval(loadTrekNight, TREK_NIGHT_REFRESH_MS);
  // The lobby frame writing a new tally (another document, same origin).
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== CLUB_COUNTS_KEY) return;
    if (!trekView.classList.contains('hidden')) renderTrekCard();
    renderJourneyChip();
  });
  // And a slow redraw, for a write the event missed and a count going stale.
  setInterval(() => {
    if (!trekView.classList.contains('hidden')) renderTrekCard();
    renderJourneyChip();
  }, POLL_INTERVAL_MS);
  // Journey's chip follows the layers it depends on: one observer on their
  // `hidden` classes (no per-frame work), so no code that changes a view has
  // to remember it, and the chip is gone in the same task the video shows.
  const chipLayers = new MutationObserver(renderJourneyChip);
  for (const el of [journeyView, trekView, journeyVideo, journeyLoading, prepView, handoutView, slidesView]) {
    chipLayers.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  renderJourneyChip();
}
