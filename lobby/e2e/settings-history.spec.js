import { expect, test } from '@playwright/test';
import { createHistoryKey, newRowId, sealRow } from '../shared/cloud-crypto.js';

// The settings page's History section (ROADMAP.md#online-check-in, P6), against a
// stand-in sync Worker holding a real sealed history: the trends are drawn from
// plaintext counts, a night's names are opened IN THE BROWSER with the
// passphrase, and a wrong passphrase opens nothing. Earlier seasons from
// TwoTimTwo (the trends back-fill) are named at the top of the trends, and an
// imported night is left out of the check-out chart (it has no check-outs).

const IMPORT_STATUS = {
  state: 'done',
  seasons: [{ season: '2026-27', nights: 6, importedAt: new Date().toISOString() }, { season: '2019-20', nights: 31, importedAt: new Date().toISOString() }],
  oldestSeason: '2019-20', lastRunAt: null, nextDueAt: null, lastError: null, unreadableWhy: null, skipped: [], ended: 'empty', currentSeasonLastAt: null,
  crosscheck: { compared: 1, matching: 1, differing: 0, deskHigher: 0, examples: [], at: new Date().toISOString() },
};

const SYNC = 'https://sync.test';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const PASS = 'kennebec river';
const NIGHT = '2026-10-14';

test('trends, a night opened with the passphrase, and the CSV', async ({ page }) => {
  const key = await createHistoryKey(PASS);
  const rows = [];
  for (const [first, ts] of [['Maya', Date.parse('2026-10-14T22:31:00Z')], ['Noah', Date.parse('2026-10-14T22:40:00Z')]]) {
    const id = newRowId();
    rows.push({ id, night: NIGHT, kind: 'checkin', v: 1, ...(await sealRow(key.pub, { id, night: NIGHT, kind: 'checkin', record: { first, last: 'Tester', club: 'Sparks', ts } })) });
  }
  const sent = [];
  await page.addInitScript((s) => localStorage.setItem('awanaSyncSession.v1', s), SESSION);
  await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
  await page.route('**/shared/sync.json', (route) => route.fulfill({ json: { url: SYNC } }));
  await page.routeWebSocket(/sync\.test/, () => {});
  await page.route(`${SYNC}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    sent.push(req.postData() || '');
    if (path === '/v1/state') return route.fulfill({ json: { settings: null, slides: null, template: null, journey: null, calendar: null, kid: 'abcd1234' } });
    if (path === '/v1/screens') return route.fulfill({ json: { screens: [], max: 40 } });
    if (path === '/v1/history/nights') return route.fulfill({ json: [{ night: NIGHT, rows: 2, kinds: { checkin: 2 } }] });
    if (path === '/v1/history/summary') {
      return route.fulfill({ json: [
        { night: '2019-10-02', club: 'Sparks', checkedIn: 21, checkedOut: 0, undone: 0, prints: 0, imported: true },
        { night: NIGHT, club: 'Sparks', checkedIn: 2, checkedOut: 1, undone: 0, prints: 2 },
      ] });
    }
    if (path === '/v1/history/import-status') return route.fulfill({ json: IMPORT_STATUS });
    if (path === '/v1/history/key') return route.fulfill({ json: { pub: key.pub, kid: key.kid, wrapped: key.wrapped, prev: null } });
    if (path === '/v1/history/rows') return route.fulfill({ json: { rows, next: null } });
    return route.fulfill({ status: 404, json: { error: 'Not found.' } });
  });

  await page.goto('/settings.html?lowPower=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'History' }).click();
  await expect(dialog.getByRole('img', { name: /Attendance by club/ })).toBeVisible();
  await expect(dialog.getByRole('img', { name: /Checked out/ })).toBeVisible();
  await expect(dialog.getByText('Earlier seasons from TwoTimTwo: back to 2019-20 (2 seasons), last updated just now.')).toBeVisible();
  await expect(dialog.getByText('Checked against the check-in desk on 1 night: it agrees.')).toBeVisible();
  await expect(dialog.getByText(/Visitors and check-outs leave out the night from TwoTimTwo/)).toBeVisible();
  await expect(dialog.getByRole('img', { name: /Checked out/ }).locator('rect')).toHaveCount(1);
  await expect(dialog.getByRole('img', { name: /Attendance by club/ }).locator('circle[data-from="twotimtwo"]')).toHaveCount(1);

  await dialog.getByRole('button', { name: /2 entries/ }).click();
  await dialog.getByLabel('Passphrase').fill('wrong word');
  await dialog.getByRole('button', { name: 'Open the names' }).click();
  await expect(dialog.getByText('That is not the passphrase for the history.')).toBeVisible();
  await dialog.getByLabel('Passphrase').fill(PASS);
  await dialog.getByRole('button', { name: 'Open the names' }).click();
  await expect(dialog.getByText('Maya Tester')).toBeVisible();

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toBe(`awana-${NIGHT}.csv`);
  expect(sent.join('')).not.toContain(PASS);
});
