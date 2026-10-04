#!/usr/bin/env node
// Tests for the Chrome extension's direct check-in path — plain Node, zero deps.
//
// Same approach as test-extension-identity.cjs: chrome-extension/content.js is
// one IIFE that exports nothing, so the real function source is lifted out by
// brace-matching and evaluated here. A renamed helper fails loudly.
//
// What it guards (7.11.0): whether a reply from TwoTimTwo's
// POST /clubber/checkinclubber counts as "the child is checked in". Getting
// this wrong once sent a green "checked in" to a phone, hid the row and printed
// a label while TwoTimTwo had recorded nothing: the old test was "the child's
// first name appears somewhere in the reply", which a whole check-in page or
// the login form passes too.
//
// Run: node scripts/test-extension-checkin.cjs

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

// eslint-disable-next-line no-new-func
const checkinReplyOk = new Function(extractFunction('checkinReplyOk') + '; return checkinReplyOk;')();

console.log('\nextension check-in reply: what counts as "checked in"');

// TwoTimTwo's real answer: the short #lastCheckin snippet naming the child.
const SNIPPET = '<a href="/clubber/update/4821">Ava Stone</a> <small>(<a href="#" onclick="undoCheckin(4821)">undo</a>)</small>';
check('the #lastCheckin snippet naming the child is a check-in', checkinReplyOk(SNIPPET, 'Ava Stone') === true);
check('a bare name is enough', checkinReplyOk('Ava Stone', 'Ava Stone') === true);
check('case does not matter', checkinReplyOk('AVA STONE checked in', 'Ava Stone') === true);
check('a snippet naming a different child is not', checkinReplyOk(SNIPPET, 'Eli Stone') === false);

// What the old test let through.
const PAGE = '<!DOCTYPE html>\n<html><head><title>Check In</title></head><body>'
  + '<div class="clubbers"><div class="clubber" recid="4821"><span class="name">Ava Stone</span></div>'
  + '<div class="clubber" recid="4822"><span class="name">Eli Stone</span></div></div>'
  + '<div id="lastCheckin">Last checked in: <div></div></div></body></html>';
check('the whole check-in page (every name on the roster) is NOT a check-in', checkinReplyOk(PAGE, 'Ava Stone') === false);
check('a page without a doctype is still a page', checkinReplyOk('<html><body>Ava Stone</body></html>', 'Ava Stone') === false);
check('a <body> fragment is still a page', checkinReplyOk('<body class="x">Ava</body>', 'Ava Stone') === false);

const LOGIN = '<form id="login-form" action="/site/login" method="post">'
  + '<input type="text" name="LoginForm[username]" value="Ava Stone" />'
  + '<input type="password" name="LoginForm[password]" /></form>';
check('the login form is NOT a check-in, even naming the child', checkinReplyOk(LOGIN, 'Ava Stone') === false);
check('the bare "Login Required" the AJAX endpoints answer is NOT', checkinReplyOk('Login Required', 'Ava Stone') === false);
check('a password box anywhere means signed out', checkinReplyOk('Ava Stone <input type="password">', 'Ava Stone') === false);

check('an empty reply is NOT', checkinReplyOk('', 'Ava Stone') === false);
check('a non-string reply is NOT', checkinReplyOk(null, 'Ava Stone') === false && checkinReplyOk(undefined, 'Ava Stone') === false);
check('whitespace only is NOT', checkinReplyOk('   \n ', 'Ava Stone') === false);
check('a reply longer than a snippet is NOT', checkinReplyOk('Ava Stone ' + 'x'.repeat(5000), 'Ava Stone') === false);
check('no child name to confirm against: NOT (nothing to verify)', checkinReplyOk(SNIPPET, '') === false && checkinReplyOk(SNIPPET, null) === false);

// The two direct-post paths must both use it.
const uses = (fn) => extractFunction(fn).includes('checkinReplyOk(');
check('driveCheckinDirect (phone and Quick Mode) judges its reply with checkinReplyOk', uses('driveCheckinDirect'));
check('postTouchCheckin (the touch screen) judges its reply with checkinReplyOk', uses('postTouchCheckin'));
check('no direct-post path still trusts "the first name appears in the reply"',
  !/text\.indexOf\(firstName\)/.test(SRC) && !/indexOf\(first\.toLowerCase\(\)\) === -1\) return 'no-confirm'/.test(SRC));

console.log('\nextension undo detection: the word, never a substring of a name');
{
  const isUndo = new Function(extractFunction('isUndo') + '; return isUndo;')();
  check('"(checkin undone)" after a name is an undo', isUndo('Ava Stone (checkin undone)') === true);
  check('the undo link\'s own word is an undo', isUndo('undo') === true && isUndo('Ava Stone undo') === true);
  check('case does not matter', isUndo('Ava Stone (Checkin UNDONE)') === true);
  check('Mundo is a name, not an undo', isUndo('Mundo') === false && isUndo('Carlos Mundo') === false);
  check('Dundon, Fundora and Mundorf are names', isUndo('Dundon') === false && isUndo('Fundora') === false && isUndo('Mundorf') === false);
  check('empty and non-string are not', isUndo('') === false && isUndo(null) === false && isUndo(undefined) === false);
  check('doPrint no longer tests the child\'s name or club for "undo"', !/isUndo\(firstName\)/.test(extractFunction('doPrint')));
}

console.log('\nextension check-in tokens: a fresh meeting id before every direct post');
{
  // ensureFreshCheckinTokens() reads CHECKIN_TOKENS and calls refreshCheckinTokens();
  // both are supplied here so the lifted function runs as shipped.
  const calls = [];
  const mk = (ageMs) => new Function('CHECKIN_TOKENS', 'refreshCheckinTokens', 'Date',
    extractFunction('ensureFreshCheckinTokens') + '; return ensureFreshCheckinTokens;')(
    { at: 1000000 - ageMs, freshMs: 5 * 60 * 1000 },
    () => { calls.push('refresh'); return Promise.resolve(true); },
    { now: () => 1000000 });
  (async () => {
    const fresh = await mk(60 * 1000)();
    check('a page copy a minute old is used as is', fresh === true && calls.length === 0, JSON.stringify(calls));
    const stale = await mk(6 * 60 * 1000)();
    check('a page copy older than five minutes is re-read first', stale === true && calls.length === 1, JSON.stringify(calls));
    check('the freshness window is five minutes', /freshMs: 5 \* 60 \* 1000/.test(SRC));
    check('a successful re-read stamps the copy fresh', /if \(cal && cal\.value\) CHECKIN_TOKENS\.at = Date\.now\(\);/.test(extractFunction('refreshCheckinTokens')));

    const direct = extractFunction('tryDirectCheckin');
    check('tryDirectCheckin (phone, Quick Mode) starts from a fresh meeting id', /ensureFreshCheckinTokens\(\)\.then/.test(direct));
    check('tryDirectCheckin re-reads the page and posts once more after a refusal',
      /refreshCheckinTokens\(\)\.then\(function\(\) \{ return driveCheckinDirect\(/.test(direct)
      && direct.split('driveCheckinDirect(').length === 3);
    check('touchCheckin (the touch screen) starts from a fresh meeting id too', /ensureFreshCheckinTokens\(\)\.then/.test(extractFunction('touchCheckin')));


    console.log('\nextension phone check-in: the green line comes from TwoTimTwo\'s report');
    {
      const reportHasCheckin = new Function('nameKeyOf',
        extractFunction('reportHasCheckin') + '; return reportHasCheckin;')(
        new Function(extractFunction('nameKeyOf') + '; return nameKeyOf;')());
      const report = [{ clubberId: '4821', name: 'Ava Stone', club: 'Sparks' }, { clubberId: '77', name: 'Mia  Lee', club: 'T&T' }];
      check('the child is on the report by TwoTimTwo id', reportHasCheckin(report, '4821', 'Someone Else') === true);
      check('the child is on the report by name when the row had no id', reportHasCheckin(report, null, 'ava stone') === true);
      check('spacing in the report name does not matter', reportHasCheckin(report, null, 'Mia Lee') === true);
      check('a child not on the report is not checked in', reportHasCheckin(report, '9', 'Eli Stone') === false);
      check('an empty report is "not checked in", not "unknown"', reportHasCheckin([], '4821', 'Ava Stone') === false);
      check('an unreadable report is unknown (null), never a yes', reportHasCheckin(null, '4821', 'Ava Stone') === null && reportHasCheckin(undefined, '4821', 'Ava Stone') === null);

      const exec = extractFunction('executePhoneAction');
      check('the phone executor reports success only through the report check', !/reportPhoneAction\(action\.id, true, ''\)/.test(exec.replace(extractFunction('reportDone'), '')) && /confirmCheckinOnReport\(recid, action\.name\)/.test(extractFunction('reportDone')));
      check('a printed child whose row is still on the page is driven, not reported "already in"',
        exec.indexOf('var el = findClubberElByName(action.name);') < exec.indexOf("'Already checked in at this station'")
        && /if \(isPrinted\(action\.name\)\) reportPhoneAction\(action\.id, true, 'Already checked in at this station'\)/.test(exec));
      check('when the report has no record the row comes back and the phone hears why',
        /row\.classList\.remove\('checked-in'\); row\.style\.display = ''/.test(extractFunction('reportDone'))
        && /TwoTimTwo did not record the check-in/.test(extractFunction('reportDone')));
    }
    __suiteFinished = true;
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  })();
}
