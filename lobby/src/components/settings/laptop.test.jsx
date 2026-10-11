import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LaptopSection from './laptop.jsx';
import { savePublishToken } from '../../lib/publishToken.js';

const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob(['png']) });
const HEALTH = { status: 'ok', printer: 'Dock', version: '8.3.0', warnings: [{ type: 'x', message: 'The printer is out of labels' }], lobbySlides: { tokenConfigured: true } };
const CONFIG = { printerName: 'Dock', backupPrinterName: '', labelFooter: 'KVBC', pickupClubs: ['Sparks'], lateGraceMin: 10, seasonTheme: 'auto' };

const SESSION = 'v1.1.1700000000000.settingspagesettingspagesettings';

/** A stand-in print server: routes by method and path, remembers what it was sent. */
function server({ token = 'tok', online = true } = {}) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    if (!String(url).startsWith('http://localhost:3456')) return res({}, 404);   // the page's own sync.json
    const path = String(url).replace('http://localhost:3456', '');
    const method = init.method || 'GET';
    calls.push({ path, method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    if (!online) throw new TypeError('Failed to fetch');
    if (path === '/health') return res(HEALTH);
    const auth = (init.headers || {}).Authorization;
    if (auth === 'Sync v1.1.1700000000000.notthesessionnotthesessionnot') return res({ error: 'Sign in to the settings page again: the sync service did not accept its sign-in.' }, 403);
    if (auth !== `Bearer ${token}` && auth !== `Sync ${SESSION}`) return res({ error: 'Wrong publish token.' }, 403);
    if (path === '/config' && method === 'GET') return res(CONFIG);
    if (path === '/config' && method === 'POST') return res({ ok: true });
    if (path === '/printers') return res({ printers: [{ name: 'Dock' }, { name: 'Spare' }] });
    if (path === '/config/label-templates' && method === 'GET') return res({ templates: {}, knownClubs: ['spark'] });
    if (path === '/config/schedule' && method === 'GET') return res({ schedule: [{ club: 'Sparks', startTime: '6:30', location: 'Games', room: 'Hall' }], lateGraceMin: 10 });
    if (path === '/config/schedule' && method === 'POST') return res({ ok: true });
    if (path === '/history/today') return res([{ firstName: 'Maya', lastName: 'R', clubName: 'Sparks', timestamp: '2026-10-14T23:00:00Z' }]);
    if (path === '/reprint') return res({ success: true });
    if (path === '/diagnostics') return res([{ test: 'Server running', passed: true, detail: 'v8.3.0' }, { test: 'Printer detected', passed: false, detail: 'none' }]);
    if (path.startsWith('/preview')) return res({});
    return res({ error: 'nope' }, 404);
  });
  return { fn, calls };
}

beforeEach(() => {
  localStorage.clear();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Laptop section', () => {
  it('says to open the page on the laptop when nothing answers, and what it would show', async () => {
    const s = server({ online: false });
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    expect(await screen.findByText('Open this page on the check-in laptop to set the printer.')).toBeTruthy();
    expect(screen.getByText('What shows up there')).toBeTruthy();
    expect(screen.getByText('Tonight’s prints')).toBeTruthy();
    expect(screen.queryByLabelText('Name tag printer')).toBeNull();
    expect(s.calls.map((c) => c.path)).toEqual(['/health']);
  });

  it('looks again on request', async () => {
    const s = server({ online: false });
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Look again' }));
    await waitFor(() => expect(s.calls.filter((c) => c.path === '/health')).toHaveLength(2));
  });

  it('found without a token: shows the status and asks for the token, and calls nothing else', async () => {
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    expect(await screen.findByText('The printer is out of labels')).toBeTruthy();
    expect(screen.getByText('Connect to the printer')).toBeTruthy();
    expect(screen.queryByLabelText('Name tag printer')).toBeNull();
    expect(s.calls.map((c) => c.path)).toEqual(['/health']);
  });

  it('signed in with the passphrase: no token needed, the session is what is sent', async () => {
    localStorage.setItem('awanaSyncSession.v1', SESSION);
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    expect((await screen.findByLabelText('Name tag printer')).value).toBe('Dock');
    expect(s.calls.find((c) => c.path === '/config').headers.Authorization).toBe(`Sync ${SESSION}`);
  });

  it('a session the printer refuses says to sign in again, and offers the token', async () => {
    localStorage.setItem('awanaSyncSession.v1', 'v1.1.1700000000000.notthesessionnotthesessionnot');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    expect(await screen.findByText(/Sign in to the settings page again/)).toBeTruthy();
    expect(screen.getByText(/Or paste the printer/)).toBeTruthy();
    expect(screen.queryByLabelText('Name tag printer')).toBeNull();
  });

  it('found with a token: the printer, labels, pickup list, schedule and tonight', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    const tag = await screen.findByLabelText('Name tag printer');
    expect(tag.value).toBe('Dock');
    expect(screen.getByRole('textbox', { name: 'Label footer' }).value).toBe('KVBC');
    expect(screen.getByRole('checkbox', { name: 'Sparks' }).checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Cubbies' }).checked).toBe(false);
    expect(await screen.findByLabelText('Row 1 club')).toBeTruthy();
    expect(await screen.findByText('Maya R')).toBeTruthy();
    // Every call after the probe carries the token.
    for (const c of s.calls.filter((x) => x.path !== '/health')) expect(c.headers.Authorization).toBe('Bearer tok');
  });

  it('saves the printer pick with POST /config, and only that key', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.change(await screen.findByLabelText('Name tag printer'), { target: { value: 'Spare' } });
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.path === '/config')).toBe(true));
    const post = s.calls.find((c) => c.method === 'POST' && c.path === '/config');
    expect(post.body).toEqual({ printerName: 'Spare' });
    expect(await screen.findByText('Saved. The next label prints there.')).toBeTruthy();
  });

  it('saves pickup clubs as the ticked list', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Cubbies' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.body?.pickupClubs)).toBe(true));
    expect(s.calls.find((c) => c.body?.pickupClubs).body.pickupClubs).toEqual(['Cubbies', 'Sparks']);
  });

  it('saves the schedule with the late grace', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.change(await screen.findByLabelText('Row 1 starts'), { target: { value: '6:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.path === '/config/schedule')).toBe(true));
    expect(s.calls.find((c) => c.path === '/config/schedule' && c.method === 'POST').body)
      .toEqual({ schedule: [{ club: 'Sparks', startTime: '6:45', location: 'Games', room: 'Hall' }], lateGraceMin: 10 });
  });

  it('refuses a start time that is not a time, without calling the printer', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.change(await screen.findByLabelText('Row 1 starts'), { target: { value: 'soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(await screen.findByText('A start time reads like 6:30.')).toBeTruthy();
    expect(s.calls.some((c) => c.method === 'POST' && c.path === '/config/schedule')).toBe(false);
  });

  it('reprints after a confirm', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    vi.stubGlobal('confirm', vi.fn(() => true));
    window.confirm = globalThis.confirm;
    render(<LaptopSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reprint Maya' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/reprint')).toBe(true));
    expect(s.calls.find((c) => c.path === '/reprint').body).toMatchObject({ name: 'Maya R' });
  });

  it('runs the diagnostics and lists each check as passed or failed', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run diagnostics' }));
    const list = await screen.findByRole('list', { name: 'Diagnostics' });
    expect(within(list).getByText('Printer detected')).toBeTruthy();
    expect(within(list).getByText('failed')).toBeTruthy();
    expect(within(list).getByText('passed')).toBeTruthy();
  });

  it('asks for the token again when the printer says it is wrong', async () => {
    savePublishToken('stale');
    const s = server({ token: 'fresh' });
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    expect(await screen.findByText('The printer did not accept that token.')).toBeTruthy();
    expect(screen.queryByLabelText('Name tag printer')).toBeNull();
  });

  it('keeps the PIN and keys on the dashboard', async () => {
    savePublishToken('tok');
    vi.stubGlobal('fetch', server().fn);
    render(<LaptopSection />);
    await screen.findByLabelText('Name tag printer');
    expect(screen.getByText('PIN and keys')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the print dashboard' }).getAttribute('href')).toBe('http://localhost:3456/#settings');
  });
});
