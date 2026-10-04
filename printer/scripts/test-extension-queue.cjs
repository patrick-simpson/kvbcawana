#!/usr/bin/env node
// Tests for the Chrome extension's offline print queue — plain Node, zero deps.
//
// The real functions are lifted out of chrome-extension/content.js (see
// test-extension-identity.cjs for why) and run against a fake page: stub
// storage, a stub print server, the real identity helpers.
//
// What it guards: a label the print server could not take (it was down,
// restarting after an update, or a driver hang past the timeout) is queued
// and printed when the server is back — not dropped. Every detection path
// marks a child printed BEFORE the print is attempted, and the flush drops a
// queued item whose child is marked printed, so until 7.11.1 the queue
// dropped every label it held the moment the server came back.
//
// Run: node scripts/test-extension-queue.cjs

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

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
  if (start < 0) throw new Error(`content.js no longer defines function ${name}() — update this test with the refactor`);
  let depth = 0, opened = false;
  for (let i = start; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') { depth++; opened = true; }
    else if (ch === '}') { depth--; if (opened && depth === 0) return SRC.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces while extracting ${name}() from content.js`);
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// One fake page: storage, a print server whose answer the test sets, and
// the lifted functions sharing one scope exactly as they do in the IIFE.
function page() {
  const env = {
    posts: [], serverOk: true,
    localStorage: memStorage(), sessionStorage: memStorage(),
  };
  const code = [
    'nameKeyOf', 'identityKey', 'resolveIdentityKey', 'markPrinted', 'unmarkPrinted',
    'getQueue', 'saveQueue', 'queuePrint', 'flushQueue',
  ].map(extractFunction).join('\n');
  const build = new Function('env', `
    const QUEUE_KEY = 'awana_printQueue';
    const PRINT_SERVER = 'http://print.test';
    const PRINT_TIMEOUT_MS = 1000;
    const PRINT_COOLDOWN = 1;
    const REMOTE_PRINTED_KEY = 'awana_printedNames';
    const REMOTE_PRINTED_TS = 'awana_printedTs';
    const AMBIGUOUS_NAME = '*';
    const ROSTER_NAME_INDEX = {};
    const localStorage = env.localStorage, sessionStorage = env.sessionStorage;
    const printedNames = new Set();
    function updateQueueBadge() {}
    function playSuccess() {}
    const fetch = (url, opts) => { env.posts.push(JSON.parse(opts.body)); return Promise.resolve({ ok: env.serverOk }); };
    ${code}
    return { markPrinted, unmarkPrinted, queuePrint, flushQueue, getQueue, printedNames, resolveIdentityKey };
  `);
  return Object.assign(build(env), { env });
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));

(async () => {
  console.log('\nextension offline queue: a queued label prints when the server is back');
  {
    const p = page();
    // What every detection path does: mark, then try to print; the server is down, so the label is queued.
    p.markPrinted('Jane Doe', '123');
    p.queuePrint({ name: 'Jane Doe', clubberId: '123', clubName: 'Sparks' });
    check('the label is in the queue', p.getQueue().length === 1);
    check('"printed" is withdrawn while it waits (the label did not print)', !p.printedNames.has(p.resolveIdentityKey('Jane Doe', '123')));
    p.env.serverOk = true;
    p.flushQueue();
    await tick();
    check('the server is back: the queued label is POSTed, not dropped', p.env.posts.length === 1 && p.env.posts[0].name === 'Jane Doe', JSON.stringify(p.env.posts));
    check('the queue is empty afterwards', p.getQueue().length === 0);
    check('and the child is marked printed again', p.printedNames.has(p.resolveIdentityKey('Jane Doe', '123')));
  }

  console.log('\nextension offline queue: a label another path printed meanwhile is dropped');
  {
    const p = page();
    p.markPrinted('Jane Doe', '123');
    p.queuePrint({ name: 'Jane Doe', clubberId: '123' });
    // The desk clicks her row while the server is back up: that path prints and marks her.
    p.markPrinted('Jane Doe', '123');
    p.flushQueue();
    await tick();
    check('the queued copy is dropped, no second label', p.env.posts.length === 0, JSON.stringify(p.env.posts));
    check('the queue is empty', p.getQueue().length === 0);
  }

  console.log('\nextension offline queue: a name-keyed mark is withdrawn too');
  {
    const p = page();
    p.markPrinted('Walk In', null);              // a hand-typed guest: no id, name key
    p.queuePrint({ name: 'Walk In', clubberId: null });
    check('the nm: key is gone', !p.printedNames.has('nm:walk in'));
    p.flushQueue();
    await tick();
    check('the guest\'s label prints', p.env.posts.length === 1);
  }

  console.log('\nextension offline queue: a server still down puts the label back');
  {
    const p = page();
    p.queuePrint({ name: 'Jane Doe', clubberId: '123' });
    p.env.serverOk = false;
    p.flushQueue();
    await tick();
    check('the label is back in the queue', p.getQueue().length === 1 && p.getQueue()[0].name === 'Jane Doe');
  }

  console.log('\nextension offline queue: the mark is withdrawn in queuePrint itself');
  check('queuePrint calls unmarkPrinted with the payload\'s identity', /unmarkPrinted\(payload\.name, payload\.clubberId\)/.test(extractFunction('queuePrint')));

  __suiteFinished = true;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
