#!/usr/bin/env node
// The phone's "Undo check-in" (7.14.0): a real undo on TwoTimTwo, driven by
// the check-in page's extension, against a REALLY running print server.
//
// What it guards:
// * The queue. POST /phone/undo with inTwoTimTwo queues an `undo` action for
//   the extension and changes NOTHING here: a child with no TwoTimTwo id is
//   refused (Remove is the only way for them), the "Allow driven check-ins"
//   switch refuses it the way it refuses a phone check-in, a double-tap is one
//   action, and an extension older than 7.14 (no ?accept=undo) is never handed
//   one: it would take it for a check-in and answer "Already checked in".
// * The result. Only a literal ok:true marks the child's rows `undoneBy:
//   'twotimtwo'` and publishes a tally; a failure, a truthy-but-not-true ok,
//   and a second result for the same action change nothing. An undo nobody
//   picks up fails with the reason instead of running ten minutes later.
// * The extension. Lifted out of content.js: the post carries exactly
//   calendar_id and clubber_id to /clubber/checkinclubberundo, and only
//   TwoTimTwo's own short "(checkin undone)" counts; a page, the login form and
//   "Login Required" never do, and TwoTimTwo's report must agree.
//
// Run: node scripts/test-phone-undo.cjs

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = Number(process.env.AWANA_TEST_PORT || 34611);
const BASE = `http://127.0.0.1:${PORT}`;
const SRC = fs.readFileSync(path.join(root, 'chrome-extension', 'content.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

function extractFunction(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(`content.js no longer defines function ${name}() — update this test with the refactor`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') { depth++; opened = true; }
    else if (ch === '}') {
      depth--;
      if (opened && depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}() from content.js`);
}
const UNDO_SAY_SRC = SRC.slice(SRC.indexOf('var UNDO_SAY = {'), SRC.indexOf('};', SRC.indexOf('var UNDO_SAY = {')) + 2);

// Every tally the server publishes, instead of a trip to pusher.com.
const wire = [];
const realLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'pusher') {
    return class FakePusher {
      trigger(channel, event, payload) { wire.push({ channel, event, payload }); return Promise.resolve(); }
    };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function extensionSuite() {
  console.log('\nextension undo: what counts as "undone"');
  const undoReplyVerdict = new Function(extractFunction('undoReplyVerdict') + '; return undoReplyVerdict;')();
  // TwoTimTwo's answer (docs/TWOTIMTWO.md §2.3): a snippet with "(checkin undone)".
  check('TwoTimTwo\'s own snippet is an undo', undoReplyVerdict('<a href="/clubber/update/4821">Ava Stone</a> (checkin undone)') === 'ok');
  check('the bare words are enough, any case or spacing', undoReplyVerdict('(checkin undone)') === 'ok' && undoReplyVerdict('Ava ( Checkin  UNDONE )') === 'ok');
  check('"undone" alone, or "checkin" alone, is not', undoReplyVerdict('Ava Stone undone') === 'refused' && undoReplyVerdict('Ava Stone checkin') === 'refused');
  const PAGE = '<!DOCTYPE html><html><head><title>Check In</title></head><body><div id="lastCheckin">Ava Stone (checkin undone)</div></body></html>';
  check('a whole page is never an undo, even carrying the words', undoReplyVerdict(PAGE) === 'refused');
  check('a <body> fragment is a page too', undoReplyVerdict('<body>(checkin undone)</body>') === 'refused');
  check('a reply longer than a snippet is not', undoReplyVerdict('(checkin undone) ' + 'x'.repeat(5000)) === 'refused');
  check('the bare "Login Required" is signed out', undoReplyVerdict('Login Required') === 'signed-out');
  check('the login form is signed out, even carrying the words',
    undoReplyVerdict('<form><input name="LoginForm[username]"><input type="password" name="LoginForm[password]"> (checkin undone)</form>') === 'signed-out');
  check('empty, whitespace and non-strings are refusals', undoReplyVerdict('') === 'refused' && undoReplyVerdict('  \n') === 'refused' && undoReplyVerdict(null) === 'refused');

  console.log('\nextension undo: the post');
  {
    const calls = [];
    const mkPost = (opts) => new Function('document', 'fetch', 'findCsrfToken', 'AbortSignal', 'undoReplyVerdict',
      extractFunction('postUndoCheckin') + '; return postUndoCheckin;')(
      { getElementById: (id) => (id === 'calendar_id' && opts.cal ? { value: opts.cal } : null) },
      (url, init) => { calls.push({ url, init }); return opts.fetch ? opts.fetch(url, init) : Promise.resolve({ ok: true, status: 200, url: 'https://kvbchurch.twotimtwo.com' + url, text: () => Promise.resolve(opts.reply) }); },
      () => opts.csrf || null,
      { timeout: () => undefined },
      undoReplyVerdict);
    let r = await mkPost({ cal: '368', reply: 'Ava Stone (checkin undone)' })('4821');
    const c = calls[0];
    check('it posts to TwoTimTwo\'s own undo', c && c.url === '/clubber/checkinclubberundo' && c.init.method === 'POST' && c.init.credentials === 'same-origin', JSON.stringify(c));
    check('as a form, with exactly calendar_id and clubber_id', c && c.init.headers['Content-Type'] === 'application/x-www-form-urlencoded'
      && c.init.body === 'calendar_id=368&clubber_id=4821', c && c.init.body);
    check('and TwoTimTwo\'s "(checkin undone)" is ok', r === 'ok', r);
    calls.length = 0;
    r = await mkPost({ cal: '368', csrf: 'tok', reply: '(checkin undone)' })('4821');
    check('a CSRF token goes along only when a page has one', calls[0].init.body === 'calendar_id=368&clubber_id=4821&YII_CSRF_TOKEN=tok');
    calls.length = 0;
    r = await mkPost({ cal: '', reply: '(checkin undone)' })('4821');
    check('no meeting id on this tab: nothing is sent', r === 'no-form' && calls.length === 0);
    r = await mkPost({ cal: '368', fetch: () => Promise.resolve({ ok: true, status: 200, url: 'https://x.twotimtwo.com/site/login', text: () => Promise.resolve('(checkin undone)') }) })('4821');
    check('a redirect to the login page is signed out', r === 'signed-out', r);
    r = await mkPost({ cal: '368', fetch: () => Promise.resolve({ ok: false, status: 500, url: '', text: () => Promise.resolve('') }) })('4821');
    check('an HTTP error says which', r === 'http-500', r);
    r = await mkPost({ cal: '368', fetch: () => Promise.reject(new Error('offline')) })('4821');
    check('no network is "network", never a rejection', r === 'network', r);
    r = await mkPost({ cal: '368', reply: 'Not checked in' })('4821');
    check('anything else TwoTimTwo says is a refusal', r === 'refused', r);
  }

  console.log('\nextension undo: the whole undo');
  {
    const run = async ({ posts, report, driven = true, rowSel }) => {
      const env = { posted: 0, refreshed: 0, row: { classList: { removed: [], remove(c) { this.removed.push(c); } }, style: { display: 'none' } }, rowSel: null };
      const fn = new Function('CHURCH_CFG', 'ensureFreshCheckinTokens', 'refreshCheckinTokens', 'postUndoCheckin', 'fetchCheckinReport', 'reportHasCheckin', 'document', 'console',
        UNDO_SAY_SRC + '\n' + extractFunction('undoCheckinOnTwoTimTwo') + '; return undoCheckinOnTwoTimTwo;')(
        { enableDrivenCheckin: driven },
        () => Promise.resolve(true),
        () => { env.refreshed++; return Promise.resolve(true); },
        () => Promise.resolve(posts[env.posted++] || 'refused'),
        () => Promise.resolve(report),
        new Function('nameKeyOf', extractFunction('reportHasCheckin') + '; return reportHasCheckin;')((n) => String(n || '').toLowerCase().trim()),
        { querySelector: (sel) => { env.rowSel = sel; return rowSel === false ? null : env.row; } },
        { log() {} });
      env.out = await fn('4821', 'Ava Stone');
      return env;
    };
    let e = await run({ posts: ['ok'], report: [{ clubberId: '77', name: 'Mia Reed' }] });
    check('TwoTimTwo says undone and its report agrees: ok', e.out.ok === true && e.posted === 1, JSON.stringify(e.out));
    check('and the child\'s row comes back on the check-in page', e.rowSel === '.clubber[recid="4821"]' && e.row.classList.removed.join() === 'checked-in' && e.row.style.display === '');
    e = await run({ posts: ['ok'], report: null });
    check('an unreadable report leaves TwoTimTwo\'s word standing', e.out.ok === true);
    e = await run({ posts: ['ok'], report: [{ clubberId: '4821', name: 'Ava Stone' }] });
    check('the report still listing the child is a failure, saying so', e.out.ok === false && /still lists Ava Stone/.test(e.out.detail), JSON.stringify(e.out));
    e = await run({ posts: ['refused', 'ok'], report: [] });
    check('a refusal re-reads the page and posts once more', e.out.ok === true && e.posted === 2 && e.refreshed === 1);
    e = await run({ posts: ['refused', 'refused'], report: [] });
    check('refused twice: TwoTimTwo refused, said plainly', e.out.ok === false && e.posted === 2 && /TwoTimTwo refused the undo/.test(e.out.detail), JSON.stringify(e.out));
    e = await run({ posts: ['signed-out'], report: [] });
    check('signed out: said, and not posted again', e.out.ok === false && e.posted === 1 && /signed out of TwoTimTwo/.test(e.out.detail));
    e = await run({ posts: ['no-form'], report: [] });
    check('not the check-in page: said, and not posted again', e.out.ok === false && e.posted === 1 && /not the check-in page/.test(e.out.detail));
    e = await run({ posts: ['http-503', 'http-503'], report: [] });
    check('an HTTP error names its status', e.out.ok === false && /HTTP 503/.test(e.out.detail), e.out.detail);
    e = await run({ posts: ['ok'], report: [], driven: false });
    check('driven check-ins off on the laptop: nothing is posted, and the phone hears why', e.out.ok === false && e.posted === 0 && /switched off/.test(e.out.detail));
    const sayLen = Object.values(new Function(UNDO_SAY_SRC + '; return UNDO_SAY;')()).every((t) => t.length <= 200);
    check('every reason fits the 200 characters the server keeps', sayLen);
  }

  console.log('\nextension undo: wired to the phone queue');
  {
    check('a claimed undo action is driven as an undo, not a check-in',
      /function drivePhoneAction\(action\) \{\n    if \(action\.type === 'undo'\) \{ driveUndoAction\(action\); return; \}/.test(SRC));
    check('its result goes back as a strict ok', /reportPhoneAction\(action\.id, r\.ok === true, r\.detail\)/.test(extractFunction('driveUndoAction')));
    check('the poll tells the print server it can undo', /PRINT_SERVER \+ '\/pending-actions\?accept=undo'/.test(extractFunction('pollPendingActions')));
    check('the undo starts from a fresh meeting id', /ensureFreshCheckinTokens\(\)\.then/.test(extractFunction('undoCheckinOnTwoTimTwo')));
  }
}

async function serverSuite() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-undo-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-undo-bin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'ClubberID,FirstName,LastName,Club\n4821,Ava,Stone,Sparks\n77,Mia,Reed,T&T\n');
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake', pusherAppId: '1', pusherKey: 'k', pusherSecret: 's', pusherCluster: 'us2',
  }, null, 2));
  const now = Date.now();
  const row = (r, minsAgo) => Object.assign({ clubName: 'Sparks', printer: 'Fake', success: true, timestamp: new Date(now - minsAgo * 60000).toISOString() }, r);
  fs.writeFileSync(path.join(dataDir, 'print-history.json'), JSON.stringify([
    row({ firstName: 'Zed', lastName: 'Walker', visitor: true }, 1),
    row({ firstName: 'Mia', lastName: 'Reed', clubberId: '77', clubName: 'T&T' }, 2),
    row({ firstName: 'Ava', lastName: 'Stone', clubberId: '4821' }, 3),
  ]));
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });

  const server = require(path.join(root, 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((r) => { if (listener.listening) return r(); listener.once('listening', r); });
  const j = async (p, opts) => { const res = await fetch(BASE + p, opts); return { status: res.status, body: await res.json().catch(() => null) }; };
  const post = (p, body) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const history = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'print-history.json'), 'utf8'));
  const tallies = () => wire.filter((w) => w.event === 'tally');
  const pendingNow = (accept) => j('/pending-actions' + (accept ? '?accept=' + accept : ''), { signal: AbortSignal.timeout(600) })
    .then((r) => r.body.actions).catch(() => []);

  try {
    console.log('\nphone undo: queued, never applied on the spot');
    {
      const t0 = (await post('/phone/tonight', {})).body;
      check('(three children tonight, one an unregistered visitor)', t0.entries.length === 3, JSON.stringify(t0.entries));
      let r = await post('/phone/undo', { firstName: 'Zed', lastName: 'Walker', inTwoTimTwo: true });
      check('no TwoTimTwo id: refused, pointing at Remove', r.status === 400 && /Use Remove/.test(r.body.error), JSON.stringify(r.body));
      const before = tallies().length;
      r = await post('/phone/undo', { firstName: 'Ava', lastName: 'Stone', clubberId: '4821', inTwoTimTwo: true });
      check('with an id it is queued for the check-in page', r.status === 200 && r.body.queued === true && typeof r.body.id === 'string', JSON.stringify(r.body));
      const avaId = r.body.id;
      check('and nothing here changes yet: no row marked, no tally', !history().some((h) => h.undone) && tallies().length === before);
      check('Ava is still on tonight\'s list', (await post('/phone/tonight', {})).body.entries.some((e) => e.firstName === 'Ava'));
      const again = await post('/phone/undo', { firstName: 'Ava', lastName: 'Stone', clubberId: '4821', inTwoTimTwo: true });
      check('a double-tap is the same action', again.body.id === avaId);
      // A phone check-in waiting too, so the older poll answers at once
      // rather than holding: what it is handed is then a real answer.
      await post('/phone/checkin', { name: 'Mia Reed' });
      const old = await pendingNow('');
      check('an extension older than 7.14 is never handed it (only the check-in)',
        old.length === 1 && old[0].name === 'Mia Reed' && old[0].type === 'checkin' && !old.some((a) => a.id === avaId), JSON.stringify(old));
      const acts = await pendingNow('undo');
      const ava = acts.find((a) => a.id === avaId);
      check('a 7.14 extension gets it, typed as an undo with the clubber id', ava && ava.type === 'undo' && ava.clubberId === '4821' && ava.name === 'Ava Stone', JSON.stringify(acts));
      const st = (await j('/phone/status/' + avaId)).body;
      check('the phone sees it pending', st.status === 'pending');

      console.log('\nphone undo: the result');
      r = await post(`/pending-actions/${avaId}/claim`, {});
      check('claimed like any phone action', r.status === 200);
      r = await post(`/pending-actions/${avaId}/result`, { ok: true });
      check('a verified result is accepted', r.status === 200);
      const rows = history().filter((h) => h.firstName === 'Ava');
      check('her row is marked undone, by TwoTimTwo', rows.length === 1 && rows[0].undone === true && rows[0].undoneBy === 'twotimtwo' && typeof rows[0].undoneAt === 'string', JSON.stringify(rows));
      check('and only hers', !history().some((h) => h.firstName !== 'Ava' && h.undone));
      const t = tallies();
      check('a tally goes out at once without her', t.length > before && t[t.length - 1].payload.total === 2, JSON.stringify(t.map((w) => w.payload.total)));
      check('the phone hears done', (await j('/phone/status/' + avaId)).body.status === 'done');
      const t1 = (await post('/phone/tonight', {})).body;
      check('she is off tonight\'s list and count', !t1.entries.some((e) => e.firstName === 'Ava') && t1.checkedIn === 2, JSON.stringify(t1));
      const kid = (await post('/phone/roster', {})).body.kids.find((k) => k.name === 'Ava Stone');
      check('the roster offers Check in again, not Add back', kid && kid.checkedIn === false && kid.removedHere === false, JSON.stringify(kid));
      const n = tallies().length;
      r = await post(`/pending-actions/${avaId}/result`, { ok: false, detail: 'late' });
      check('a second result changes nothing', r.body.already === 'done' && (await j('/phone/status/' + avaId)).body.status === 'done' && tallies().length === n);
      r = await post('/phone/restore', { firstName: 'Ava', lastName: 'Stone', clubberId: '4821' });
      check('Add back cannot resurrect a child TwoTimTwo undid', r.status === 404);
    }

    console.log('\nphone undo: failures change nothing');
    {
      let r = await post('/phone/undo', { firstName: 'Mia', lastName: 'Reed', clubberId: '77', inTwoTimTwo: true });
      const id = r.body.id;
      const before = tallies().length;
      await post(`/pending-actions/${id}/claim`, {});
      await post(`/pending-actions/${id}/result`, { ok: false, detail: 'TwoTimTwo refused the undo.' });
      const st = (await j('/phone/status/' + id)).body;
      check('a refusal reaches the phone word for word', st.status === 'failed' && st.detail === 'TwoTimTwo refused the undo.', JSON.stringify(st));
      check('and nothing here changed', !history().some((h) => h.firstName === 'Mia' && h.undone) && tallies().length === before);
      r = await post('/phone/undo', { firstName: 'Mia', lastName: 'Reed', clubberId: '77', inTwoTimTwo: true });
      const id2 = r.body.id;
      check('after a failure the phone can try again (a new action)', id2 && id2 !== id);
      await post(`/pending-actions/${id2}/claim`, {});
      await post(`/pending-actions/${id2}/result`, { ok: 'true' });
      check('only a literal ok:true counts', (await j('/phone/status/' + id2)).body.status === 'failed' && !history().some((h) => h.firstName === 'Mia' && h.undone));
    }

    console.log('\nphone undo: the driven check-in switch');
    {
      const cfg = (body) => fetch(BASE + '/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      check('(switched off on this computer)', (await cfg({ enableDrivenCheckin: false })).ok);
      const r = await post('/phone/undo', { firstName: 'Mia', lastName: 'Reed', clubberId: '77', inTwoTimTwo: true });
      check('an undo is refused at once, saying why', r.status === 409 && /Allow driven check-ins/.test(r.body.error), JSON.stringify(r.body));
      check('and nothing is queued', !(await pendingNow('undo')).some((a) => a.type === 'undo' && a.status === 'pending'));
      check('Remove still works with it off (local only)', (await post('/phone/undo', { firstName: 'Zed', lastName: 'Walker' })).status === 200);
      check('(switched back on)', (await cfg({ enableDrivenCheckin: true })).ok);
    }

    console.log('\nphone undo: never left waiting');
    {
      const src = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');
      check('an undo nobody picks up in a minute fails, with the reason',
        /const UNDO_PICKUP_MS = 60 \* 1000;/.test(src)
        && /a\.status === 'pending' && now - new Date\(a\.at\)\.getTime\(\) > UNDO_PICKUP_MS\) \{\n\s+a\.status = 'failed';\n\s+a\.detail = UNDO_NOT_PICKED_UP;/.test(src));
      check('a claimed undo whose lease runs out fails, never re-driven',
        /a\.status === 'claimed' && now - a\.claimedAt > PENDING_CLAIM_MS\) \{\n\s+a\.status = 'failed';\n\s+a\.detail = UNDO_NO_ANSWER;/.test(src));
      check('the phone\'s status read is where that is noticed', /app\.get\('\/phone\/status\/:id', \(req, res\) => \{\n  prunePendingActions\(\);/.test(src));
      const phone = fs.readFileSync(path.join(root, 'print-server', 'public', 'phone.html'), 'utf8');
      check('the phone asks the laptop through /phone/undo (the relay\'s allowlisted route) with inTwoTimTwo',
        /postJson\('\/phone\/undo', \{ pin: PIN, firstName: ident\.firstName, lastName: ident\.lastName, clubberId: ident\.clubberId, inTwoTimTwo: true \}\)/.test(phone));
      check('an older laptop that only Removed is told apart (no id in its answer)', /if \(data && data\.id\) \{ pollUndo\(/.test(phone) && /was only removed from tonight’s count/.test(phone));
      check('a failure offers Remove, and only on a tap', /undoFailed[\s\S]{0,200}'Remove', function\(\) \{ askRemove\(entry\); \}/.test(phone));
      check('Undo check-in is offered only on a row with a TwoTimTwo id', /if \(e\.clubberId && !e\.visitor\) \{/.test(phone));
      const relay = require(path.join(root, 'print-server', 'phone-relay.js'));
      check('the website\'s relay already carries both calls', relay.relayAllowed('POST', '/phone/undo') && relay.relayAllowed('GET', '/phone/status/0f8c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b'));
    }
  } finally {
    try { server.stopListening && server.stopListening(); } catch { /* exiting anyway */ }
  }
}

(async () => {
  await extensionSuite();
  await serverSuite();
  await tick();
  __suiteFinished = true;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
