// fetch() with a deadline. A request on a church network can black-hole (an
// access point that is up with no WAN behind it, a captive portal that takes
// the connection and never answers): fetch then waits on the OS, for minutes
// or for ever, and every loader here that coalesces its calls (useSync's
// syncNow, useCalendar's load) sat behind that one hung request for the rest
// of the page's life. Every network request the signage makes goes through
// this, so a dead request is a failed one within FETCH_TIMEOUT_MS and the
// next poll gets its turn.

import { FETCH_TIMEOUT_MS } from './constants.js';

/**
 * @param {RequestInfo | URL} input
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export function timedFetch(input, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  if (init.signal || typeof AbortController !== 'function') return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`timed out after ${timeoutMs} ms`, 'TimeoutError')), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
