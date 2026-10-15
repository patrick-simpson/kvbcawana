'use strict';
// The print turn (owner 2026-10-15: "during peak times printouts can go fast"): the
// station's job puller lets the NEXT job's label be drawn while this one prints, and
// the turn keeps the paper in lease order.
//
//   take()         a ticket at the back of the line (the puller, one per job, in lease order)
//   wait(token)    resolves when every ticket ahead has been released: the job may
//                  print now (a print route, right before its first label)
//   release(token) done with the printer (after the job's LAST label, and again by the
//                  puller when the job ends, whatever became of it: idempotent)
//
// Nothing can be stuck behind a ticket for ever: a wait gives up after waitMs and
// drops whatever is still ahead of it (a job that will never release), so one stuck
// job costs the next one waitMs once, never every label after it. An unknown or
// missing token (a /print from the extension, the touch screen, the settings page)
// waits for nothing: today's behaviour.

const crypto = require('crypto');

const TURN_WAIT_MS = 60 * 1000;
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * @param {{ waitMs?: number, log?: (m: string) => void }} [o]
 */
function createPrintTurns(o = {}) {
  let waitMs = Number.isFinite(o.waitMs) ? o.waitMs : TURN_WAIT_MS;
  const log = o.log || ((m) => console.log(m));
  /** @type {{ token: string, wake: (() => void) | null }[]} in line order */
  const line = [];

  const indexOf = (token) => line.findIndex((t) => t.token === token);

  function wakeHead() {
    const head = line[0];
    if (head && head.wake) { const w = head.wake; head.wake = null; w(); }
  }

  function take() {
    const token = crypto.randomUUID();
    line.push({ token, wake: null });
    return token;
  }

  /** @returns {Promise<'turn' | 'no-turn' | 'timed-out'>} */
  function wait(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return Promise.resolve('no-turn');
    const i = indexOf(token);
    if (i === -1) return Promise.resolve('no-turn');
    if (i === 0) return Promise.resolve('turn');
    return new Promise((resolve) => {
      const me = line[i];
      const timer = setTimeout(() => {
        me.wake = null;
        // Whatever is still ahead is stuck: drop it, so the labels behind do not wait again.
        const at = indexOf(token);
        if (at > 0) {
          line.splice(0, at);
          log(`[print-turn] waited ${Math.round(waitMs / 1000)} s for the label before this one; printing this one now`);
        }
        resolve('timed-out');
      }, waitMs);
      if (timer.unref) timer.unref();
      me.wake = () => { clearTimeout(timer); resolve('turn'); };
    });
  }

  function release(token) {
    const i = indexOf(token);
    if (i === -1) return;
    const [gone] = line.splice(i, 1);
    // A ticket released while still waiting (it will not print after all) lets its waiter go.
    if (gone.wake) { const w = gone.wake; gone.wake = null; w(); }
    if (i === 0) wakeHead();
  }

  return {
    take, wait, release,
    size: () => line.length,
    /** Tests: a shorter give-up time. */
    _setWaitMsForTests(ms) { if (Number.isFinite(ms) && ms >= 0) waitMs = ms; },
  };
}

module.exports = { createPrintTurns, TURN_WAIT_MS, TOKEN_RE };
