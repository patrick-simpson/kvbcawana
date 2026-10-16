import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AtTheLaptop from './AtTheLaptop.jsx';

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
/** The page's sign-in is the only proof: no token anywhere. */
const signIn = () => localStorage.setItem('awanaSyncSession.v1', SESSION);

/** A stand-in print server: routes by method and path, remembers what it was sent. */
function server({ online = true, health = HEALTH } = {}) {
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
    if (auth !== `Sync ${SESSION}`) return res({ error: 'Sign in to the settings page with the church passphrase first.' }, 403);
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

// Printing → At the laptop, opened, with the church's printing settings paused so the
// laptop's own Labels and Night cards show (they are what this suite exercises).
const LaptopSection = () => <AtTheLaptop paused />;
/** Open the collapsed card, which only then looks for the printer. */
const openIt = () => fireEvent.click(screen.getByText('At the laptop'));

describe('At the laptop', () => {
  it('says to open the page on the laptop when nothing answers, and what it would show', async () => {
    const s = server({ online: false });
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    expect(await screen.findByText('Open this page on the check-in laptop for the printer itself.')).toBeTruthy();
    expect(screen.queryByLabelText('Name tag printer')).toBeNull();
    expect(s.calls.map((c) => c.path)).toEqual(['/health']);
  });

  it('looks again on request', async () => {
    const s = server({ online: false });
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Look again' }));
    await waitFor(() => expect(s.calls.filter((c) => c.path === '/health')).toHaveLength(2));
  });

  it('found without a sign-in: shows the status and says to sign in under Account & app, and calls nothing else', async () => {
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    expect(await screen.findByText('The printer is out of labels')).toBeTruthy();
    expect(screen.getByText('Connect to the printer')).toBeTruthy();
    expect(screen.getByText(/Sign in under Account & app/)).toBeTruthy();
    expect(screen.queryByLabelText('Name tag printer')).toBeNull();
    expect(screen.queryByText(/publish token/i)).toBeNull();
    expect(s.calls.map((c) => c.path)).toEqual(['/health']);
  });

  it('signed in with the passphrase: no token needed, the session is what is sent', async () => {
    localStorage.setItem('awanaSyncSession.v1', SESSION);
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    expect((await screen.findByLabelText('Name tag printer')).value).toBe('Dock');
    expect(s.calls.find((c) => c.path === '/config').headers.Authorization).toBe(`Sync ${SESSION}`);
  });

  it('a session the printer refuses says to sign in again, and offers no token', async () => {
    localStorage.setItem('awanaSyncSession.v1', 'v1.1.1700000000000.notthesessionnotthesessionnot');
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    expect(await screen.findByText(/Sign in to the settings page again/)).toBeTruthy();
    expect(screen.queryByText(/publish token/i)).toBeNull();
    expect(screen.queryByLabelText('Name tag printer')).toBeNull();
  });

  it('signed in: the printer, labels, pickup list, schedule and tonight', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    const tag = await screen.findByLabelText('Name tag printer');
    expect(tag.value).toBe('Dock');
    expect(screen.getByRole('textbox', { name: 'Label footer' }).value).toBe('KVBC');
    expect(screen.getByRole('checkbox', { name: 'Sparks' }).checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Cubbies' }).checked).toBe(false);
    expect(await screen.findByLabelText('Row 1 club')).toBeTruthy();
    // Every call after the probe carries the page's sign-in, never a token.
    for (const c of s.calls.filter((x) => x.path !== '/health')) expect(c.headers.Authorization).toBe(`Sync ${SESSION}`);
    // One Season control: the laptop's own copy is gone.
    expect(screen.queryByLabelText('Screen season')).toBeNull();
  });

  it('saves the printer pick with POST /config, and only that key', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    fireEvent.change(await screen.findByLabelText('Name tag printer'), { target: { value: 'Spare' } });
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.path === '/config')).toBe(true));
    const post = s.calls.find((c) => c.method === 'POST' && c.path === '/config');
    expect(post.body).toEqual({ printerName: 'Spare' });
    expect(await screen.findByText('Saved. The next label prints there.')).toBeTruthy();
  });

  it('saves pickup clubs as the ticked list', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Cubbies' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.body?.pickupClubs)).toBe(true));
    expect(s.calls.find((c) => c.body?.pickupClubs).body.pickupClubs).toEqual(['Cubbies', 'Sparks']);
  });

  it('saves the schedule with the late grace', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    fireEvent.change(await screen.findByLabelText('Row 1 starts'), { target: { value: '6:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(s.calls.some((c) => c.method === 'POST' && c.path === '/config/schedule')).toBe(true));
    expect(s.calls.find((c) => c.path === '/config/schedule' && c.method === 'POST').body)
      .toEqual({ schedule: [{ club: 'Sparks', startTime: '6:45', location: 'Games', room: 'Hall' }], lateGraceMin: 10 });
  });

  it('refuses a start time that is not a time, without calling the printer', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    fireEvent.change(await screen.findByLabelText('Row 1 starts'), { target: { value: 'soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(await screen.findByText('A start time reads like 6:30.')).toBeTruthy();
    expect(s.calls.some((c) => c.method === 'POST' && c.path === '/config/schedule')).toBe(false);
  });

  it('runs the diagnostics and lists each check as passed or failed', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Run diagnostics' }));
    const list = await screen.findByRole('list', { name: 'Diagnostics' });
    expect(within(list).getByText('Printer detected')).toBeTruthy();
    expect(within(list).getByText('failed')).toBeTruthy();
    expect(within(list).getByText('passed')).toBeTruthy();
  });

  it('has no dashboard, no PIN and no keys: the page is the only place', async () => {
    signIn();
    vi.stubGlobal('fetch', server().fn);
    render(<LaptopSection />);
    openIt();
    await screen.findByLabelText('Name tag printer');
    expect(screen.queryByText('PIN and keys')).toBeNull();
    expect(screen.queryByRole('link', { name: /print dashboard/i })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/localhost:3456\/#/);
    expect(screen.queryByLabelText(/PIN/i)).toBeNull();
    expect(screen.queryByText(/Wi-?Fi access/i)).toBeNull();
    expect(screen.queryByText(/display key/i)).toBeNull();
    expect(screen.queryByText(/publish token/i)).toBeNull();
  });

  it('lists the remembered leaders, and forgets one after a confirm', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    vi.stubGlobal('confirm', vi.fn(() => true));
    window.confirm = globalThis.confirm;
    render(<LaptopSection />);
    openIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Forget Ann Lee' }));
    await waitFor(() => expect(s.calls.some((c) => c.path === '/leaders/forget')).toBe(true));
    expect(s.calls.find((c) => c.path === '/leaders/forget').body).toEqual({ key: 'ann lee' });
  });

  it('reprints a stretch in two steps: the server counts first, and only a confirm prints', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
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
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Reprint this stretch' }));
    expect(await screen.findByText('Enter both a start and an end time, like 6:30.')).toBeTruthy();
    expect(s.calls.some((c) => c.path === '/reprint-range')).toBe(false);
  });

  it('arms rehearsal mode only after a confirm, and turns it off without one', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    window.confirm = ask;
    render(<LaptopSection />);
    openIt();
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

  it('saves the two switches that live here, one key each', async () => {
    signIn();
    const s = server();
    vi.stubGlobal('fetch', s.fn);
    render(<AtTheLaptop />);   // not paused: the church's printing settings own the rest
    openIt();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Musical printer/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Update health beacon/ }));
    await waitFor(() => expect(s.calls.filter((c) => c.path === '/config' && c.method === 'POST')).toHaveLength(2));
    expect(s.calls.filter((c) => c.path === '/config' && c.method === 'POST').map((c) => c.body)).toEqual([
      { musicalPrinter: true }, { updateBeacon: true },
    ]);
  });

  it('lists tonight\'s print failures when the server counts some', async () => {
    signIn();
    vi.stubGlobal('fetch', server({ health: { ...HEALTH, printFailures: 1 } }).fn);
    render(<LaptopSection />);
    openIt();
    const list = await screen.findByRole('list', { name: 'Print failures tonight' });
    expect(within(list).getByText(/Printer offline/)).toBeTruthy();
  });

  it('signs the laptop back in to the sync service with the passphrase, and says nothing of keys', async () => {
    signIn();
    const s = server({ health: { ...HEALTH, sync: { signedIn: false, state: 'signed-out', error: 'The passphrase was changed on another screen.' } } });
    vi.stubGlobal('fetch', s.fn);
    render(<LaptopSection />);
    openIt();
    expect(await screen.findByText('This laptop was signed out of the church’s sign-in.')).toBeTruthy();
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

  it('when the laptop is signed in the sign-in card is not shown at all, and nothing asks for a passphrase', async () => {
    signIn();
    vi.stubGlobal('fetch', server().fn);
    render(<LaptopSection />);
    openIt();
    await screen.findByLabelText('Name tag printer');
    expect(screen.queryByText('This laptop’s sign-in')).toBeNull();
    expect(screen.queryByLabelText('Church passphrase')).toBeNull();
  });
});
