import { describe, expect, it, vi } from 'vitest';
import {
  PICKUP_DEFAULT, PRINT_SERVER, auditDays, auditSummary, callPrintServer, canReprint, cleanScheduleRows, formToTemplate, healthSummary,
  pickupTicked, printerOptions, probePrintServer, templateToForm, timeToday, validStartTime, withTemplate,
} from './printServer.js';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob(['png']) });
const HEALTH = { status: 'ok', printer: 'Dock', version: '8.3.0', warnings: [{ type: 'a', message: 'Out of labels' }, 'bare string'] };

describe('probePrintServer', () => {
  it('finds the print server on localhost:3456 through /health, with no token', async () => {
    const fetchFn = vi.fn(async () => json(HEALTH));
    const r = await probePrintServer({ fetchFn });
    expect(fetchFn.mock.calls[0][0]).toBe(`${PRINT_SERVER}/health`);
    expect(fetchFn.mock.calls[0][1].headers).toBeUndefined();
    expect(r.found).toBe(true);
    expect(r.health.warnings).toEqual([{ type: 'a', message: 'Out of labels' }]);
  });

  it('says unreachable when nothing answers', async () => {
    const r = await probePrintServer({ fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
    expect(r).toEqual({ found: false, reason: 'unreachable' });
  });

  it('gives up after its short timeout', async () => {
    vi.useFakeTimers();
    const fetchFn = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const p = probePrintServer({ fetchFn, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    expect(await p).toEqual({ found: false, reason: 'unreachable' });
    vi.useRealTimers();
  });

  it('does not take another app on that port for the print server', async () => {
    expect((await probePrintServer({ fetchFn: async () => json({ hello: 'world' }) })).reason).toBe('not-ours');
    expect((await probePrintServer({ fetchFn: async () => json({}, 404) })).reason).toBe('not-ours');
    expect((await probePrintServer({ fetchFn: async () => ({ ok: true, json: async () => { throw new Error('html'); } }) })).found).toBe(false);
  });
});

describe('callPrintServer', () => {
  it('sends the token as a bearer header and a JSON body', async () => {
    const fetchFn = vi.fn(async () => json({ ok: true }));
    const r = await callPrintServer('/config', { token: ' abc ', method: 'POST', body: { printerName: 'Dock' }, fetchFn });
    expect(r).toEqual({ ok: true, data: { ok: true } });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${PRINT_SERVER}/config`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ printerName: 'Dock' });
  });

  it('does not call at all without a token', async () => {
    const fetchFn = vi.fn();
    expect((await callPrintServer('/config', { token: '', fetchFn })).reason).toBe('no-token');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('tells the token problems from other refusals', async () => {
    const say = (error, status = 403) => callPrintServer('/config', { token: 't', fetchFn: async () => json({ error }, status) });
    expect((await say('No publish token is set on the print server.')).reason).toBe('no-token-on-server');
    expect((await say('Sign in to the settings page with the church passphrase first (Setup), then try again.')).reason).toBe('no-token-on-server');
    expect((await say('Wrong publish token.')).reason).toBe('wrong-token');
    expect((await say('phonePin cannot be changed from a web page')).reason).toBe('refused');
    const bad = await say('nope', 400);
    expect(bad).toMatchObject({ reason: 'rejected', status: 400, error: 'nope' });
    expect((await callPrintServer('/x', { token: 't', fetchFn: async () => { throw new Error('x'); } })).reason).toBe('unreachable');
  });

  it('returns a blob for a preview', async () => {
    const r = await callPrintServer('/preview', { token: 't', raw: true, fetchFn: async () => json({}) });
    expect(r.ok && r.data instanceof Blob).toBe(true);
  });
});

describe('the pure helpers', () => {
  it('keeps the saved printer in the menu even when Windows is not listing it', () => {
    const list = [{ name: 'A', isWindowsDefault: true }, { name: 'B' }];
    expect(printerOptions(list, 'Gone').map((o) => o.value)).toEqual(['Gone', 'A', 'B']);
    expect(printerOptions(list, 'B')[0]).toEqual({ value: 'A', label: 'A (Windows default)' });
    expect(printerOptions(null, '')).toEqual([]);
  });

  it('reads the pickup default until one is saved', () => {
    expect(pickupTicked(undefined)).toEqual(PICKUP_DEFAULT);
    expect(pickupTicked(['Sparks', 'Nope'])).toEqual(['Sparks']);
    expect(pickupTicked([])).toEqual([]);
  });

  it('turns a template form into overrides only, and back', () => {
    expect(formToTemplate(templateToForm(undefined))).toEqual({});
    const t = { showFooter: false, nameMaxPt: 30 };
    expect(templateToForm(t)).toMatchObject({ showFooter: false, showLastName: true, nameMaxPt: 30 });
    expect(formToTemplate(templateToForm(t))).toEqual(t);
    expect(templateToForm({ nameMaxPt: 99 }).nameMaxPt).toBe(48);
    expect(withTemplate({ spark: { showFooter: false } }, 'spark', {})).toEqual({});
    expect(withTemplate({}, 'default', { showFooter: false })).toEqual({ default: { showFooter: false } });
  });

  it('cleans the schedule the way the server does', () => {
    expect(cleanScheduleRows([{ club: ' Sparks ', startTime: '6:30' }, { club: '', startTime: '7:00' }]))
      .toEqual([{ club: 'Sparks', startTime: '6:30', location: '', room: '' }]);
    expect(validStartTime('6:30')).toBe(true);
    expect(validStartTime('')).toBe(true);
    expect(validStartTime('half past')).toBe(false);
  });

  it('words the laptop status', () => {
    expect(healthSummary({ ...HEALTH, warnings: [] })).toMatchObject({ tone: 'ok', lines: [] });
    const s = healthSummary({ ...HEALTH, warnings: [{ message: 'Out of labels' }], rehearsal: true });
    expect(s.tone).toBe('warn');
    expect(s.headline).toBe('2 things to check');
    expect(s.lines[0]).toMatch(/Rehearsal/);
  });

  it('offers a reprint only for a check-in label', () => {
    expect(canReprint({ firstName: 'Maya' })).toBe(true);
    expect(canReprint({ firstName: 'Maya', isAward: true })).toBe(false);
    expect(canReprint({ firstName: 'Maya', isLeader: true })).toBe(false);
    expect(canReprint({ firstName: 'Maya', oneOff: true })).toBe(false);
  });
});

describe('the moved tools\' helpers', () => {
  it('turns a typed time into today\'s instant, a whole minute either way', () => {
    const now = new Date(2026, 9, 14, 12, 0, 0);
    const from = new Date(timeToday('6:30', false, now));
    const to = new Date(timeToday('6:45', true, now));
    expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes(), from.getSeconds()]).toEqual([2026, 9, 14, 6, 30, 0]);
    expect([to.getHours(), to.getMinutes(), to.getSeconds(), to.getMilliseconds()]).toEqual([6, 45, 59, 999]);
    expect(timeToday('25:00', false, now)).toBeNull();
    expect(timeToday('6:7', false, now)).toBeNull();
    expect(timeToday('soon', true, now)).toBeNull();
    expect(timeToday('', true, now)).toBeNull();
  });

  it('counts the grid\'s age in whole days', () => {
    expect(auditDays(0)).toBe(0);
    expect(auditDays(86400000 * 2 + 5)).toBe(2);
    expect(auditDays(undefined)).toBe(0);
  });

  it('words the attendance audit from the server\'s own answer', () => {
    expect(auditSummary(null).tone).toBe('none');
    expect(auditSummary({ known: false }).text).toMatch(/no attendance grid/);
    expect(auditSummary({ known: false, reason: 'stale', ageMs: 86400000 * 9 }).text).toMatch(/9 day\(s\) old/);
    expect(auditSummary({ known: false, reason: 'no-meetings' }).text).toMatch(/no past meeting dates/);
    expect(auditSummary({ known: true, matches: true, scopeDates: 7 })).toEqual({ tone: 'ok', text: 'Agrees with TwoTimTwo across 7 meeting(s).' });
    const warn = auditSummary({ known: true, matches: false, totals: { missing: 3, ledgerOnly: 1 } });
    expect(warn.tone).toBe('warn');
    expect(warn.text).toMatch(/3 night\(s\) TwoTimTwo has/);
  });
});
