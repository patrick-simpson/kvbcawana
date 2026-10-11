// The Worker's TwoTimTwo client and parsers (cloud check-in, phase 1). Pages
// are built from the selectors in printer/docs/TWOTIMTWO.md, never captured:
// obviously made-up names, no real data.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { CHECKIN_PAGE, HOUSEHOLD_CSV, LOGIN_PAGE, fakeTwoTimTwo, page, table } from './fixtures.js';
import {
  LOGIN_BACKOFF_MS,
  TwoTimTwoClient,
  credentialsFrom,
  parseCheckinPage,
  checkinReplyOk,
  parseCheckinReport,
  parseHouseholdCsv,
  rowShape,
  twoTimTwoHost,
} from '../src/twotimtwo.js';

const HOST = 'kvbchurch.twotimtwo.com';

const SAMPLES = {
  live: page(
    table('Cubbies ', [{ id: 1, name: 'Ada Tester' }]),
    table('Sparks ', [
      { id: 2, name: 'Bo Tester', summary: 'No 0 Shares 0 Points' },
      { id: 3, name: 'Cy Tester', summary: 'No 0 Shares 0 Points' },
    ]),
    table('T&amp;T ', [
      { id: 4, name: 'Di Tester', summary: 'YES 1 Share 1 Point' },
      { id: 5, name: 'Ed Tester', summary: 'YES 1 Share 1 Point' },
    ]),
  ),
  old: page(table('Sparks ', [{ id: 7, name: 'Fay Tester' }, { id: 8, name: 'Gus Tester' }], { layout: 'old' })),
  summaryOnly: page(table('T&amp;T ', [{ id: 9, name: '', summary: 'YES 1 Share 1 Point' }])),
  partial: page(table('Sparks ', [{ id: 10, name: 'Hal Tester' }], { count: 3 })),
  noFooter: page(table('Sparks ', [{ id: 11, name: 'Ivy Tester' }], { footer: false }), table('Trek ', [{ id: 12, name: 'Jo Tester' }])),
  empty: page(table('Sparks ', [])),
  // Rows with no <tbody>, and a form around a table: a browser repairs both.
  noTbody: page(table('Sparks ', [{ id: 13, name: 'Kim Tester' }, { id: 14, name: 'Lev Tester' }]).replace(/<tbody>/g, '')),
  // What the church's check-in user sees (live, 2026-10-11): no edit link,
  // only the undo control and the name in a span.
  undoOnly: page(table('Sparks ', [{ id: 17, name: 'Oz Tester' }, { id: 18, name: 'Pia Tester' }], { count: 2 })
    .replace(/<a class='noprint' href='\/meeting\/clubberCheckin\/\d+\?CAL=368'><i class='fa fa-pencil'><\/i><\/a> (\w+ \w+) /g, '<span class="name">$1</span>')),
  formAround: `<html><body><form>${table('Trek ', [{ id: 15, name: 'Max Tester' }])}</form>${table('Sparks ', [{ id: 16, name: 'Ned Tester' }])}</body></html>`,
};

// The extension's own parser, lifted out of content.js exactly as
// printer/scripts/test-report-parse.cjs lifts it, run on jsdom's DOMParser:
// a standard HTML tree builder, as Chrome is, so the agreement below is with
// what the extension reads on the live site (on linkedom's own, laxer parser
// it agreed with the Worker's first copy, which read no rows on 2026-10-11).
function extensionParser() {
  const src = readFileSync(new URL('../../../printer/chrome-extension/content.js', import.meta.url), 'utf8');
  const start = src.indexOf('  function fetchCheckinReport(date) {');
  const end = src.indexOf('  // Undo detection (roadmap follow-up to R-1)');
  if (start < 0 || end < 0) throw new Error('fetchCheckinReport not found in content.js');
  const factory = new Function('fetch', 'DOMParser', 'ROSTER_CACHE', 'todayIsoDate',
    `${src.slice(start, end)}\nreturn fetchCheckinReport;`);
  return (html) => factory(
    async () => ({ ok: true, url: `https://${HOST}/clubber/checkin_report`, text: async () => html }),
    new JSDOM('').window.DOMParser, {}, () => '2026-10-07',
  )();
}

describe('the check-in report parser', () => {
  it('reads the live layout: names from the link cell, ids, clubs, the declared count', () => {
    const r = parseCheckinReport(SAMPLES.live);
    expect(r.entries.map((e) => e.name)).toEqual(['Ada Tester', 'Bo Tester', 'Cy Tester', 'Di Tester', 'Ed Tester']);
    expect(r.entries[3]).toEqual({ clubberId: '4', name: 'Di Tester', club: 'T&T' });
    expect(r.declared).toBe(5);
  });

  it('never takes a summary cell for a name', () => {
    expect(parseCheckinReport(SAMPLES.summaryOnly).entries).toEqual([{ clubberId: '9', name: '', club: 'T&T' }]);
  });

  it('reads rows the way a browser builds them, <tbody> or not (the live report, 2026-10-11)', () => {
    const r = parseCheckinReport(SAMPLES.noTbody);
    expect(r.entries.map((e) => e.clubberId)).toEqual(['13', '14']);
    expect(r.declared).toBe(2);
    expect(parseCheckinReport(SAMPLES.formAround).entries.map((e) => e.club)).toEqual(['Trek', 'Sparks']);
  });

  it('reads the check-in user\'s report, which has only the undo control (live, 2026-10-11)', () => {
    expect(SAMPLES.undoOnly).not.toContain('clubberCheckin');
    const r = parseCheckinReport(SAMPLES.undoOnly);
    expect(r.entries).toEqual([
      { clubberId: '17', name: 'Oz Tester', club: 'Sparks' },
      { clubberId: '18', name: 'Pia Tester', club: 'Sparks' },
    ]);
    expect(r.declared).toBe(2);
  });

  it('a busy night (300 children) parses in well under a second', () => {
    const kids = Array.from({ length: 300 }, (_, i) => ({ id: 1000 + i, name: `Kid${i} Tester`, summary: 'YES 1 Share 1 Point' }));
    const html = page(table('Sparks ', kids.slice(0, 150)), table('T&amp;T ', kids.slice(150)));
    const t0 = performance.now();
    expect(parseCheckinReport(html).entries).toHaveLength(300);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('a club table without a Count: footer makes declared unknown', () => {
    const r = parseCheckinReport(SAMPLES.noFooter);
    expect(r.entries).toHaveLength(2);
    expect(r.declared).toBeNull();
  });

  it('an empty night is an empty report; the login form or a strange page is no report at all', () => {
    expect(parseCheckinReport(SAMPLES.empty)).toEqual({ entries: [], declared: 0 });
    expect(parseCheckinReport(LOGIN_PAGE)).toBeNull();
    expect(parseCheckinReport('<html><body><p>Maintenance</p></body></html>')).toBeNull();
    expect(parseCheckinReport(page())).toBeNull();
  });

  // The extension runs as the volunteer, whose report has edit links; the
  // undo-only page is the check-in user's, which only this parser reads.
  it.each(Object.keys(SAMPLES).filter((k) => k !== 'undoOnly'))('agrees with the extension\'s own parser (%s)', async (name) => {
    const ours = parseCheckinReport(SAMPLES[name]);
    const theirs = await extensionParser()(SAMPLES[name]);
    expect(ours.entries).toEqual([...theirs].map((e) => ({ clubberId: e.clubberId, name: e.name, club: e.club })));
    expect(ours.declared).toBe(typeof theirs.declared === 'number' ? theirs.declared : null);
  });
});

describe('the row shape (for a report that reads short)', () => {
  it('describes how rows are built without a word of their text', () => {
    const html = page(table('Sparks ', [{ id: 4121, name: 'Zed Uniquename', summary: 'YES 1 Share 1 Point' }]));
    const shape = rowShape(html);
    expect(shape.rows).toBe(1);
    expect(shape.sample[0]).toMatchObject({ cells: 2, links: ['/meeting/clubberCheckin/N', ''], handlers: ['onclick:undoCheckin'] });
    expect(shape.sample[0].attrs).toContain('a[href]');
    expect(JSON.stringify(shape)).not.toMatch(/Uniquename|Zed|4121|YES|Share/);
  });

  it('a handler that carries text gives only its function name', () => {
    const html = page(table('Sparks ', []).replace('</thead>', "</thead><tr><td onclick=\"confirm('Undo Zed Uniquename?')\">x</td></tr>"));
    expect(JSON.stringify(rowShape(html))).not.toContain('Uniquename');
  });
});

describe('the household export', () => {
  it('keeps families of two or more, by the children\'s names, and nothing else', () => {
    const families = parseHouseholdCsv(HOUSEHOLD_CSV);
    expect(families).toEqual([['Sophie Tester', 'Cal Tester'], ['Ann Smith', 'Ben Smith', 'Cy Smith']]);
    expect(JSON.stringify(families)).not.toMatch(/Elm|Oak|Pine|555|Pat|Kim|note/);
  });

  it('is not the export: the login form, a page, or another header', () => {
    expect(parseHouseholdCsv(LOGIN_PAGE)).toBeNull();
    expect(parseHouseholdCsv('<html><body>Not allowed</body></html>')).toBeNull();
    expect(parseHouseholdCsv('"Name","Kids"\n"x","a, b"')).toBeNull();
    expect(parseHouseholdCsv('')).toBeNull();
  });
});

describe('the check-in page parser', () => {
  it('reads the meeting, its date, its items with their clubs, and the roster', () => {
    const p = parseCheckinPage(CHECKIN_PAGE);
    expect(p.calendarId).toBe('368');
    expect(p.meetingDate).toBe('2026-10-14');
    expect(p.events).toEqual([
      { id: '707', clubs: ['2', '3', '6'], automatic: false, label: 'Bible' },
      { id: '40', clubs: ['4', '1', '2', '3', '6'], automatic: true, label: 'Attendance' },
    ]);
    expect(p.roster).toEqual([
      { clubberId: '662', clubId: '2', name: 'Kit Tester', club: 'Sparks', checkedIn: false },
      { clubberId: '663', clubId: '3', name: 'Lu Tester', club: '', checkedIn: true },
    ]);
  });

  it('a check-in counts only on a short reply naming the child', () => {
    expect(checkinReplyOk('<b>Kit Tester</b> 6:02 pm', 'Kit Tester')).toBe(true);
    expect(checkinReplyOk('<b>Lu Tester</b>', 'Kit Tester')).toBe(false);
    expect(checkinReplyOk('<html><body>Kit Tester and everyone</body></html>', 'Kit Tester')).toBe(false);
    expect(checkinReplyOk('Login Required', 'Kit Tester')).toBe(false);
    expect(checkinReplyOk(`Kit ${'x'.repeat(5000)}`, 'Kit Tester')).toBe(false);
    expect(checkinReplyOk('', 'Kit Tester')).toBe(false);
  });

  it('no meeting id means it is not the check-in page', () => {
    expect(parseCheckinPage('<html><body></body></html>')).toBeNull();
    expect(parseCheckinPage(LOGIN_PAGE)).toBeNull();
  });
});

describe('the host and the credentials', () => {
  it('only a *.twotimtwo.com host is accepted, and the church\'s is the default', () => {
    expect(twoTimTwoHost('')).toBe(HOST);
    expect(twoTimTwoHost(' KVBChurch.TwoTimTwo.com ')).toBe(HOST);
    for (const bad of ['evil.com', 'kvbchurch.twotimtwo.com.evil.com', 'https://kvbchurch.twotimtwo.com', 'a.b.twotimtwo.com']) {
      expect(twoTimTwoHost(bad)).toBeNull();
    }
  });

  it('both the user and the password are needed', () => {
    expect(credentialsFrom({})).toBeNull();
    expect(credentialsFrom({ TWOTIMTWO_USERNAME: 'checkin@example.org' })).toBeNull();
    expect(credentialsFrom({ TWOTIMTWO_USERNAME: 'u', TWOTIMTWO_PASSWORD: 'p', TWOTIMTWO_HOST: 'evil.com' })).toBeNull();
    expect(credentialsFrom({ TWOTIMTWO_USERNAME: 'u', TWOTIMTWO_PASSWORD: 'p' })).toEqual({ host: HOST, username: 'u', password: 'p' });
  });
});

const CREDS = { host: HOST, username: 'checkin@example.org', password: 'right-pass' };

describe('the TwoTimTwo client', () => {
  it('signs in with the CSRF token, keeps the session cookie and reads the report', async () => {
    const tt = fakeTwoTimTwo({ report: () => SAMPLES.live });
    const c = new TwoTimTwoClient(CREDS, { fetchFn: tt.fetchFn });
    const r = await c.report('2026-10-14');
    expect(r.ok).toBe(true);
    expect(r.report.entries).toHaveLength(5);
    const post = tt.calls.find((x) => x.method === 'POST');
    expect(post.path).toBe('/site/login');
    expect(post.body.get('LoginForm[username]')).toBe('checkin@example.org');
    expect(tt.calls.at(-1).path).toBe('/clubber/checkin_report?date=2026-10-14');
    expect(tt.calls.at(-1).cookie).toMatch(/PHPSESSID=s1/);
    expect(tt.calls.every((x) => x.host === HOST && x.redirect === 'manual')).toBe(true);
  });

  it('reuses the session, and signs in again only when it has expired', async () => {
    const tt = fakeTwoTimTwo();
    const c = new TwoTimTwoClient(CREDS, { fetchFn: tt.fetchFn });
    await c.report('2026-10-14');
    await c.report('2026-10-14');
    expect(c.logins).toBe(1);
    tt.expire();
    expect((await c.report('2026-10-14')).ok).toBe(true);
    expect(c.logins).toBe(2);
  });

  it('a refused password backs off 5, 15, then 60 minutes, and never says the password', async () => {
    let t = 0;
    const tt = fakeTwoTimTwo();
    const c = new TwoTimTwoClient({ ...CREDS, password: 'wrong-pass' }, { fetchFn: tt.fetchFn, now: () => t });
    const first = await c.report('2026-10-14');
    expect(first).toEqual({ ok: false, error: 'login-refused' });
    const posts = () => tt.calls.filter((x) => x.method === 'POST').length;
    expect(posts()).toBe(1);
    expect(await c.report('2026-10-14')).toEqual({ ok: false, error: 'login-backoff' });
    expect(posts()).toBe(1);
    t += LOGIN_BACKOFF_MS[0];
    await c.report('2026-10-14');
    expect(posts()).toBe(2);
    expect(c.loginBlockedUntil - t).toBe(LOGIN_BACKOFF_MS[1]);
    t += LOGIN_BACKOFF_MS[1];
    await c.report('2026-10-14');
    t += LOGIN_BACKOFF_MS[2];
    await c.report('2026-10-14');
    expect(c.loginBlockedUntil - t).toBe(LOGIN_BACKOFF_MS[2]);
    expect(JSON.stringify(first)).not.toContain('wrong-pass');
  });

  it('never follows a redirect off the TwoTimTwo host', async () => {
    const tt = fakeTwoTimTwo();
    tt.offsite = true;
    const c = new TwoTimTwoClient(CREDS, { fetchFn: tt.fetchFn });
    expect(await c.report('2026-10-14')).toEqual({ ok: false, error: 'off-site-redirect' });
    expect(tt.calls.every((x) => x.host === HOST)).toBe(true);
  });

  it('TwoTimTwo down is a fixed code, with no back-off', async () => {
    const tt = fakeTwoTimTwo();
    tt.down = true;
    const c = new TwoTimTwoClient(CREDS, { fetchFn: tt.fetchFn });
    expect(await c.report('2026-10-14')).toEqual({ ok: false, error: 'twotimtwo-down' });
    expect(c.loginBlockedUntil).toBe(0);
  });

  it('a network failure is a fixed code, never the error\'s own text', async () => {
    const c = new TwoTimTwoClient(CREDS, { fetchFn: async () => { throw new TypeError(`fetch failed for https://${HOST}/?password=x`); } });
    expect(await c.report('2026-10-14')).toEqual({ ok: false, error: 'network' });
  });

  it('reads the check-in page', async () => {
    const tt = fakeTwoTimTwo();
    const c = new TwoTimTwoClient(CREDS, { fetchFn: tt.fetchFn });
    const r = await c.checkinPage();
    expect(r.ok && r.page.calendarId).toBe('368');
  });
});
