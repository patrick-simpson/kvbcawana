import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { reduceMission, initialMission } from '../../lib/missionControl.js';

// Tonight's cards against a scripted Worker (routes.md section 10): the
// switches with their confirm and warnings, the notice composer, the change
// log with Undo, and mission control's privacy.

const calls = vi.hoisted(() => []);
const world = vi.hoisted(() => ({ answer: () => ({ ok: false, status: 404, body: null }) }));
vi.mock('../../hooks/useSync.js', () => ({
  useSync: () => ({ url: 'https://w.test', signedIn: true, phase: 'ok', lastSyncAt: 1, template: null, kid: 'k' }),
  syncAuthed: async (path, opts = {}) => { calls.push({ path, method: opts.method || 'GET', body: opts.body }); return world.answer(path, opts); },
  testCloudCheckin: vi.fn(async () => ({ ok: true, text: 'ok' })),
}));

const { default: SwitchesCard } = await import('./SwitchesCard.jsx');
const { default: NoticeCard, EMPTY_NOTICE } = await import('./NoticeCard.jsx');
const { ChangeLogCard, RecentChangesCard } = await import('./ChangeLogCard.jsx');
const { default: MissionControl } = await import('./MissionControl.jsx');

const ok = (body) => ({ ok: true, status: 200, body });
const bad = (status, body = null) => ({ ok: false, status, body });

beforeEach(() => { calls.length = 0; world.answer = () => bad(404); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const SWITCHES = (over = {}) => ok({
  rev: 3, updatedAt: new Date(Date.now() - 120000).toISOString(), by: { name: 'Chrome on Android' }, stored: true,
  stations: [{ stationId: 's', name: 'Laptop', lastSeenAt: new Date().toISOString(), version: '9.2.1' }],
  switches: [
    { name: 'CLOUD_PRINT', value: 'off', default: 'off', source: 'default' },
    { name: 'SINGLE_PUBLISHER', value: 'off', default: 'on', source: 'worker' },
    { name: 'YM_CHECKOUT', value: 'off', default: 'off', source: 'default' },
    { name: 'CHURCH_SETTINGS', value: 'on', default: 'on', source: 'default' },
    { name: 'NOTICES', value: 'on', default: 'on', source: 'default' },
    { name: 'CHANGE_LOG', value: 'on', default: 'on', source: 'default' },
  ],
  ...over,
});

describe('SwitchesCard', () => {
  it('shows the three online switches with their default and who changed them', async () => {
    world.answer = (p) => (p === '/v1/switches' ? SWITCHES() : bad(404));
    render(<SwitchesCard overview={{ window: { open: false } }} />);
    expect(await screen.findByRole('checkbox', { name: 'Print TwoTimTwo-page check-ins' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'The service runs the screens’ count and pickup list' }).checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Check out Trek and Journey automatically (7:15 pm)' })).toBeTruthy();
    const row = document.querySelector('[data-switch="SINGLE_PUBLISHER"]');
    expect(row.textContent).toMatch(/Default: on\./);
    expect(row.textContent).toMatch(/Changed by Chrome on Android/);
    expect(within(row).getByRole('button', { name: 'Back to default' })).toBeTruthy();
    expect(document.querySelector('[data-switch="CLOUD_PRINT"] button')).toBeNull();
    // the safety switches and the TwoTimTwo test live in the Advanced fold
    const adv = document.querySelector('details.advanced-fields');
    expect(within(adv).getByText('Printing settings from this page')).toBeTruthy();
    expect(within(adv).getByRole('button', { name: 'Test TwoTimTwo sign-in' })).toBeTruthy();
  });

  it('asks the Worker first (dryRun), names its warnings and older stations, then writes ONE switch against the revision shown', async () => {
    const old = [{ stationId: 's', name: 'Laptop', version: '9.2.1' }];
    world.answer = (p, o) => {
      if (p !== '/v1/switches') return bad(404);
      if (o.method !== 'PUT') return SWITCHES();
      if (o.body.dryRun) return ok({ ok: true, dryRun: true, rev: 3, warnings: ['station-old-sweep', 'window-open'], oldStations: old });
      return ok({ ok: true, rev: 4, warnings: ['station-old-sweep'], oldStations: old });
    };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SwitchesCard overview={{ window: { open: true } }} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Check out Trek and Journey automatically (7:15 pm)' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    const asked = confirm.mock.calls[0][0];
    expect(asked).toMatch(/Turn on: Check out Trek and Journey automatically/);
    expect(asked).toMatch(/The service warns/);
    expect(asked).toMatch(/so there would be two/);
    expect(asked).toMatch(/Check-in is open right now/);
    expect(asked).toMatch(/Laptop \(KVBC Awana 9\.2\.1\)/);
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    const [dry, real] = calls.filter((c) => c.method === 'PUT');
    expect(dry.body).toEqual({ name: 'YM_CHECKOUT', value: 'on', rev: 3, dryRun: true });
    expect(real.body).toEqual({ name: 'YM_CHECKOUT', value: 'on', rev: 3 });
    // the Worker's own warnings are shown after, with the stations they are about
    expect(await screen.findByText('Turned on.')).toBeTruthy();
    expect(screen.getByText(/so there would be two/)).toBeTruthy();
    expect(screen.getByText(/Older printing computers: Laptop/)).toBeTruthy();
  });

  it('falls back to its own guess when the dry run fails', async () => {
    world.answer = (p, o) => {
      if (p !== '/v1/switches') return bad(404);
      if (o.method !== 'PUT') return SWITCHES();
      return o.body.dryRun ? bad(500) : ok({ ok: true, rev: 4, warnings: [] });
    };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SwitchesCard overview={{ window: { open: true } }} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Check out Trek and Journey automatically (7:15 pm)' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toMatch(/The service may warn/);
    expect(confirm.mock.calls[0][0]).toMatch(/older KVBC Awana/);
  });

  it('a "no" changes nothing', async () => {
    world.answer = (p) => (p === '/v1/switches' ? SWITCHES() : bad(404));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const confirm = vi.mocked(window.confirm);
    render(<SwitchesCard />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Print TwoTimTwo-page check-ins' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    // only the dry run went out: it writes nothing
    expect(calls.filter((c) => c.method === 'PUT').every((c) => c.body.dryRun === true)).toBe(true);
  });

  it('Back to default sends value "default"', async () => {
    world.answer = (p, o) => (p === '/v1/switches' ? (o.method === 'PUT' ? ok({ ok: true, rev: 4, warnings: [] }) : SWITCHES()) : bad(404));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SwitchesCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to default' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && !c.body.dryRun)).toBeTruthy());
    expect(calls.find((c) => c.method === 'PUT' && !c.body.dryRun).body).toMatchObject({ name: 'SINGLE_PUBLISHER', value: 'default' });
  });

  it('a stale revision says so and reloads; a Worker without the route says it arrives later', async () => {
    world.answer = (p, o) => (p === '/v1/switches' ? (o.method === 'PUT' ? bad(409, { reason: 'stale', rev: 5 }) : SWITCHES()) : bad(404));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { unmount } = render(<SwitchesCard />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Print TwoTimTwo-page check-ins' }));
    expect(await screen.findByText(/Someone else changed a switch a moment ago/)).toBeTruthy();
    unmount();
    world.answer = () => bad(404);
    render(<SwitchesCard />);
    expect(await screen.findByText(/does not have this yet/)).toBeTruthy();
  });
});

describe('NoticeCard', () => {
  const Harness = ({ overviewNotice }) => {
    const [draft, setDraft] = useState(EMPTY_NOTICE);
    return <NoticeCard draft={draft} onDraft={setDraft} overviewNotice={overviewNotice} />;
  };

  it('composes level, message (counted) and how long, and sends it', async () => {
    world.answer = (p, o) => (p === '/v1/notice' ? (o.method === 'POST' ? ok({ ok: true, notice: { level: 'warn', message: 'Hi', at: 'x' }, until: new Date(Date.now() + 1800000).toISOString(), screens: 3 }) : ok({ notice: null })) : bad(404));
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText('How important'), { target: { value: 'warn' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Club ends early' } });
    expect(screen.getByText(/15 of 200/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('How long'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to every screen' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ level: 'warn', message: 'Club ends early', durationMin: 60 });
    expect(await screen.findByText('Sent to 3 screens.')).toBeTruthy();
    expect(screen.getByLabelText('Message').value).toBe('');
  });

  it('every duration is one the Worker allows (5..240 minutes), and the levels are its three', async () => {
    world.answer = (p) => (p === '/v1/notice' ? ok({ notice: null }) : bad(404));
    render(<Harness />);
    const dur = [...(await screen.findByLabelText('How long')).options].map((o) => Number(o.value));
    expect(dur).toEqual([15, 30, 60, 120, 240]);
    expect([...screen.getByLabelText('How important').options].map((o) => o.textContent)).toEqual(['Info', 'Heads up', 'Urgent']);
    expect(screen.getByLabelText('Message').maxLength).toBe(200);
  });

  it('an empty message is not sent; an Urgent one asks first', async () => {
    world.answer = (p, o) => (p === '/v1/notice' ? (o.method === 'POST' ? ok({ ok: true, notice: {}, screens: 1 }) : ok({ notice: null })) : bad(404));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Harness />);
    expect((await screen.findByRole('button', { name: 'Send to every screen' })).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('How important'), { target: { value: 'critical' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'CLUB CANCELLED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to every screen' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/URGENT/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the notice that is up, and Take it down deletes it', async () => {
    let up = { level: 'critical', message: 'CLUB CANCELLED', until: new Date(Date.now() + 3600000).toISOString() };
    world.answer = (p, o) => (p === '/v1/notice' ? (o.method === 'DELETE' ? (up = null, ok({ ok: true, cleared: true })) : ok({ notice: up })) : bad(404));
    render(<Harness />);
    expect(await screen.findByTestId('notice-current')).toBeTruthy();
    expect(screen.getByTestId('notice-current').textContent).toMatch(/Urgent.*CLUB CANCELLED/);
    fireEvent.click(screen.getByRole('button', { name: 'Take it down' }));
    await waitFor(() => expect(screen.queryByTestId('notice-current')).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(await screen.findByText('Taken down.')).toBeTruthy();
  });

  it('says so when notices are switched off', async () => {
    world.answer = (p, o) => (p === '/v1/notice' ? (o.method === 'POST' ? bad(503, { reason: 'notices-off' }) : ok({ notice: null })) : bad(404));
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to every screen' }));
    expect(await screen.findByText(/Notices are switched off/)).toBeTruthy();
  });

  it('follows the overview poll: a notice another device took down disappears here', async () => {
    const up = { level: 'info', message: 'Snacks', until: new Date(Date.now() + 3600000).toISOString() };
    world.answer = (p) => (p === '/v1/notice' ? ok({ notice: up }) : bad(404));
    const { rerender } = render(<Harness overviewNotice={undefined} />);
    expect(await screen.findByTestId('notice-current')).toBeTruthy();
    rerender(<Harness overviewNotice={null} />);
    await waitFor(() => expect(screen.queryByTestId('notice-current')).toBeNull());
  });
});

describe('the change log', () => {
  const entries = [
    { seq: 3, at: new Date().toISOString(), device: { name: 'Chrome on Android' }, what: 'shared', keys: ['standardDisplayMs'], undoable: true },
    { seq: 2, at: new Date().toISOString(), device: { name: 'Check-in laptop' }, what: 'church', keys: ['labelFooter'], undoable: false },
    { seq: 1, at: new Date().toISOString(), device: { name: 'Chrome on Windows' }, what: 'switch', target: 'CLOUD_PRINT', keys: ['CLOUD_PRINT'], undoable: true, undoneBy: 4 },
  ];
  const changes = (extra = {}) => (p, o) => {
    if (p.startsWith('/v1/changes') && !p.includes('undo')) return ok({ entries, next: null, head: 3, off: false, ...extra });
    if (p === '/v1/changes/3/undo') return o.result ?? ok({ ok: true, seq: 5 });
    return bad(404);
  };

  it('lists who changed what and offers Undo only where it can work', async () => {
    world.answer = changes();
    render(<ChangeLogCard />);
    expect(await screen.findByText(/Chrome on Android/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Undo:/ })).toHaveLength(1);
    expect(screen.getByText('undone')).toBeTruthy();
    expect(calls[0].path).toBe('/v1/changes?limit=50');
  });

  it('Undo calls the Worker and reloads; "changed since" is said in words', async () => {
    world.answer = changes();
    render(<ChangeLogCard />);
    fireEvent.click(await screen.findByRole('button', { name: /^Undo:/ }));
    await waitFor(() => expect(calls.some((c) => c.path === '/v1/changes/3/undo' && c.method === 'POST')).toBe(true));
    expect(await screen.findByText('Undone.')).toBeTruthy();
    cleanup();
    calls.length = 0;
    world.answer = (p, o) => (p === '/v1/changes/3/undo' ? bad(409, { reason: 'changed-since', keys: ['standardDisplayMs'] }) : changes()(p, o));
    render(<ChangeLogCard />);
    fireEvent.click(await screen.findByRole('button', { name: /^Undo:/ }));
    expect(await screen.findByText('Changed again since; nothing undone.')).toBeTruthy();
  });

  it('filters by kind and pages with Older', async () => {
    world.answer = (p) => (p.startsWith('/v1/changes') ? ok({ entries: p.includes('before=') ? [{ seq: 0, at: new Date().toISOString(), device: { name: 'Old phone' }, what: 'notice', keys: [], after: null }] : entries, next: p.includes('before=') ? null : 1, head: 3 }) : bad(404));
    render(<ChangeLogCard />);
    fireEvent.change(await screen.findByLabelText('Show'), { target: { value: 'switch' } });
    expect(screen.queryByText(/Chrome on Android/)).toBeNull();
    expect(screen.getByText(/Chrome on Windows/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(await screen.findByText(/Old phone/)).toBeTruthy();
    expect(calls.some((c) => c.path === '/v1/changes?before=1&limit=50')).toBe(true);
  });

  it('Tonight shows the last five with a way to the full log', async () => {
    world.answer = changes();
    const goTo = vi.fn();
    render(<RecentChangesCard goTo={goTo} />);
    expect(await screen.findByText(/Chrome on Android/)).toBeTruthy();
    expect(calls[0].path).toBe('/v1/changes?limit=5');
    fireEvent.click(screen.getByRole('button', { name: 'All changes' }));
    expect(goTo).toHaveBeenCalledWith('account');
  });
});

describe('MissionControl (privacy)', () => {
  const overview = {
    at: new Date().toISOString(), window: { open: true },
    count: { source: 'report', checkedIn: 42, byClub: { Sparks: 18, Cubbies: 14, Puggles: 10 }, reportAgeMs: 4000 },
    read: { configured: true, signedIn: true, lastOkAt: new Date().toISOString() },
    print: { stations: [{ stationId: 's', name: 'Check-in laptop', lastSeenAt: new Date().toISOString(), printer: { state: 'ok' } }], checkThePrinter: 2 },
    ym: { enabled: true, checkedOut: 4, pending: 1, failed: 0, gaveUp: 0 },
  };

  it('shows the count, the clubs, the stations and the check-in lines from the overview', () => {
    render(<MissionControl overview={overview} mission={initialMission()} error="" stopped={false} onRetry={() => {}} />);
    expect(screen.getByTestId('mission-total').textContent).toBe('42');
    expect(screen.getByRole('list', { name: 'Checked in by club' }).textContent).toMatch(/Sparks.*18/);
    expect(screen.getByText('Check-in laptop')).toBeTruthy();
    expect(screen.getByText('CHECK THE PRINTER')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I looked at it' })).toBeTruthy();
    expect(screen.getByText(/4 checked out, 1 pending/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the desk' }).getAttribute('href')).toBe('/desk');
  });

  it('draws the last first names, and only those fields', () => {
    let m = initialMission();
    m = reduceMission(m, { type: 'checkin', payload: { id: 'a', firstName: 'Maya', club: 'Sparks', at: 1000, lastName: 'Tester', allergies: 'nuts' } });
    m = reduceMission(m, { type: 'checkin', payload: { id: 'b', firstName: 'Noah', club: 'Cubbies', at: 2000, oneOff: true } });
    const { container } = render(<MissionControl overview={overview} mission={m} error="" stopped={false} onRetry={() => {}} />);
    const list = screen.getByTestId('mission-recent');
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('strong').textContent)).toEqual(['Noah', 'Maya']);
    expect(within(list).getByText('tag')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Tester|nuts/);
    expect(localStorage.length).toBe(0);
  });

  it('says the live numbers stopped, with Try again', () => {
    const retry = vi.fn();
    render(<MissionControl overview={null} mission={initialMission()} error="Could not reach the sync service." stopped onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
