#!/usr/bin/env node
// One printing tab — plain Node, zero deps.
//
// Every TwoTimTwo tab runs content.js. Until 7.11.1 each one detected,
// scanned, reconciled and flushed the queue, with its own per-tab dedup
// state, so a second tab printed its own copy of every label. Now one tab
// holds the "awana-print-leader" Web Lock and runs the print machinery, the
// lock passes when it closes, and the dedup state is one localStorage copy
// keyed by the day. The functions are lifted out of content.js by brace
// matching, as the other extension tests do.
//
// Run: node scripts/test-extension-leader.cjs

'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'content.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function extractFunction(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(`content.js no longer defines function ${name}()`);
  let depth = 0, opened = false;
  for (let i = start; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') { depth++; opened = true; }
    else if (ch === '}') { depth--; if (opened && depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}()`);
}
// A browser's localStorage: length, key(i), get/set/remove.
function memStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
// The Web Locks API, as far as the election uses it: one exclusive lock, a
// queue of waiters, and query(). closeTab() releases a holder as Chrome does
// when its tab goes away.
function fakeLocks() {
  const held = new Map();        // name → { release }
  const waiting = new Map();     // name → [callbacks]
  const grant = (name, cb) => {
    let release;
    const done = new Promise((r) => { release = r; });
    held.set(name, { release });
    Promise.resolve().then(() => cb({ name, mode: 'exclusive' }));
    return done.then(() => {
      held.delete(name);
      const next = (waiting.get(name) || []).shift();
      if (next) grant(name, next);
    });
  };
  return {
    request(name, opts, cb) {
      if (!held.has(name)) return grant(name, cb);
      if (!waiting.has(name)) waiting.set(name, []);
      return new Promise((resolve) => { waiting.get(name).push((lock) => resolve(cb(lock))); });
    },
    query: async () => ({ held: Array.from(held.keys()).map((name) => ({ name })), pending: [] }),
    closeTab(name) { const h = held.get(name); if (h) h.release(); },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

const electPrintLeader = new Function('PRINT_LEADER_LOCK', extractFunction('electPrintLeader') + '; return electPrintLeader;')('awana-print-leader');
const pruneSharedDedup = new Function('SHARED_DEDUP_PREFIX', extractFunction('pruneSharedDedup') + '; return pruneSharedDedup;')('awana_shared_');

(async () => {
  console.log('\none printing tab: the first tab leads, the second waits, and takes over when the first closes');
  {
    const locks = fakeLocks();
    const log = [];
    electPrintLeader(locks, () => log.push('A leads'), () => log.push('A waits'));
    await tick();
    check('the first tab starts printing at once', log.join() === 'A leads', log.join());
    electPrintLeader(locks, () => log.push('B leads'), () => log.push('B waits'));
    await tick();
    check('the second tab does not, and is told why', log.join() === 'A leads,B waits', log.join());
    locks.closeTab('awana-print-leader');
    await tick(); await tick();
    check('when the first tab closes, the second starts printing', log.join() === 'A leads,B waits,B leads', log.join());
  }

  console.log('\none printing tab: without Web Locks a tab prints alone, as before');
  {
    let led = 0;
    electPrintLeader(null, () => led++, () => {});
    electPrintLeader({}, () => led++, () => {});
    electPrintLeader({ request() { throw new Error('blocked'); } }, () => led++, () => {});
    check('no API, an API without request(), and one that throws all lead at once', led === 3, String(led));
    let rejected = 0;
    electPrintLeader({ request: () => Promise.reject(new Error('denied')) }, () => rejected++, () => {});
    await tick();
    check('a request the browser refuses still leads', rejected === 1);
  }

  console.log('\none printing tab: the dedup state is one copy for every tab, under today\'s date');
  {
    const storage = memStorage();
    storage.setItem('awana_shared_2026-09-30_awana_printedNames', '["id:1"]');     // last club night
    storage.setItem('awana_shared_2026-09-30_awana_printedTs', '1');
    storage.setItem('awana_shared_2026-10-07_awana_printedNames', '["id:2"]');     // tonight
    storage.setItem('awana_selectedPrinterId', 'x');                               // not ours
    const gone = pruneSharedDedup(storage, '2026-10-07');
    check('last week\'s copy is removed, tonight\'s and everything else kept', gone === 2 && storage.getItem('awana_shared_2026-10-07_awana_printedNames') === '["id:2"]' && storage.getItem('awana_selectedPrinterId') === 'x' && storage.length === 2, String(gone));
    check('the store is localStorage keyed by day, and every dedup key goes through it',
      /var dedupStore = \{\s*key: function\(k\) \{ return SHARED_DEDUP_PREFIX \+ todayIsoDate\(\) \+ '_' \+ k; \}/.test(SRC)
      && !/sessionStorage\.(getItem|setItem|removeItem)\(REMOTE_/.test(SRC)
      && (SRC.match(/dedupStore\.(getItem|setItem|removeItem)\(REMOTE_/g) || []).length >= 16);
  }

  console.log('\none printing tab: what the lock gates');
  {
    const boot = SRC.slice(SRC.indexOf('function startPrintMachinery()'));
    const inside = boot.slice(0, boot.indexOf('electPrintLeader(typeof navigator'));
    for (const fn of ['watchCheckins()', 'scanClubberList', 'autoRefresh', 'ymSweep(false)', 'pollPendingActions', 'syncCsv()', 'runReconcile()', 'flushQueue', 'maybeRunDailyContractCanary']) {
      check(`${fn} runs only in the printing tab`, inside.includes(fn), fn);
    }
    const outside = SRC.slice(SRC.indexOf('// What every tab runs'), SRC.indexOf('function startPrintMachinery()'));
    for (const fn of ['loadTonight()', 'fetchPrinters()', 'restoreRosterFromLocal', 'checkForExtensionUpdate()', 'runSelectorSelfTest']) {
      check(`${fn} runs in every tab (the widget still works)`, outside.includes(fn), fn);
    }
    check('the election is wired to navigator.locks with the machinery as the leader\'s work', /electPrintLeader\(typeof navigator !== 'undefined' \? navigator\.locks : null, startPrintMachinery,/.test(SRC));
    check('the leader re-reads the shared store when it takes over', /function startPrintMachinery\(\) \{\s*loadPrintedState\(\);/.test(SRC));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
