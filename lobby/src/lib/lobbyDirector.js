// @ts-check
// The lobby director's rules (rebrand stage 4) as pure functions: who holds
// the room, which corner slot is taken, what the stage's flags and class are,
// when the sticker must show, when a reload must wait. App.jsx owns the state
// and the effects and asks these for every answer, so each rule can be pinned
// by a unit test instead of inferred from a render.
import { countForClub } from './clubs.js';
import { stillHereCount } from './checkoutBoard.js';
import { lobbyRoom } from './overlayFit.js';

/**
 * Whether arrivals are held behind a poster, a marked slide or a promo
 * preview: never on an OBS overlay feed.
 * @param {{ overlay: boolean, slideSpecial: boolean, previewUp: boolean }} q
 */
export function checkInsHeldNow({ overlay, slideSpecial, previewUp }) {
  return !overlay && (slideSpecial || previewUp);
}

/**
 * Who holds which part of the room (overlayFit.js lobbyRoom): the pickup
 * board in the foot, and a critical notice in the middle or, on an OBS feed,
 * the top band.
 * @param {{
 *   overlay: boolean, notice: { level?: string } | null, noticeUp: boolean,
 *   boardState: string, checkInUp: boolean, leaveUp: boolean,
 * }} q
 */
export function roomFor({ overlay, notice, noticeUp, boardState, checkInUp, leaveUp }) {
  return lobbyRoom({
    overlay,
    criticalLive: noticeUp && notice?.level === 'critical',
    boardState,
    checkInUp,
    leaveUp,
  });
}

/**
 * Whether the tonight strip is up: it steps away for a name, a held slide, the
 * pickup board and a "has checked out" banner.
 * @param {{ checkInUp: boolean, held: boolean, room: { board: any, banner: any } }} q
 */
export function tickerIsActive({ checkInUp, held, room }) {
  return !checkInUp && !held && room.board == null && room.banner == null;
}

/**
 * The per-screen club count and the top slot it takes (owner, 2026-10-08).
 * It takes the slot the weather and the WAITING chip share, as a tall problem
 * sticker does, and a tall sticker outranks it.
 * @param {{
 *   overlay: boolean, cornerClub: string, tallyCounts: Record<string, number> | null,
 *   stickerTall: boolean,
 * }} q
 * @returns {{ count: number | null, chipUp: boolean, topTaken: boolean }}
 */
export function cornerSlots({ overlay, cornerClub, tallyCounts, stickerTall }) {
  const count = cornerClub ? countForClub(tallyCounts, cornerClub) : null;
  const chipUp = !overlay && count != null && !stickerTall;
  return { count, chipUp, topTaken: stickerTall || chipUp };
}

/**
 * What the corner rotation may show (src/lib/cornerInfo.js): the time, the
 * tally, how many are not yet checked out, the weather, a tally correction.
 * @param {{
 *   config: any, count: number, weather: any, showWeatherChip: boolean,
 *   topTaken: boolean, tallySync: any, boardDecision: any, boardData: any, pickup: boolean,
 * }} q
 */
export function cornerSources({
  config, count, weather, showWeatherChip, topTaken, tallySync, boardDecision, boardData, pickup,
}) {
  return {
    clock: config.showClock === true,
    tally: config.showTally ? count : 0,
    // During pickup, while the board names children, the tally's slot counts
    // down how many are not checked out yet.
    stillHere: config.showTally && config.cornerStillHere !== false
      ? stillHereCount(boardDecision, boardData, pickup)
      : null,
    weather: showWeatherChip && !topTaken ? weather : null,
    correction: config.showTally ? tallySync : null,
  };
}

/**
 * The timer that stands in for slide loads when the slideshow does not drive
 * the corner, or null when it does.
 * @param {boolean} slideDriven
 * @param {unknown} slideshowDelaySec
 */
export function cornerFallbackMs(slideDriven, slideshowDelaySec) {
  return slideDriven ? null : Math.max(5000, (Number(slideshowDelaySec) || 8) * 1000);
}

/**
 * The corner item as drawn: while the top slot is taken, one that belongs to
 * it leaves now rather than at the next load.
 * @param {{ corner?: string } | null | undefined} item
 * @param {boolean} topTaken
 */
export function visibleCornerItem(item, topTaken) {
  return topTaken && item?.corner === 'top' ? null : item;
}

/**
 * The demo, rehearsal and simplified-mode tabs hanging from the top edge.
 * @param {{ overlay: boolean, panicMode?: boolean, demoActive: boolean, rehearsalActive: boolean }} q
 */
export function flagTabs({ overlay, panicMode, demoActive, rehearsalActive }) {
  const panicUp = !overlay && panicMode === true;
  const flagCount = [panicUp, demoActive, rehearsalActive].filter(Boolean).length;
  return { panicUp, flagCount, flagsUp: flagCount > 0 };
}

/**
 * A promo poster is up (full-bleed art with its own header where the band
 * sits): a band notice steps aside for it.
 * @param {{ checkInsHeld: boolean, slidePoster: boolean, previewUp: boolean }} q
 */
export function posterIsHeld({ checkInsHeld, slidePoster, previewUp }) {
  return checkInsHeld && (slidePoster === true || previewUp);
}

/**
 * The stage's class list.
 * @param {{
 *   overlay: boolean, aprilFools: boolean, checkInUp: boolean,
 *   critical: string | null | undefined, flagsUp: boolean,
 * }} q
 */
export function stageClassName({ overlay, aprilFools, checkInUp, critical, flagsUp }) {
  return [
    'stage',
    overlay && 'overlay',
    aprilFools && 'april-fools',
    checkInUp && !overlay && 'checkin-active',
    critical === 'centre' && 'notice-takeover',
    flagsUp && 'has-flags',
  ].filter(Boolean).join(' ');
}

/**
 * April Fools (#21): only does anything on April 1st (noon avoids TZ edges).
 * @param {boolean} enabled
 * @param {string} todayStr local date key, YYYY-MM-DD
 */
export function isAprilFools(enabled, todayStr) {
  const noon = new Date(`${todayStr}T12:00:00`);
  return enabled && noon.getMonth() === 3 && noon.getDate() === 1;
}

/** The words for a name fault, by the socket's name status. */
const NAME_FAULT_WORDS = /** @type {Record<string, string>} */ ({
  'no-key': 'DISPLAY KEY NOT SET',
  'bad-key': 'NAMES UNREADABLE — CHECK DISPLAY KEY',
  downgraded: 'NAMES REFUSED — SENT UNENCRYPTED',
});

/**
 * Says which half is broken, because the fixes differ. Null for no fault.
 * @param {string | null | undefined} nameStatus
 * @returns {string | null}
 */
export function nameFaultWords(nameStatus) {
  return (nameStatus && NAME_FAULT_WORDS[nameStatus]) || null;
}

/**
 * Layer faults still "active": a fault stays up for `showMs` after its LAST
 * crash, so a persistent one never ages out and a one-off disappears.
 * @param {Record<string, { lastAt: number }>} layerFaults
 * @param {number} now
 * @param {number} showMs
 */
export function activeFaults(layerFaults, now, showMs) {
  return Object.keys(layerFaults).filter((l) => now - layerFaults[l].lastAt < showMs);
}

/**
 * Whether the Signal sticker must show: a dead connection or a printer
 * problem must never be silent, whatever the setting says.
 * @param {{
 *   configured: boolean, status: string, layerFaults: number, droppedLong: boolean,
 *   opsFailures: number, nameFault: boolean, countsWithoutNames: boolean,
 * }} q
 */
export function shouldShowStatus({
  configured, status, layerFaults, droppedLong, opsFailures, nameFault, countsWithoutNames,
}) {
  return configured
    || status === 'off'
    || layerFaults > 0
    || (droppedLong && status === 'disconnected')
    || opsFailures > 0
    || nameFault
    || countsWithoutNames;
}

/**
 * The sticker's screen-reader label.
 * @param {string} status
 * @param {number} opsFailures
 */
export function statusAriaLabel(status, opsFailures) {
  return `Connection status: ${status}${opsFailures ? `, ${opsFailures} printer problem(s)` : ''}`;
}

/**
 * Whether the page is busy, so a self-update must wait (CLAUDE.md,
 * "Self-updating pages"): a banner (and any ribbon on it), someone waiting, a
 * celebration, an open panel, the checkout board in any visible state, or an
 * event from the last `quietMs`. There is no deadline.
 * @param {{
 *   checkInUp: boolean, pending: number, celebrationUp: boolean, celebrationsQueued: number,
 *   settingsOpen: boolean, previewUp: boolean, slideEditorOpen: boolean, debugOpen: boolean,
 *   boardVisible: boolean, leaveUp: boolean, lastEventAt: number | null | undefined,
 *   now: number, quietMs: number,
 * }} q
 */
export function reloadIsBusy({
  checkInUp, pending, celebrationUp, celebrationsQueued, settingsOpen, previewUp, slideEditorOpen,
  debugOpen, boardVisible, leaveUp, lastEventAt, now, quietMs,
}) {
  return checkInUp
    || pending > 0
    || celebrationUp
    || celebrationsQueued > 0
    || settingsOpen
    || previewUp
    || slideEditorOpen
    || debugOpen
    || boardVisible
    || leaveUp
    || (lastEventAt != null && now - lastEventAt < quietMs);
}

/**
 * The hidden panels' chords (Ctrl+Shift+D / S / E / X), or null. Nothing fires
 * while the operator is typing in a field (Ctrl+Shift+X inside a slide
 * textarea used to flip panic mode).
 * @param {{ ctrlKey: boolean, shiftKey: boolean, key: string, target: EventTarget | null }} e
 * @returns {'debug' | 'settings' | 'editor' | 'panic' | null}
 */
export function shortcutFor(e) {
  if (!e.ctrlKey || !e.shiftKey) return null;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return null;
  switch (e.key.toLowerCase()) {
    case 'd': return 'debug';
    case 's': return 'settings';
    case 'e': return 'editor';
    case 'x': return 'panic';
    default: return null;
  }
}
