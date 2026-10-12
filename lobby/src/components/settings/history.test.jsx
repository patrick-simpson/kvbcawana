import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createHistoryKey, newRowId, sealRow } from '../../../shared/cloud-crypto.js';
import { lockHistory } from '../../lib/historyCrypto.js';
import { saveSyncSession } from '../../lib/syncService.js';
import HistorySection from './history.jsx';

configure({ asyncUtilTimeout: 8000 });

vi.mock('../../hooks/useSync.js', () => ({ useSync: () => ({ signedIn: true, url: 'https://sync.test' }) }));

const SESSION = 'v1.1.1700000000000.settingspagesettingspagesettings';
const PASS = 'kennebec river';
const NIGHT = '2026-10-14';
let key;
let rows;

beforeAll(async () => {
  key = await createHistoryKey(PASS);
  rows = [];
  for (const [first, ts] of [['Maya', Date.parse('2026-10-14T22:31:00Z')], ['Noah', Date.parse('2026-10-14T22:40:00Z')]]) {
    const id = newRowId();
    rows.push({ id, night: NIGHT, kind: 'checkin', v: 1, ...(await sealRow(key.pub, { id, night: NIGHT, kind: 'checkin', record: { first, last: 'Tester', club: 'Sparks', ts } })) });
  }
}, 60000);

afterEach(() => { cleanup(); lockHistory(); vi.unstubAllGlobals(); });

function stub({ nights, summary }) {
  const sent = [];
  const fn = vi.fn(async (url, init = {}) => {
    const u = new URL(url);
    sent.push({ path: u.pathname, body: init.body });
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.pathname === '/v1/history/nights') return nights ? json(nights) : json({ reason: 'history-off', error: 'off' }, 503);
    if (u.pathname === '/v1/history/summary') return json(summary || []);
    if (u.pathname === '/v1/history/key') return json({ pub: key.pub, kid: key.kid, wrapped: key.wrapped, prev: null });
    if (u.pathname === '/v1/history/rows') return json({ rows, next: null });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fn);
  saveSyncSession(SESSION);
  return sent;
}

const N = (night, rowsN, visitor = 0) => ({ night, rows: rowsN, kinds: { checkin: rowsN - visitor, ...(visitor ? { visitor } : {}) } });
const S = (night, club, checkedIn, checkedOut) => ({ night, club, checkedIn, checkedOut, undone: 0, prints: 0 });

describe('the History section', () => {
  it('draws the trends as labelled charts with the numbers one click away', async () => {
    stub({
      nights: [N('2026-10-14', 2, 1), N('2026-10-07', 1)],
      summary: [S('2026-10-07', 'Sparks', 10, 9), S('2026-10-14', 'Sparks', 12, 6), S('2026-10-14', 'T&T', 7, 7)],
    });
    render(<HistorySection />);
    const chart = await screen.findByRole('img', { name: /Attendance by club/ });
    expect(chart.querySelectorAll('polyline')).toHaveLength(2);
    expect(screen.getByRole('img', { name: /Visitors/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Checked out/ })).toBeTruthy();
    expect(screen.getAllByRole('listitem').some((li) => li.textContent === 'Sparks')).toBe(true);   // legend, not colour alone
    expect(screen.getAllByText('Show the numbers').length).toBe(3);
    expect(screen.getByRole('combobox', { name: 'Season' })).toBeTruthy();
    expect(screen.getAllByText('2026-27').length).toBeGreaterThan(1);
  });

  it('says plainly when history storage is not set up yet', async () => {
    stub({ nights: null });
    render(<HistorySection />);
    expect(await screen.findByText('History storage is not set up yet.')).toBeTruthy();
  });

  it('opens a night with the passphrase, shows names decrypted here, and exports a CSV', async () => {
    const sent = stub({ nights: [N(NIGHT, 2)], summary: [S(NIGHT, 'Sparks', 2, 0)] });
    render(<HistorySection />);
    fireEvent.click(await screen.findByRole('button', { name: /entries/ }));
    // wrong passphrase first
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'wrong word' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the names' }));
    expect(await screen.findByText('That is not the passphrase for the history.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: PASS } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the names' }));
    const table = await screen.findByRole('table', { name: /entries/ });
    expect(within(table).getByText('Maya Tester')).toBeTruthy();
    expect(within(table).getByText('Noah Tester')).toBeTruthy();
    expect(JSON.stringify(sent)).not.toContain(PASS);

    const urls = [];
    URL.createObjectURL = vi.fn((blob) => { urls.push(blob); return 'blob:x'; });
    URL.revokeObjectURL = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(urls).toHaveLength(1);
    const text = await urls[0].text();
    expect(text).toContain('Maya Tester');
    expect(text.split('\r\n')[0]).toBe('Night,Time,What,Name,Club,Friend');

    fireEvent.click(screen.getByRole('button', { name: 'Lock the names' }));
    await waitFor(() => expect(screen.queryByRole('table', { name: /entries/ })).toBeNull());
    expect(screen.getByLabelText('Passphrase')).toBeTruthy();
  });
});
