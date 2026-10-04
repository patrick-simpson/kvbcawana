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

__suiteFinished = true;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
