/**
 * Everything KVBC-specific in one place. Fork this app for another
 * church by editing this file plus `shared/schedule.json` /
 * `shared/theme.json` (and swapping the art in `shared/art/`).
 *
 * Schedule windows, club names/colors, and slide text intentionally do
 * NOT live here — they come from `shared/` (see
 * src/presentation/lib/shared-config.js) so the sibling display/printer
 * apps read the same source of truth.
 *
 * Realtime credentials do NOT live here either (unlike the original
 * KVBC-Awana-Countdown repo): the screen signs in to the sync service's live
 * channel with the church passphrase, kept in its own storage slot.
 */

export const CHURCH = {
  name: 'KVBC',

  /** Open-Meteo coordinates for the ambient weather scene. */
  coords: { lat: 44.5522, lon: -69.6317 },

  calendar: {
    /**
     * Primary: the JSON feed published nightly by this repo's own
     * GitHub Action into public/calendar-feed.json — same-origin now
     * that the presentation page lives in this repo
     * ({version, generatedAt, events: [{date, kind, title, isCancelled, isSpecial}]}).
     */
    feedUrl: `${import.meta.env.BASE_URL}calendar-feed.json`,
    /** Secondary: scrape the church calendar HTML directly (CORS-permitting). */
    scrapeUrl: 'https://kvbchurch.twotimtwo.com/site/index',
  },

  watchdog: {
    /** Minutes a QuickNav override may hold the screen before auto-resume. */
    overrideTimeoutMin: 15,
    /** Seconds of on-screen warning (the "resuming in Ns" pill) before resume. */
    warningSec: 60,
  },
};
