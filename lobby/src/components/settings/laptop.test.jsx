import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LaptopSection from './laptop.jsx';
import { savePublishToken } from '../../lib/publishToken.js';

// The section draws a dozen cards that each ask the stand-in server for something; on a busy CI
// runner (or the full suite with coverage) the default 1 s is not always enough.
configure({ asyncUtilTimeout: 5000 });

const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob(['png']) });
const HEALTH = {
  status: 'ok', printer: 'Dock', version: '8.3.0', warnings: [{ type: 'x', message: 'The printer is out of labels' }],
  lobbySlides: { tokenConfigured: true }, sync: { signedIn: true, state: 'ok' }, rehearsal: false, printFailures: 0,
};
const CONFIG = { printerName: 'Dock', backupPrinterName: '', labelFooter: 'KVBC', pickupClubs: ['Sparks'], lateGraceMin: 10, seasonTheme: 'auto' };

const SESSION = 'v1.1.1700000000000.settingspagesettingspagesettings';

/** A stand-in print server: routes by method and path, remembers what it was sent. */
function server({ token = 'tok', online = true, health = HEALTH, audit } = {}) {
  const calls = [];
  let rehearsal = Boolean(health.rehearsal);
  const fn = vi.fn(async (url, init = {}) => {
    if (!String(url).startsWith('http://localhost:3456')) return res({}, 404);   // the page's own sync.json
    const path = String(url).replace('http://localhost:3456', '');
    const method = init.method || 'GET';
    calls.push({ path, method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    if (!online) throw new TypeError('Failed to fetch');
    if (path === '/health') return res({ ...health, rehearsal });
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
    if (path === '/clubs') return res({ clubs: ['Puggles', 'Sparks', 'T&T'] });
    if (path === '/leaders' && method === 'GET') return res({ leaders: [{ key: 'ann lee', firstName: 'Ann', lastName: 'Lee', clubName: 'Sparks' }], hidden: 1, clubs: [] });
    if (path === '/leaders/forget') return res({ ok: true, removed: true, leaders: [], hidden: 1 });
    if (path === '/print-leader') return res({ success: true, printed: 1 });
    if (path === '/print-oneoff') return res({ success: true, firstName: 'Zed' });
    if (path === '/print-custom') return res({ success: true });
    if (path === '/reprint-range') {
      return init.body && JSON.parse(init.body).confirm
        ? res({ confirmed: true, printed: [{ name: 'Maya R' }, { name: 'Zed Q' }] })
        : res({ confirmed: false, count: 2, rows: [{ name: 'Maya R', clubName: 'Sparks' }, { name: 'Zed Q', clubName: 'T&T' }] });
    }
    if (path === '/attendance-audit' && method === 'GET') return res(audit || { known: false });
    if (path === '/attendance-audit/apply') return res({ ok: true, added: 2, children: ['Maya R'], deleted: 0 });
    if (path === '/rehearsal') { rehearsal = JSON.parse(init.body).on === true; return res({ ok: true, rehearsal }); }
    if (path === '/config/sync-login') return res({ ok: true, kid: 'abc', changedKey: false });
    if (path === '/failures') return res([{ name: 'Maya R', club: 'Sparks', at: '2026-10-14T23:00:00Z', error: 'Printer offline' }]);
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
    expect(screen.getByText(/Or paste a publish token/)).toBeTruthy();
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

  it('has no dashboard, no PIN and no keys: the page is the only place', async () => {
    savePublishToken('tok');
    vi.stubGlobal('fetch', server().fn);
    render(<LaptopSection />);
    await screen.findByLabelText('Name tag printer');
    expect(screen.queryByText('PIN and keys')).toBeNull();
    expect(screen.queryByRole('link', { name: /print dashboard/i })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/localhost:3456\/#/);
    expect(screen.queryByLabelText(/PIN/i)).toBeNull();
    expect(screen.queryByText(/Wi-?Fi access/i)).toBeNull();
    expect(screen.queryByText(/display key/i)).toBeNull();
  });

  it('prints a leader tag, lists the remembered ones, and forgets one after a confirm', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    vi.stubGlobal('confirm', vi.fn(() => true));
    window.confirm = globalThis.confirm;
    render(<LaptopSection />);
    fireEvent.change(await screen.findByLabelText('Leader’s name'), { target: { value: 'Bo Kim' } });
    fireEvent.change(screen.getByLabelText('Leader’s club'), { target: { value: 'Sparks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Print leader tag' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/print-leader')).toBe(true));
    expect(s.calls.find((c) => c.path === '/print-leader').body).toEqual({ name: 'Bo Kim', clubName: 'Sparks' });
    expect(await screen.findByText('Printed Bo Kim.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Forget Ann Lee' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/leaders/forget')).toBe(true));
    expect(s.calls.find((c) => c.path === '/leaders/forget').body).toEqual({ key: 'ann lee' });
  });

  it('prints a one-off tag only with a name and a club, and a custom label with its text', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Print tag' }));
    expect(await screen.findByText('Type the child’s first name first.')).toBeTruthy();
    expect(s.calls.some((c) => c.path === '/print-oneoff')).toBe(false);
    fireEvent.change(screen.getByLabelText('Child’s first name'), { target: { value: 'Zed' } });
    fireEvent.change(screen.getByLabelText('Child’s club'), { target: { value: 'T&T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Print tag' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/print-oneoff')).toBe(true));
    expect(s.calls.find((c) => c.path === '/print-oneoff').body).toEqual({ firstName: 'Zed', clubName: 'T&T' });
    fireEvent.change(screen.getByLabelText('Label text'), { target: { value: 'KITCHEN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Print custom label' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/print-custom')).toBe(true));
    expect(s.calls.find((c) => c.path === '/print-custom').body).toEqual({ text: 'KITCHEN' });
  });

  it('reprints a stretch in two steps: the server counts first, and only a confirm prints', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.change(await screen.findByLabelText('From (time)'), { target: { value: '6:30' } });
    fireEvent.change(screen.getByLabelText('To (time)'), { target: { value: '6:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reprint this stretch' }));
    expect(await screen.findByText('2 labels will reprint')).toBeTruthy();
    const dry = s.calls.filter((c) => c.path === '/reprint-range');
    expect(dry).toHaveLength(1);
    expect(dry[0].body.confirm).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Print 2 labels' }));
    expect(await screen.findByText('Reprinted 2 labels.')).toBeTruthy();
    expect(s.calls.filter((c) => c.path === '/reprint-range')[1].body.confirm).toBe(true);
  });

  it('refuses a stretch with no times, without calling the printer', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reprint this stretch' }));
    expect(await screen.findByText('Enter both a start and an end time, like 6:30.')).toBeTruthy();
    expect(s.calls.some((c) => c.path === '/reprint-range')).toBe(false);
  });

  it('shows the attendance audit and applies the missing dates only after a confirm', async () => {
    savePublishToken('tok');
    const audit = {
      known: true, matches: false, ageMs: 86400000, scopeDates: 5, totals: { missing: 2, ledgerOnly: 0 },
      rows: [{ key: 'id:1', name: 'Maya R', club: 'Sparks', missingHere: ['2026-10-07'], ledgerOnly: [] }],
    };
    const s = server({ audit });
    vi.stubGlobal('fetch', s.fn);
    const ask = vi.fn(() => true);
    vi.stubGlobal('confirm', ask);
    window.confirm = ask;
    render(<LaptopSection />);
    expect(await screen.findByText(/2 night\(s\) TwoTimTwo has/)).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Nights that differ' })).getByText('Maya R')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 missing date(s)' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/attendance-audit/apply')).toBe(true));
    expect(ask).toHaveBeenCalled();
    expect(s.calls.find((c) => c.path === '/attendance-audit/apply').body).toEqual({ confirm: true });
    expect(await screen.findByText(/Added 2 date\(s\)/)).toBeTruthy();
  });

  it('says so plainly when the audit has no grid yet, and offers nothing to apply', async () => {
    savePublishToken('tok');
    vi.stubGlobal('fetch', server().fn);
    render(<LaptopSection />);
    expect(await screen.findByText(/no attendance grid has been read yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply missing dates' }).disabled).toBe(true);
  });

  it('arms rehearsal mode only after a confirm, and turns it off without one', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    window.confirm = ask;
    render(<LaptopSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rehearsal mode' }));
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(s.calls.some((c) => c.path === '/rehearsal')).toBe(false);
    ask.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rehearsal mode' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/rehearsal')).toBe(true));
    expect(s.calls.find((c) => c.path === '/rehearsal').body).toEqual({ on: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn rehearsal mode off' }));
    await waitFor(() => expect(s.calls.filter((c) => c.path === '/rehearsal')).toHaveLength(2));
    expect(s.calls.filter((c) => c.path === '/rehearsal')[1].body).toEqual({ on: false });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('saves the three switches that moved here, one key each', async () => {
    savePublishToken('tok');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Musical printer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Update health beacon/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow driven check-ins/ }));
    await waitFor(() => expect(s.calls.filter((c) => c.path === '/config' && c.method === 'POST')).toHaveLength(3));
    expect(s.calls.filter((c) => c.path === '/config' && c.method === 'POST').map((c) => c.body)).toEqual([
      { musicalPrinter: true }, { updateBeacon: true }, { enableDrivenCheckin: false },
    ]);
  });

  it('lists tonight\'s print failures when the server counts some', async () => {
    savePublishToken('tok');
    vi.stubGlobal('fetch', server({ health: { ...HEALTH, printFailures: 1 } }).fn);
    render(<LaptopSection />);
    const list = await screen.findByRole('list', { name: 'Print failures tonight' });
    expect(within(list).getByText(/Printer offline/)).toBeTruthy();
  });

  it('signs the laptop back in to the sync service with the passphrase, and says nothing of keys', async () => {
    savePublishToken('tok');
    const s = server({ health: { ...HEALTH, sync: { signedIn: false, state: 'signed-out', error: 'The passphrase was changed on another screen.' } } });
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    expect(await screen.findByText('This laptop was signed out of the sync service.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign this laptop in' }));
    expect(await screen.findByText('Type the church passphrase first.')).toBeTruthy();
    expect(s.calls.some((c) => c.path === '/config/sync-login')).toBe(false);
    fireEvent.change(screen.getByLabelText('Church passphrase'), { target: { value: 'kennebec' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign this laptop in' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/config/sync-login')).toBe(true));
    // Only the passphrase goes: the page never names the sync service's address.
    expect(s.calls.find((c) => c.path === '/config/sync-login').body).toEqual({ passphrase: 'kennebec' });
    // It looks again, so the card shows what the laptop now says.
    await waitFor(() => expect(s.calls.filter((c) => c.path === '/health')).toHaveLength(2));
  });

  it('when the laptop is signed in it asks for no passphrase', async () => {
    savePublishToken('tok');
    vi.stubGlobal('fetch', server().fn);
    render(<LaptopSection />);
    expect(await screen.findByText('This laptop is signed in to the sync service.')).toBeTruthy();
    expect(screen.queryByLabelText('Church passphrase')).toBeNull();
  });
});
