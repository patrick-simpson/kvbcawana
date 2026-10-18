// The handbook sheets (handbook.js HandbookSheets, routes.md 10.12): one club's
// handbook check-off report passed through untouched for the 4 pm print job;
// the machine token or a session; one form read (cal_id kept 10 minutes) and
// one report read on the one clock; the report's names never stored.
import { describe, expect, it } from 'vitest';
import { HANDBOOK_CAL_TTL_MS, calIdOf } from '../src/handbook.js';
import { READ_INTERVAL_MS } from '../src/readbudget.js';
import { LOGIN_PAGE } from './fixtures.js';
import { leaks } from './noleak.js';
import { rig } from './rig.js';

const TOKEN = 'test-handbook-token-0123456789abcdef';
const NAMES = ['Zelda', 'Fakename', 'Quincy', 'Madeup'];
const FORM = `<!doctype html><html><head><title>Handbook</title></head><body>
<form action="" method="get">
  <input type="hidden" value="4321" name="cal_id" id="cal_id">
  <select name="club_id"><option value="4">Puggles</option><option value="1">Cubbies</option><option value="2">Sparks</option><option value="3">T&amp;T</option></select>
  <input type="checkbox" name="checked_in" value="1"> <input type="checkbox" name="print_balances" value="1">
  <input type="submit" name="yt0" value="1">
</form></body></html>`;
const REPORT_HTML = `<html><body><h1>Handbook Report</h1><table><tr><td>Zelda Fakename</td><td>1.2</td></tr><tr><td>Quincy Madeup</td><td>3.4</td></tr></table></body></html>`;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xff, 0x00, 0x80, ...new TextEncoder().encode('Zelda Fakename'), 0x0a]);

/** The stand-in TwoTimTwo handbook page: the form, or the report when submitted. */
function handbookSite({ pdf = false, seen = [] } = {}) {
  return (u) => {
    if (!u.searchParams.has('yt0')) return FORM;
    seen.push(Object.fromEntries(u.searchParams));
    return pdf
      ? new Response(PDF, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
      : new Response(REPORT_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  };
}

async function get(t, path, auth) {
  const res = await t.core.handle(new Request(`https://sync.test${path}`, { headers: auth ? { Authorization: auth } : {} }));
  return { res, status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}
const jsonOf = (r) => JSON.parse(new TextDecoder().decode(r.bytes));
const handbookReads = (t) => t.reads.filter((r) => r.path === '/meeting/handbook');
const storageText = (t) => JSON.stringify([...t.storage.map]);

describe('calIdOf', () => {
  it('finds the hidden cal_id whatever the attribute order, and only digits', () => {
    expect(calIdOf(FORM)).toBe('4321');
    expect(calIdOf(`<input name='cal_id' type=hidden value=77>`)).toBe('77');
    expect(calIdOf('<input name="cal_idx" value="5"><input name="cal_id" value="x1">')).toBe('');
    expect(calIdOf('<p>nothing</p>')).toBe('');
  });
});

describe('GET /v1/print/handbook', () => {
  it('with the token: reads the form once, then the report, and passes the PDF through untouched', async () => {
    const seen = [];
    const t = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: handbookSite({ pdf: true, seen }) });
    const before = { form: t.core.watcher.budget.taken['handbook-form'] || 0, report: t.core.watcher.budget.taken.handbook || 0 };
    const r = await get(t, '/v1/print/handbook?club=sparks', `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('application/pdf');
    expect(r.res.headers.get('x-handbook-club')).toBe('sparks');
    expect(r.res.headers.get('x-handbook-cal')).toBe('4321');
    expect(r.res.headers.get('cache-control')).toBe('no-store');
    expect([...r.bytes]).toEqual([...PDF]);
    expect(seen).toEqual([{ cal_id: '4321', club_id: '2', print_balances: '1', yt0: '1' }]);
    expect(t.core.watcher.budget.taken['handbook-form']).toBe(before.form + 1);
    expect(t.core.watcher.budget.taken.handbook).toBe(before.report + 1);
    expect(handbookReads(t)).toHaveLength(2);

    // Cubbies: no share balances; the cal_id from memory (no second form read).
    const c = await get(t, '/v1/print/handbook?club=cubbies', `Bearer ${TOKEN}`);
    expect(c.status).toBe(200);
    expect(seen[1]).toEqual({ cal_id: '4321', club_id: '1', yt0: '1' });
    // T&T, and the balances override.
    await get(t, '/v1/print/handbook?club=tnt&balances=0', `Bearer ${TOKEN}`);
    expect(seen[2]).toEqual({ cal_id: '4321', club_id: '3', yt0: '1' });
    expect(handbookReads(t)).toHaveLength(4);
    // After 10 minutes the form is read again.
    t.clock.tick(HANDBOOK_CAL_TTL_MS + 1000);
    await get(t, '/v1/print/handbook?club=cubbies&balances=1', `Bearer ${TOKEN}`);
    expect(seen[3]).toEqual({ cal_id: '4321', club_id: '1', print_balances: '1', yt0: '1' });
    expect(handbookReads(t)).toHaveLength(6);
    // Every slot on the clock one interval apart (sign-in hops included).
    const gaps = t.slots.slice(1).map((s, i) => s.at - t.slots[i].at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
    // The report's names rest nowhere.
    expect(leaks(storageText(t), NAMES)).toEqual([]);
  });

  it('an HTML report passes through with its content type; a session works too', async () => {
    const t = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: handbookSite() });
    const r = await get(t, '/v1/print/handbook?club=tnt', `Bearer ${t.session}`);
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('text/html; charset=UTF-8');
    expect(new TextDecoder().decode(r.bytes)).toBe(REPORT_HTML);
    expect(leaks(storageText(t), NAMES)).toEqual([]);
    expect(t.core.handbookSheets.cal.id).toBe('4321');
  });

  it('a wrong token or none is 401, with no read', async () => {
    const t = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: handbookSite() });
    expect((await get(t, '/v1/print/handbook?club=sparks')).status).toBe(401);
    expect((await get(t, '/v1/print/handbook?club=sparks', `Bearer ${TOKEN}x`)).status).toBe(401);
    expect((await get(t, '/v1/print/handbook?club=sparks', 'Bearer ')).status).toBe(401);
    expect(handbookReads(t)).toHaveLength(0);
  });

  it('no HANDBOOK_TOKEN secret: 503 not-configured (an unknown caller still 401)', async () => {
    const t = await rig({ handbook: handbookSite() });
    expect((await get(t, '/v1/print/handbook?club=sparks')).status).toBe(401);
    const r = await get(t, '/v1/print/handbook?club=sparks', `Bearer ${t.session}`);
    expect(r.status).toBe(503);
    expect(jsonOf(r).reason).toBe('not-configured');
    expect(handbookReads(t)).toHaveLength(0);
  });

  it('not a club night: 200 noClub with no TwoTimTwo read at all', async () => {
    const t = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: handbookSite(), start: Date.parse('2026-10-12T20:00:00Z') });
    const slots = t.slots.length;
    const r = await get(t, '/v1/print/handbook?club=sparks', `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(jsonOf(r)).toMatchObject({ ok: true, noClub: true });
    expect(t.slots.length).toBe(slots);
    expect(handbookReads(t)).toHaveLength(0);
  });

  it('test=1 prints the form\'s meeting even with no club tonight (owner test print)', async () => {
    const t = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: handbookSite(), start: Date.parse('2026-10-12T20:00:00Z') });
    const r = await get(t, '/v1/print/handbook?club=sparks&test=1', `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(new TextDecoder().decode(r.bytes)).not.toContain('noClub');
    expect(handbookReads(t).length).toBeGreaterThan(0);
  });

  it('a club it does not print, or a bad balances value, is 400 with no read', async () => {
    const t = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: handbookSite() });
    expect((await get(t, '/v1/print/handbook?club=trek', `Bearer ${TOKEN}`)).status).toBe(400);
    expect((await get(t, '/v1/print/handbook?club=sparks&balances=yes', `Bearer ${TOKEN}`)).status).toBe(400);
    expect(handbookReads(t)).toHaveLength(0);
  });

  it('the login page is 502 signed-out; a form with no meeting is 502 no-meeting; a busy clock 429', async () => {
    const a = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: () => LOGIN_PAGE });
    const ra = await get(a, '/v1/print/handbook?club=sparks', `Bearer ${TOKEN}`);
    expect(ra.status).toBe(502);
    expect(jsonOf(ra).reason).toBe('signed-out');
    const b = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: () => '<form><select name="club_id"></select></form>' });
    const rb = await get(b, '/v1/print/handbook?club=sparks', `Bearer ${TOKEN}`);
    expect(rb.status).toBe(502);
    expect(jsonOf(rb).reason).toBe('no-meeting');
    const c = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: handbookSite() });
    for (let i = 0; i < 6; i++) c.core.watcher.budget.claim(60000);
    const rc = await get(c, '/v1/print/handbook?club=sparks', `Bearer ${TOKEN}`);
    expect(rc.status).toBe(429);
    expect(jsonOf(rc).reason).toBe('read-busy');
    const d = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: () => new Response('down', { status: 503 }) });
    const rd = await get(d, '/v1/print/handbook?club=sparks', `Bearer ${TOKEN}`);
    expect(rd.status).toBe(502);
    expect(jsonOf(rd).reason).toBe('twotimtwo-down');
  });

  it('the form route also keeps the cal_id for the sheets', async () => {
    const t = await rig({ env: { HANDBOOK_TOKEN: TOKEN }, handbook: handbookSite() });
    await t.call('GET', '/v1/print/handbook-form');
    expect(t.core.handbookSheets.cal.id).toBe('4321');
    await get(t, '/v1/print/handbook?club=sparks', `Bearer ${TOKEN}`);
    expect(handbookReads(t)).toHaveLength(2);
  });
});
