// The downstairs classroom's /settings preview (owner 2026-10-18: "Settings
// should be able to kick it off"; worker/src/routes.md 10.13): a look on the
// classroom TV for one minute. The page shows it itself while its screen is
// open; when the screen is closed (any time outside club hours) this computer
// opens it for the preview's minute, if it is switched on. Pure: display.js
// asks the sync service (GET /v1/classroom/stage?from=app) and hands the
// answer here.
'use strict';

/** How often a closed classroom screen asks whether a preview waits. */
const PREVIEW_POLL_MS = 15 * 1000;
/** The screen stays open this long past the preview's end (the page fades back). */
const PREVIEW_GRACE_MS = 3 * 1000;
/** No preview opens the screen for longer than this, whatever the answer says. */
const PREVIEW_MAX_MS = 2 * 60 * 1000;
const LOOKS = ['cubbies', 'sparks', 'lobby'];

/**
 * Until when (this computer's clock, ms) the screen should be open for a
 * preview, or 0. The service's clock is used through its serverNow.
 * @param {any} answer the stage answer ({stage: {preview: {look, until}}, serverNow})
 * @param {number} localNow
 */
function previewOpenUntil(answer, localNow) {
  const p = answer && answer.stage && answer.stage.preview;
  const serverNow = answer && Number(answer.serverNow);
  if (!p || !LOOKS.includes(p.look) || !Number.isFinite(p.until) || !Number.isFinite(serverNow)) return 0;
  const left = p.until - serverNow;
  if (left <= 0) return 0;
  return localNow + Math.min(left, PREVIEW_MAX_MS) + PREVIEW_GRACE_MS;
}

module.exports = { previewOpenUntil, PREVIEW_POLL_MS, PREVIEW_GRACE_MS, PREVIEW_MAX_MS };
