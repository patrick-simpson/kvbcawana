// The extension's own read of TwoTimTwo's check-in report, fetchCheckinReport()
// in chrome-extension/content.js: the list tonight's count and the
// missed-check-in pass are built from. Lifted out of the shipped file (the
// test-reconcile.cjs idiom), so the code under test is the code that runs.
//
// 2026-10-07: on the live report the child's name sits in the cell with the
// edit and undo links, and clubs with a friend / shares / points column carry
// it in the NEXT cell. The parser read that next cell first, so names came out
// as "YES 1 Share 1 Point": tonight's count merged those children into one (11
// read as 2) and the missed-check-in pass printed labels with that "name".
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function loadParser(roster = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'content.js'), 'utf8');
  const start = src.indexOf('  function fetchCheckinReport(date) {');
  const end = src.indexOf('  // Undo detection (roadmap follow-up to R-1)');
  if (start < 0 || end < 0) throw new Error('fetchCheckinReport not found in content.js');
  const factory = new Function('fetch', 'DOMParser', 'ROSTER_CACHE', 'todayIsoDate', `
    ${src.slice(start, end)}
    return fetchCheckinReport;
  `);
  return (html) => factory(
    async () => ({ ok: true, url: 'https://example.twotimtwo.com/clubber/checkin_report', text: async () => html }),
    new JSDOM('').window.DOMParser,
    roster,
    () => '2026-10-07',
  )();
}

// One club table. `layout` 'live': [edit link] Name [undo link] in one cell, a
// summary cell after it. 'old': links alone in the first cell, the name next.
function table(club, kids, { layout = 'live', count = kids.length } = {}) {
  const rows = kids.map(({ id, name, summary }) => {
    const edit = `<a class='noprint' href='/meeting/clubberCheckin/${id}?CAL=368'><i class='fa fa-pencil'></i></a>`;
    const undo = `<a href='#' class='noprint pull-right' onclick='undoCheckin(${id})'></a>`;
    return layout === 'live'
      ? `<tbody><tr><td>${edit} ${name} ${undo}</td>${summary != null ? `<td>${summary}</td>` : ''}</tr>`
      : `<tbody><tr><td>${edit}${undo}</td><td>${name}</td></tr>`;
  }).join('');
  return `<table class="table"><thead><tr><th colspan=4 class="title">` +
    `<img class="club-icon-30" src="/x.png" alt="${club}" /></th></tr>` +
    `<tr><th>2026-10-07</th><th>Clubber</th></tr></thead>${rows}` +
    `<tfoot><tr class='totals'><td><i>Count: ${count}</i></td></tr></tfoot></table>`;
}
const page = (...tables) =>
  `<html><body><table class="table"><tbody><tr><td>Title</td></tr></tbody></table>${tables.join('')}</body></html>`;

async function main() {
  console.log('\nreport parse: the live layout');
  {
    const got = await loadParser()(page(
      table('Cubbies ', [{ id: 1, name: 'Ada Tester' }]),
      table('Sparks ', [
        { id: 2, name: 'Bo Tester', summary: 'No 0 Shares 0 Points' },
        { id: 3, name: 'Cy Tester', summary: 'No 0 Shares 0 Points' },
      ]),
      table('T&amp;T ', [
        { id: 4, name: 'Di Tester', summary: 'YES 1 Share 1 Point' },
        { id: 5, name: 'Ed Tester', summary: 'YES 1 Share 1 Point' },
      ]),
    ));
    check('every child is read', got && got.length === 5, JSON.stringify(got));
    check('names come from the link cell, never the summary',
      got && got.map((e) => e.name).join(',') === 'Ada Tester,Bo Tester,Cy Tester,Di Tester,Ed Tester',
      got && got.map((e) => e.name).join(','));
    check('ids and clubs come along', got && got[3].clubberId === '4' && got[3].club === 'T&T');
    check("the report's own counts come back as `declared`", got && got.declared === 5, got && String(got.declared));
  }

  console.log('\nreport parse: the older layout still reads');
  {
    const got = await loadParser()(page(table('Sparks ', [{ id: 9, name: 'Fay Tester' }], { layout: 'old' })));
    check('the name in the next cell', got && got.length === 1 && got[0].name === 'Fay Tester', JSON.stringify(got));
  }

  console.log('\nreport parse: a summary is never a name');
  {
    const roster = { 'id:21': { displayName: 'Gus Tester' } };
    const got = await loadParser(roster)(page(table('Trek', [
      { id: 21, name: '', summary: 'YES 1 Share 1 Point' },
      { id: 22, name: '', summary: '2 Points' },
    ])));
    check('a nameless row takes the roster name for its id', got && got[0].name === 'Gus Tester', JSON.stringify(got));
    check('and with no roster name it has none, but keeps its id', got && got[1].name === '' && got[1].clubberId === '22', JSON.stringify(got));
  }

  console.log('\nreport parse: a partial read is visible');
  {
    const got = await loadParser()(page(table('Sparks ', [{ id: 31, name: 'Hal Tester' }], { count: 4 })));
    check('fewer rows than the footer says: declared tells', got && got.length === 1 && got.declared === 4, JSON.stringify({ n: got && got.length, d: got && got.declared }));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
