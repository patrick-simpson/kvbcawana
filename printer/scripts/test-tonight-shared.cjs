#!/usr/bin/env node
// Online check-in P5: ONE authoritativeTonight. The pure rules live in
// lobby/shared/tonight.js and reach this folder as the generated
// print-server/tonight.js; the sync Worker imports the same source. This test
// pins that server.js has no copy of the rules left (it only supplies its own
// state to them), that the generated copy is the shared source's, and that the
// server's answers are the shared module's answers on the same inputs.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const root = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-tonight-shared-'));
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }));
process.env.AWANA_DATA_DIR = dataDir;
process.env.AWANA_BIND_HOST = '127.0.0.1';

const rules = require(path.join(root, 'print-server', 'tonight.js'));
const server = require(path.join(root, 'print-server', 'server.js'));
const src = fs.readFileSync(path.join(root, 'print-server', 'server.js'), 'utf8');

console.log('\nthe printer holds no second copy of the rules');
check('server.js requires the generated shared module', /require\('\.\/tonight'\)/.test(src));
for (const fn of ['tonightHereNow', 'authoritativeTonight']) {
  check(`${fn}() only hands the printer's state to the shared rules`, new RegExp(`^function ${fn}\\([^\\n]*\\) \\{\\n  return tonightRules\\.${fn}\\(tonightState\\(tonight, now\\), now\\);\\n\\}`, 'm').test(src));
}
for (const fn of ['distinctReportChildren', 'reportIsPartial', 'identityKeysOfRow', 'historyIdentityKey', 'splitFullName']) {
  check(`no local function ${fn}() in server.js`, !new RegExp(`^function ${fn}\\(`, 'm').test(src));
}
check('REPORT_FRESH_MS is the shared constant', !/^const REPORT_FRESH_MS\b/m.test(src) && server.REPORT_FRESH_MS === rules.REPORT_FRESH_MS);
check('the mass-undo guard is the shared one', /massUndoRefused\(toUndo\.length, checkedInBefore\)/.test(src));
check('the generated copy says so and is not hand-edited', fs.readFileSync(path.join(root, 'print-server', 'tonight.js'), 'utf8').startsWith('// GENERATED from lobby/shared/tonight.js'));

console.log('\nthe server answers what the shared module answers');
{
  const day = server.localDayISO();
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const NOW = Date.now() - dayStart < 60 * 60000 ? dayStart + 60 * 60000 : Date.now();
  const at = (m) => new Date(NOW - m * 60000).toISOString();
  const rows = [
    { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', clubName: 'Sparks', success: true, timestamp: at(0.5) },
    { firstName: 'Orion', lastName: 'Tester', clubberId: '9002', clubName: 'T&T', success: true, timestamp: at(30), undone: true, undoneBy: 'phone' },
    { firstName: 'Vi', lastName: 'Sitor', clubName: 'Cubbies', visitor: true, success: true, timestamp: at(20) },
  ];
  const tonight = server.tonightCheckins(rows, day);
  const report = { at: NOW - 60000, entries: [{ clubberId: '9002', name: 'Orion Tester', club: 'T&amp;T' }, { clubberId: '9003', name: 'Pax Tester', club: 'Sparks' }] };
  for (const [label, rep] of [['no report', null], ['a fresh report', report]]) {
    server._setLastCheckinReportForTests(rep);
    server._setCheckedOutForTests(null, [], []);
    const state = { tonight, report: rep, checkedOut: { date: null, ids: new Set(), names: new Set() }, dayOf: (ms) => server.localDayISO(new Date(ms)) };
    check(`${label}: authoritativeTonight`, JSON.stringify(server.authoritativeTonight(tonight, NOW)) === JSON.stringify(rules.authoritativeTonight(state, NOW)));
    check(`${label}: tonightHereNow`, JSON.stringify(server.tonightHereNow(tonight, NOW)) === JSON.stringify(rules.tonightHereNow(state, NOW)));
  }
  server._setLastCheckinReportForTests(report);
  const a = server.authoritativeTonight(tonight, NOW);
  // Orion was removed by a person: the report still lists him, and he is not counted. Nova is newer than the report.
  check('a person\'s removal beats the report', a.source === 'report' && a.checkedIn === 2 && a.byClub.Sparks === 2 && !a.byClub['T&T'], JSON.stringify(a));
  check('the visitor is not counted while a report is fresh', a.checkedIn === 2);
  server._setLastCheckinReportForTests(null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
