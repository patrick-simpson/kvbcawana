import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The Printing section's church cards (docs/SETTINGS-OVERHAUL.md 2.5) against
// a scripted Worker: they save against the revision shown, a stale 409 keeps
// what was typed, the unseeded and paused states are read-only, and the
// name-tag tools seal a job in the browser instead of calling localhost.

const calls = vi.hoisted(() => []);
const world = vi.hoisted(() => ({ church: null, answer: null, job: vi.fn(async () => ({ ok: true, jobId: 'reprint:x', existing: false, history: 'none' })) }));
vi.mock('../../hooks/useSync.js', () => ({
  useSync: () => ({ url: 'https://w.test', signedIn: true, phase: 'ok', lastSyncAt: 1, template: null, kid: 'k' }),
  syncAuthed: async (path, opts = {}) => { calls.push({ path, method: opts.method || 'GET', body: opts.body }); return world.answer(path, opts); },
  loadFriendsReport: vi.fn(async () => ({ ok: false, text: 'no' })),
  printBarfBags: vi.fn(async () => ({ ok: true, text: 'ok' })),
}));
vi.mock('../../lib/toolJobs.js', async (orig) => ({ ...(await orig()), sendToolJob: world.job }));

const { PrintingSection } = await import('./sections/PrintingSection.jsx');
const { _resetChurchForTest } = await import('../../hooks/useChurch.js');
const { SettingsPageContext } = await import('./fields.jsx');

const doc = (over = {}) => ({
  rev: 4, savedAt: '2026-10-14T20:00:00Z', by: null, seeded: true, paused: false, switches: {}, switchesRev: 1,
  settings: { labelFooter: 'KVBC', lateGraceMin: 10, pickupClubs: ['Sparks'], schedule: [{ club: 'Sparks', startTime: '6:30', location: 'Games', room: 'Hall' }], barfNights: ['2026-10-28'] },
  ...over,
});
const serve = (state) => (path, opts) => {
  if (path === '/v1/church/settings' && (opts.method || 'GET') === 'GET') return { ok: true, status: 200, body: state.church };
  if (path === '/v1/church/settings') return state.put(opts.body);
  return { ok: false, status: 404, body: null };
};

function mount() {
  return render(<SettingsPageContext.Provider value><PrintingSection /></SettingsPageContext.Provider>);
}
const state = { church: null, put: null };

beforeEach(() => {
  calls.length = 0;
  _resetChurchForTest();
  state.church = doc();
  state.put = (body) => {
    const next = { ...state.church.settings };
    for (const [k, v] of Object.entries(body.settings)) { if (v === null) delete next[k]; else next[k] = v; }
    state.church = { ...state.church, rev: state.church.rev + 1, settings: next };
    return { ok: true, status: 200, body: { ok: true, rev: state.church.rev, settings: next, savedAt: 'now' } };
  };
  world.answer = serve(state);
  world.job.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const puts = () => calls.filter((c) => c.method === 'PUT');

describe('Printing: the church cards', () => {
  it('shows the document and saves a toggle at once, against the revision shown, one key', async () => {
    mount();
    const box = await screen.findByRole('checkbox', { name: 'Band the next label of a child who finished a handbook' });
    expect(box.checked).toBe(true);   // the laptop's default when the document lacks the key
    fireEvent.click(box);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ baseRev: 4, settings: { trophyBand: false } });
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('the footer saves when you leave the field, and only if it changed', async () => {
    mount();
    const footer = await screen.findByRole('textbox', { name: 'Label footer' });
    expect(footer.value).toBe('KVBC');
    fireEvent.blur(footer);
    expect(puts()).toHaveLength(0);
    fireEvent.change(footer, { target: { value: '  Wednesdays 6:15  ' } });
    fireEvent.blur(footer);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body.settings).toEqual({ labelFooter: 'Wednesdays 6:15' });
  });

  it('a stale 409 puts the newer document in and keeps what was typed, to check and save again', async () => {
    state.put = () => {
      state.church = { ...state.church, rev: 5, settings: { ...state.church.settings, labelFooter: 'Changed elsewhere', lateGraceMin: 20 } };
      return { ok: false, status: 409, body: { reason: 'stale', rev: 5, settings: state.church.settings } };
    };
    mount();
    fireEvent.change(await screen.findByLabelText('Late grace (minutes)'), { target: { value: '15' } });
    const footer = screen.getByRole('textbox', { name: 'Label footer' });
    fireEvent.change(footer, { target: { value: 'Mine' } });
    fireEvent.blur(footer);
    expect(await screen.findByText('Someone else changed this a moment ago; check and save again.')).toBeTruthy();
    // what the person typed is still there; the card now knows the new revision
    expect(screen.getByRole('textbox', { name: 'Label footer' }).value).toBe('Mine');
    expect(screen.getByLabelText('Late grace (minutes)').value).toBe('15');
    state.put = (body) => ({ ok: true, status: 200, body: { ok: true, rev: 6, settings: { ...state.church.settings, ...body.settings }, savedAt: 'x' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'Label footer' }));
    await waitFor(() => expect(puts().at(-1).body.baseRev).toBe(5));
  });

  it('saves the schedule rows and the late grace together, and refuses a bad time', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Row 1 starts'), { target: { value: 'soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(await screen.findByText('A start time reads like 6:30.')).toBeTruthy();
    expect(puts()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Row 1 starts'), { target: { value: '6:45' } });
    fireEvent.change(screen.getByLabelText('Late grace (minutes)'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body.settings).toEqual({ schedule: [{ club: 'Sparks', startTime: '6:45', location: 'Games', room: 'Hall' }], lateGraceMin: 15 });
  });

  it('pickup clubs and BARF nights', async () => {
    mount();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Cubbies' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body.settings.pickupClubs).toEqual(['Cubbies', 'Sparks']);
    fireEvent.change(screen.getByLabelText('Add a night'), { target: { value: '2026-10-21' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].body.settings.barfNights).toEqual(['2026-10-21', '2026-10-28']);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove 2026-10-28' }));
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect(puts()[2].body.settings.barfNights).toEqual(['2026-10-21']);
  });

  it('each club\'s label saves the whole layouts object, with a version, and Reset drops the club', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Club'), { target: { value: 'spark' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Last name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save label layouts' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body.settings.labelTemplates).toEqual({ spark: { version: 1, showLastName: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset this club' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save label layouts' }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].body.settings.labelTemplates).toBeNull();
  });

  it('before the seed everything is read-only, with one button that starts from defaults after a confirm', async () => {
    state.church = doc({ rev: 0, settings: null });
    state.put = (body) => {
      state.church = doc({ rev: 1, settings: { lateGraceMin: 10 } });
      return { ok: true, status: 201, body: { ok: true, rev: 1, settings: { lateGraceMin: 10 }, savedAt: 'x' }, got: body };
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    expect(await screen.findByText(/Waiting for the check-in laptop to send its settings \(KVBC Awana 9\.3\.0\)/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Label footer' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save schedule' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start from defaults instead' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toMatchObject({ baseRev: 0, fromDefaults: true });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Label footer' }).disabled).toBe(false));
  });

  it('paused (CHURCH_SETTINGS off) is read-only with the laptop pointer', async () => {
    state.church = doc({ paused: true });
    mount();
    expect(await screen.findByText(/Paused: change these at the laptop/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Label footer' }).disabled).toBe(true);
  });

  it('has At the laptop collapsed, and does not touch localhost until it is opened', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchSpy);
    mount();
    const details = await screen.findByTestId('at-the-laptop');
    expect(details.open).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('Printing: name tags from anywhere', () => {
  it('a leader tag, a one-off tag and a custom label go out as sealed jobs, after a confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    fireEvent.change(await screen.findByLabelText('Leader’s name'), { target: { value: 'Bo Kim' } });
    fireEvent.change(screen.getByLabelText('Leader’s club'), { target: { value: 'Sparks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Print leader tag' }));
    await waitFor(() => expect(world.job).toHaveBeenCalledTimes(1));
    expect(world.job.mock.calls[0][0]).toMatchObject({ route: '/print-leader', body: { name: 'Bo Kim', clubName: 'Sparks' }, source: 'settings' });
    expect(await screen.findByText('Sent Bo Kim’s tag to the printer.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Print tag' }));
    expect(await screen.findByText('Type the child’s first name first.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Child’s first name'), { target: { value: 'Zed' } });
    fireEvent.change(screen.getByLabelText('Child’s club'), { target: { value: 'T&T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Print tag' }));
    await waitFor(() => expect(world.job).toHaveBeenCalledTimes(2));
    expect(world.job.mock.calls[1][0]).toMatchObject({ route: '/print-oneoff', body: { firstName: 'Zed', clubName: 'T&T' } });

    fireEvent.change(screen.getByLabelText('Label text'), { target: { value: 'KITCHEN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Print custom label' }));
    await waitFor(() => expect(world.job).toHaveBeenCalledTimes(3));
    expect(world.job.mock.calls[2][0]).toMatchObject({ route: '/print-custom', body: { text: 'KITCHEN' } });
    // nothing was sent to a localhost print server
    expect(calls.some((c) => /localhost/.test(c.path))).toBe(false);
  });

  it('a "no" at the confirm prints nothing; a refusal from the service is shown', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount();
    fireEvent.change(await screen.findByLabelText('Label text'), { target: { value: 'KITCHEN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Print custom label' }));
    expect(world.job).not.toHaveBeenCalled();
    ask.mockReturnValue(true);
    world.job.mockResolvedValueOnce({ ok: false, reason: 'no-station', message: 'No printing computer is registered, so there is nowhere to print.' });
    fireEvent.click(screen.getByRole('button', { name: 'Print custom label' }));
    expect(await screen.findByText(/No printing computer is registered/)).toBeTruthy();
  });
});
