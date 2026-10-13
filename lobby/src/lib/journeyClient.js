// @ts-check
// The Journey room settings (captions, teaching slides) and the Journey
// kiosks' lesson downloads, edited from awana.kvbchurch.org/settings → Journey
// (owner 2026-10-12: the kiosk's own Settings "really live in the master
// settings page"; the kiosk keeps them too, as the fallback at the PC).
//
// - The room settings are the sync Worker's ONE `journey` document
//   (`GET`/`PUT /v1/journey`), the same one every Journey kiosk follows
//   (journey/public/src/sync.js). A PUT replaces the WHOLE document, so an edit
//   here reads the newest copy first and changes only its own keys: tonight's
//   edited bullets (`slideNotes`, edited on a kiosk) ride along untouched. No
//   local rules: `sanitizeJourney` (src/lib/syncSpecs.js, the file the Worker
//   bundles) cleans every edit before it is sent.
// - A kiosk's download buttons are actions (`POST /v1/screens/<id>/action`,
//   SCREEN_ACTIONS.journey), queued by the Worker for the kiosk's next hello;
//   its two switches are its own screen settings (SCREEN_SPECS.journey).
// Church-authored settings only: nothing here is a child.

import { call } from './workerClient.js';
import { JOURNEY_CAPTION_SIZES, JOURNEY_SLIDE_KINDS, SCREEN_ACTIONS, sanitizeJourney } from './syncSpecs.js';

export { JOURNEY_CAPTION_SIZES, JOURNEY_SLIDE_KINDS };

/** What a kiosk does when the document does not say (journey/src/schedule/08, 20). */
export const JOURNEY_DEFAULTS = Object.freeze({
  captionSize: '1',
  captionBackdrop: false,
  slidesAutoAdvanceSec: 0,
  slideExtras: Object.freeze({ questions: true, takeaways: true, challenges: true }),
});

/** The kiosk's own choices, in its own words (journey/public/index.html). */
export const CAPTION_SIZE_WORDS = Object.freeze({ 0.8: 'Small', 1: 'Normal', 1.3: 'Large', 1.6: 'Extra large' });
export const AUTO_ADVANCE_CHOICES = Object.freeze([
  { value: 0, label: 'Off: advance by hand' },
  { value: 15, label: 'Every 15 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 45, label: 'Every 45 seconds' },
  { value: 60, label: 'Every minute' },
  { value: 120, label: 'Every 2 minutes' },
]);
export const SLIDE_EXTRA_WORDS = Object.freeze({
  questions: { title: 'Talk About It', hint: 'discussion questions' },
  takeaways: { title: 'Remember This', hint: 'key takeaways' },
  challenges: { title: 'This Week', hint: 'challenges to try' },
});

/** @typedef {{ savedAt: string, settings: Record<string, any> }} JourneyDoc */

/** @param {any} raw @returns {JourneyDoc | null} */
export function journeyDocFrom(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.savedAt !== 'string') return null;
  return { savedAt: raw.savedAt, settings: sanitizeJourney(raw.settings) };
}

/**
 * What the cards show: the document's value, else the kiosk's default.
 * `captions` is null while no one has set it (each kiosk then asks once).
 * @param {JourneyDoc | null} doc
 */
export function journeyView(doc) {
  const s = doc?.settings || {};
  return {
    captions: typeof s.captions === 'boolean' ? s.captions : null,
    captionSize: typeof s.captionSize === 'string' ? s.captionSize : JOURNEY_DEFAULTS.captionSize,
    captionBackdrop: typeof s.captionBackdrop === 'boolean' ? s.captionBackdrop : JOURNEY_DEFAULTS.captionBackdrop,
    slidesAutoAdvanceSec: typeof s.slidesAutoAdvanceSec === 'number' ? s.slidesAutoAdvanceSec : JOURNEY_DEFAULTS.slidesAutoAdvanceSec,
    slideExtras: { ...JOURNEY_DEFAULTS.slideExtras, ...(s.slideExtras || {}) },
  };
}

/**
 * The whole document to send: the newest copy with only `changes` laid over
 * it, through the shared sanitizer (a value the Worker would drop is never
 * sent). `slideExtras` is merged key by key, so ticking one keeps the others.
 * @param {Record<string, any> | null | undefined} current @param {Record<string, any>} changes
 */
export function mergeJourney(current, changes) {
  const base = sanitizeJourney(current || {});
  const next = { ...base, ...changes };
  if (changes.slideExtras) next.slideExtras = { ...JOURNEY_DEFAULTS.slideExtras, ...(base.slideExtras || {}), ...changes.slideExtras };
  return sanitizeJourney(next);
}

/** @returns {Promise<{ ok: true, doc: JourneyDoc | null } | { ok: false, message: string }>} */
export async function fetchJourney() {
  const a = await call('/v1/journey');
  if (a.ok) return { ok: true, doc: journeyDocFrom(a.body?.journey) };
  // A Worker from before GET /v1/journey: the same document rides /v1/state.
  if (a.status === 404) {
    const st = await call('/v1/state');
    if (st.ok) return { ok: true, doc: journeyDocFrom(st.body?.journey) };
    return { ok: false, message: st.message };
  }
  return { ok: false, message: a.message };
}

/**
 * Change some room settings: read the newest document, lay the changes over
 * it, send the whole of it.
 * @param {Record<string, any>} changes
 * @returns {Promise<{ ok: true, doc: JourneyDoc } | { ok: false, message: string }>}
 */
export async function saveJourney(changes) {
  const fresh = await fetchJourney();
  if (!fresh.ok) return fresh;
  const settings = mergeJourney(fresh.doc?.settings, changes);
  const a = await call('/v1/journey', { method: 'PUT', body: { settings } });
  const doc = a.ok ? journeyDocFrom(a.body) : null;
  return doc ? { ok: true, doc } : { ok: false, message: a.ok ? 'The sync service answered something unexpected.' : a.message };
}

/** A kiosk's download buttons, in the order the card shows them. */
export const DOWNLOAD_ACTIONS = SCREEN_ACTIONS.journey;

/**
 * Which buttons a kiosk's status calls for (its hello's `status.lessons`,
 * already sanitized by the Worker), and whether they can be pressed.
 *   start  nothing running, nothing paused, something left to save
 *   pause  running or waiting
 *   resume paused
 *   stop   running, waiting or paused
 *   delete something saved (or partly saved)
 * Every one is disabled while the kiosk is off, still checking its disk, or
 * cannot save lessons at all (`why` says which).
 * @param {any} l @param {boolean} online
 */
export function downloadButtons(l, online) {
  const known = Boolean(l) && l.known !== false && l.supported !== false;
  const why = !l ? 'It has not reported its lessons yet.'
    : l.supported === false ? 'This device cannot save lessons.'
      : l.known === false ? 'It is still checking what is saved.'
        : !online ? 'It is off: these work when it is on.' : '';
  const running = Boolean(l?.downloading || l?.waiting);
  const paused = Boolean(l?.paused);
  const allSaved = known && l.total > 0 && l.saved >= l.total;
  const shown = {
    'start-downloads': !running && !paused,
    'pause-downloads': running,
    'resume-downloads': paused,
    'stop-downloads': running || paused,
    'delete-downloads': known && (l.saved > 0 || l.bytesSaved > 0),
  };
  const disabled = Boolean(why) || !online;
  return {
    why,
    buttons: DOWNLOAD_ACTIONS.filter((a) => /** @type {any} */ (shown)[a]).map((action) => ({
      action,
      disabled: disabled || (action === 'start-downloads' && (allSaved || !(l?.total > 0))),
    })),
  };
}

/** The words on each button. */
export const DOWNLOAD_BUTTON_WORDS = Object.freeze({
  'start-downloads': 'Start downloading',
  'pause-downloads': 'Pause',
  'resume-downloads': 'Resume',
  'stop-downloads': 'Stop',
  'delete-downloads': 'Delete downloaded lessons',
});
