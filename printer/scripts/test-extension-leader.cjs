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
    for (const fn of ['watchCheckins', 'scanClubberList', 'autoRefresh', 'ymSweep(false)', 'pollPendingActions', 'syncCsv', 'runReconcile()', 'flushQueue', 'maybeRunDailyContractCanary']) {
      check(`${fn} runs only in the printing tab`, inside.includes(fn), fn);
    }
    const outside = SRC.slice(SRC.indexOf('// What every tab runs'), SRC.indexOf('function startPrintMachinery()'));
    for (const fn of ['loadTonight', 'fetchPrinters', 'restoreRosterFromLocal', 'checkForExtensionUpdate', 'runSelectorSelfTest']) {
      check(`${fn} runs in every tab (the widget still works)`, outside.includes(fn), fn);
    }
    check('the election is wired to navigator.locks with the machinery as the leader\'s work', /electPrintLeader\(typeof navigator !== 'undefined' \? navigator\.locks : null, startPrintMachinery,/.test(SRC));
    check('the leader re-reads the shared store when it takes over', /function startPrintMachinery\(\) \{\s*bootStep\('printed state', loadPrintedState\);/.test(SRC));
  }

  console.log('\nboot: one failing step does not stop the rest');
  {
    const bootStep = new Function(extractFunction('bootStep') + '; return bootStep;')();
    const errors = [];
    const realError = console.error; console.error = (m) => errors.push(m);
    let ran = 0;
    bootStep('widget', () => { throw new Error('no #content on this page'); });
    bootStep('tonight', () => { ran++; });
    console.error = realError;
    check('the step that threw is logged by name, and the next step runs', ran === 1 && errors.length === 1 && /widget failed at boot: no #content/.test(errors[0]), JSON.stringify(errors));
    for (const step of ["bootStep('widget', injectWidget)", "bootStep('check-in watcher', watchCheckins)", "bootStep('printed state', loadPrintedState)", "bootStep('roster sync', syncCsv)", "bootStep('church config', loadChurchConfig)"]) {
      check(`${step} is guarded`, SRC.includes(step));
    }
    check('nothing boots unguarded ahead of the widget', !/^\s{2}injectWidget\(\);/m.test(SRC));
  }

  console.log('\npeak-window refresh: it asks whether the modal is SHOWING, and reloads nothing mid-flight');
  {
    // #checkin-modal is static markup on TwoTimTwo's page: always present, so
    // the old presence check meant the 5:40-6:00 reload never happened.
    const code = extractFunction('isShowing') + '\n' + extractFunction('autoRefresh');
    const build = new Function('env', `
      const document = env.document, window = env.window, location = env.location;
      const isInClubWindow = () => true;
      const getQueue = () => env.queue;
      const _quickModeProcessing = env.quick;
      const phoneActionsInFlight = env.phones;
      const Date = env.Date;
      ${code}
      return { autoRefresh, isShowing };
    `);
    const at550 = class extends Date { constructor(...a) { super(...(a.length ? a : [2026, 9, 7, 17, 50, 0])); } };
    const page = (over = {}) => {
      const modal = { isConnected: true, offsetParent: null, style: { display: over.modalShown ? 'block' : 'none' } };
      const env = {
        reloads: 0, queue: over.queue || [], quick: !!over.quick, phones: new Set(over.phones || []), Date: at550,
        document: { hidden: false, activeElement: over.typing ? { tagName: 'INPUT' } : null, getElementById: (id) => (id === 'checkin-modal' ? modal : null) },
        window: { __awanaTouchOpen: false, getComputedStyle: (el) => ({ display: el.style.display, visibility: 'visible' }) },
      };
      env.location = { reload: () => { env.reloads++; } };
      return Object.assign(build(env), { env });
    };
    let p = page();
    p.autoRefresh();
    check('with the modal present but hidden, the peak-window reload happens', p.env.reloads === 1, String(p.env.reloads));
    p = page({ modalShown: true });
    p.autoRefresh();
    check('with the modal showing, it does not', p.env.reloads === 0);
    p = page({ queue: [{ name: 'x' }] });
    p.autoRefresh();
    check('a label still queued holds the reload', p.env.reloads === 0);
    p = page({ phones: ['abc'] });
    p.autoRefresh();
    check('a phone check-in being driven holds the reload', p.env.reloads === 0);
    p = page({ quick: true });
    p.autoRefresh();
    check('a quick-mode batch holds the reload', p.env.reloads === 0);
    p = page({ typing: true });
    p.autoRefresh();
    check('typing holds it, as before', p.env.reloads === 0);
    check('isShowing: detached and display:none are not showing; offsetParent is', !p.isShowing(null) && !p.isShowing({ isConnected: false }) && p.isShowing({ isConnected: true, offsetParent: {} }));
  }

  console.log('\nphone actions: claimed before they are driven');
  {
    const build = new Function('env', `
      const PRINT_SERVER = 'http://print.test';
      const phoneActionsInFlight = env.inFlight;
      const fetch = (url, opts) => { env.calls.push(url); return Promise.resolve({ status: env.claimStatus }); };
      const drivePhoneAction = (a) => env.driven.push(a.id);
      ${extractFunction('executePhoneAction')}
      return executePhoneAction;
    `);
    const env = (claimStatus) => ({ calls: [], driven: [], inFlight: new Set(), claimStatus });
    let e = env(200);
    build(e)({ id: 'a1', name: 'Ava Stone' });
    await tick();
    check('a granted claim drives the check-in', e.calls[0] === 'http://print.test/pending-actions/a1/claim' && e.driven.join() === 'a1', JSON.stringify(e));
    build(e)({ id: 'a1', name: 'Ava Stone' });
    await tick();
    check('the same action again (the next poll) is not claimed or driven twice', e.calls.length === 1 && e.driven.length === 1);
    e = env(409);
    build(e)({ id: 'b2', name: 'Eli Stone' });
    await tick();
    check('claimed by another tab: not driven, and not left marked in flight', e.driven.length === 0 && !e.inFlight.has('b2'));
    e = env(404);
    build(e)({ id: 'c3', name: 'Mia Stone' });
    await tick();
    check('gone: not driven', e.driven.length === 0);
    const down = { calls: [], driven: [], inFlight: new Set() };
    new Function('env', `
      const PRINT_SERVER = 'x'; const phoneActionsInFlight = env.inFlight;
      const fetch = () => Promise.reject(new Error('down'));
      const drivePhoneAction = (a) => env.driven.push(a.id);
      ${extractFunction('executePhoneAction')}
      return executePhoneAction;
    `)(down)({ id: 'd4', name: 'Kai Stone' });
    await tick();
    check('the print server unreachable: driven anyway, as before', down.driven.join() === 'd4');
  }

  console.log('\nyouth check-out: a refused child is tried three times a night, not every 30 s');
  {
    const ymStillToTry = new Function('YM_MAX_FAILS', extractFunction('ymStillToTry') + '; return ymStillToTry;')(3);
    const ymPruneNights = new Function(extractFunction('ymPruneNights') + '; return ymPruneNights;')();
    check('done children and children refused three times are left alone; the rest are tried', ymStillToTry(['1', '2', '3', '4'], ['1'], { 2: 3, 3: 2 }).join() === '3,4');
    const storage = memStorage();
    storage.setItem('awanaYmOut.2026-09-30', '["5"]');
    storage.setItem('awanaYmFail.2026-09-30', '{"6":3}');
    storage.setItem('awanaYmOut.2026-10-07', '["7"]');
    storage.setItem('awana_other', 'x');
    check('other nights\' done lists and counts are pruned, tonight\'s and everything else kept', ymPruneNights(storage, '2026-10-07') === 2 && storage.length === 2 && storage.getItem('awanaYmOut.2026-10-07') === '["7"]');
    check('the sweep counts each failure and asks only the children still to try', /var ids = ymStillToTry\(Object\.keys\(want\), done, fails\);/.test(SRC) && (SRC.match(/fails\[id\] = \(fails\[id\] \|\| 0\) \+ 1;/g) || []).length === 2 && /ymMarkFails\(date, fails\);/.test(SRC));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
