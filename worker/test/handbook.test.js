// The handbook check-off form, shown (handbook.js, routes.md 10.11): the page's
// form structure only, never a name; one read through the clock, then 10
// minutes from memory; a signed-in session required.
import { describe, expect, it } from 'vitest';
import { HANDBOOK_FORM_TTL_MS, parseHandbookForm } from '../src/handbook.js';
import { READ_INTERVAL_MS } from '../src/readbudget.js';
import { LOGIN_PAGE } from './fixtures.js';
import { rig } from './rig.js';

const NAMES = ['Zelda Fakename', 'Quincy Madeup', 'Orla Notreal'];

export const HANDBOOK_PAGE = `<!doctype html><html><head><title>Handbook Check-off | TwoTimTwo</title></head><body>
<h1>Handbook Report</h1><h2>Choose a club</h2>
<p>Last printed by ${NAMES[0]}</p>
<form id="handbook-form" action="/meeting/handbook?token=secret123" method="POST">
  <input type="hidden" name="YII_CSRF_TOKEN" value="abc-very-secret-token">
  <label for="club">Club</label>
  <select name="club_id" id="club">
    <option value="">Choose…</option>
    <option value="3" selected>Cubbies</option>
    <option value="4">Sparks</option>
    <option value="5">T&amp;T</option>
  </select>
  <label><input type="checkbox" name="show_shares" id="shares" value="1" checked> Print share balances</label>
  <select name="clubber_id[]" multiple><option value="901">${NAMES[1]}</option><option value="902">${NAMES[2]}</option></select>
  <label><input type="checkbox" name="clubber[903]" value="1"> ${NAMES[2]}</label>
  <input type="text" name="from_date" id="from" value="2026-10-14"><label for="from">From</label>
  <button type="submit" name="output" value="pdf">Download PDF</button>
</form>
<table><tr><td>${NAMES[0]}</td><td>${NAMES[1]}</td><td>Section 1.2</td></tr></table>
<ul><li>${NAMES[2]}</li></ul>
</body></html>`;

const noNames = (body) => {
  const text = JSON.stringify(body);
  for (const n of NAMES) for (const part of n.split(' ')) expect(text).not.toContain(part);
  expect(text).not.toContain('abc-very-secret-token');
  expect(text).not.toContain('secret123');
  expect(text).not.toMatch(/90[123]/);
};

describe('parseHandbookForm', () => {
  it('answers the form structure, labels and options, and nothing else of the page', () => {
    const f = parseHandbookForm(HANDBOOK_PAGE);
    expect(f.title).toBe('Handbook Check-off | TwoTimTwo');
    expect(f.headings).toEqual(['Handbook Report', 'Choose a club']);
    expect(f.forms).toHaveLength(1);
    const [form] = f.forms;
    expect(form).toMatchObject({ action: '/meeting/handbook', hasQuery: true, method: 'post', id: 'handbook-form' });
    const by = (name) => form.controls.find((c) => c.name === name);
    expect(by('YII_CSRF_TOKEN')).toMatchObject({ tag: 'input', type: 'hidden', value: '(hidden)' });
    expect(by('club_id')).toMatchObject({
      tag: 'select', id: 'club', multiple: false, label: 'Club', optionCount: 4,
      options: [
        { value: '', text: 'Choose…', selected: false }, { value: '3', text: 'Cubbies', selected: true },
        { value: '4', text: 'Sparks', selected: false }, { value: '5', text: 'T&T', selected: false },
      ],
    });
    expect(by('show_shares')).toMatchObject({ tag: 'input', type: 'checkbox', value: '1', checked: true, label: 'Print share balances' });
    expect(by('from_date')).toMatchObject({ type: 'text', value: '2026-10-14', label: 'From' });
    expect(by('output')).toMatchObject({ tag: 'button', type: 'submit', value: 'pdf', label: 'Download PDF' });
    // A control about a child keeps its shape, never its words.
    expect(by('clubber_id[]')).toEqual({ tag: 'select', name: 'clubber_id[]', id: '', multiple: true, optionCount: 2, withheld: true });
    expect(by('clubber[N]')).toMatchObject({ type: 'checkbox', withheld: true });
    expect(by('clubber[N]').label).toBeUndefined();
    expect(f.looseControls).toEqual([]);
    noNames(f);
  });

  it('caps what it answers', () => {
    const many = Array.from({ length: 250 }, (_, i) => `<option value="${i}">Option ${i}</option>`).join('');
    const f = parseHandbookForm(`<form><select name="book">${many}</select><input name="x" value="${'y'.repeat(200)}"></form>`);
    const sel = f.forms[0].controls[0];
    expect(sel.options).toHaveLength(200);
    expect(sel.optionsTruncated).toBe(true);
    expect(f.forms[0].controls[1].value.length).toBeLessThanOrEqual(80);
  });
});

describe('GET /v1/print/handbook-form', () => {
  it('needs a signed-in session', async () => {
    const t = await rig({ handbook: () => HANDBOOK_PAGE });
    const res = await t.core.handle(new Request('https://sync.test/v1/print/handbook-form'));
    expect(res.status).toBe(401);
    expect(t.reads.filter((r) => r.path === '/meeting/handbook')).toHaveLength(0);
  });

  it('reads the page once through the read clock, then answers from memory for 10 minutes', async () => {
    const t = await rig({ handbook: () => HANDBOOK_PAGE });
    const before = t.core.watcher.budget.taken['handbook-form'] || 0;
    const a = await t.call('GET', '/v1/print/handbook-form');
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ ok: true, cached: false, path: '/meeting/handbook', title: 'Handbook Check-off | TwoTimTwo' });
    expect(a.body.forms[0].controls.some((c) => c.label === 'Print share balances')).toBe(true);
    noNames(a.body);
    expect(t.core.watcher.budget.taken['handbook-form']).toBe(before + 1);
    const b = await t.call('GET', '/v1/print/handbook-form');
    expect(b.body.cached).toBe(true);
    t.clock.tick(HANDBOOK_FORM_TTL_MS - 1000);
    await t.call('GET', '/v1/print/handbook-form');
    expect(t.reads.filter((r) => r.path === '/meeting/handbook')).toHaveLength(1);
    t.clock.tick(2000);
    const c = await t.call('GET', '/v1/print/handbook-form');
    expect(c.body.cached).toBe(false);
    expect(t.reads.filter((r) => r.path === '/meeting/handbook')).toHaveLength(2);
    // Every slot on the clock stays one interval apart (sign-in hops included).
    const gaps = t.slots.slice(1).map((s, i) => s.at - t.slots[i].at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
  });

  it('a busy clock is a 429, and nothing is kept', async () => {
    const t = await rig({ handbook: () => HANDBOOK_PAGE });
    for (let i = 0; i < 6; i++) t.core.watcher.budget.claim(60000);
    const busy = await t.call('GET', '/v1/print/handbook-form');
    expect(busy.status).toBe(429);
    expect(busy.body.reason).toBe('read-busy');
    expect(t.core.handbookForm.cache).toBeNull();
  });

  it('the login page is 502 signed-out; TwoTimTwo down is its own code', async () => {
    const t = await rig({ handbook: () => LOGIN_PAGE });
    const r = await t.call('GET', '/v1/print/handbook-form');
    expect(r.status).toBe(502);
    expect(r.body.reason).toBe('signed-out');
    const d = await rig({ handbook: () => new Response('down', { status: 503 }) });
    const r2 = await d.call('GET', '/v1/print/handbook-form');
    expect(r2.status).toBe(502);
    expect(r2.body.reason).toBe('twotimtwo-down');
  });

  it('no TwoTimTwo secrets: 503 not-configured, no read', async () => {
    const t = await rig({ env: { TWOTIMTWO_PASSWORD: '' }, handbook: () => HANDBOOK_PAGE });
    const r = await t.call('GET', '/v1/print/handbook-form');
    expect(r.status).toBe(503);
    expect(t.reads.filter((x) => x.path === '/meeting/handbook')).toHaveLength(0);
  });
});
