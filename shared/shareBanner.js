// The share banner (owner 2026-11-23: "When I hand out a share, let's do a cool
// animation on every screen in the building that shows off that they got a
// share on the bottom third"; picked: first names and the amount, on every
// screen, each waiting for a gap). ONE copy of its words and timing for the
// lobby, the projector, the classroom and Journey. Pure, no imports.

/** How long one banner is up. */
export const SHARE_BANNER_MS = 6500;
/** At most this many names are spelled out; the rest are "& N more". */
export const SHARE_NAMES_MAX = 4;
/** A banner still waiting after this long is dropped (it is old news). */
export const SHARE_STALE_MS = 10 * 60 * 1000;

/**
 * The banner's two lines: the names, then the amount.
 * @param {{ kids: { firstName: string }[], shares: number }} gift
 * @returns {{ names: string, line: string }}
 */
export function shareWords(gift) {
  const names = (gift && Array.isArray(gift.kids) ? gift.kids : []).map((k) => String(k.firstName || '').toUpperCase()).filter(Boolean);
  const n = gift && Number.isInteger(gift.shares) ? gift.shares : 0;
  let who;
  if (names.length <= 1) who = names[0] || '';
  else if (names.length <= SHARE_NAMES_MAX) who = `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  else who = `${names.slice(0, SHARE_NAMES_MAX - 1).join(', ')} & ${names.length - (SHARE_NAMES_MAX - 1)} MORE`;
  const each = names.length > 1 ? ' each' : '';
  return { names: who, line: `got ${n} share${n === 1 ? '' : 's'}${each}!` };
}

/**
 * A small queue: banners wait their turn and while the screen is busy.
 * `take(now, busy)` gives the next banner to show (or null).
 */
export function createShareQueue() {
  /** @type {{ gift: any, at: number }[]} */
  const waiting = [];
  return {
    add(gift, now) { if (gift) waiting.push({ gift, at: now }); },
    size() { return waiting.length; },
    take(now, busy) {
      while (waiting.length && now - waiting[0].at > SHARE_STALE_MS) waiting.shift();
      if (busy || !waiting.length) return null;
      return waiting.shift().gift;
    },
  };
}
