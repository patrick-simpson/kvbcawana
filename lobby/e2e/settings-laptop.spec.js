import { expect, test } from '@playwright/test';
import { installWorker, makeWorld } from './settingsStub.js';

// Printing → At the laptop (docs/SETTINGS-OVERHAUL.md 2.5) and History → Import
// laptop history (2.6): the print service on http://localhost:3456 is reached
// only when the card is opened or the button pressed, and only proven by this
// page's own sign-in (no publish token anywhere). The service is stubbed with
// page.route, once absent and once present.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-private-network': 'true',
};
const reply = (body, status = 200) => ({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function stubLaptop(page, { saved, sync = { signedIn: true, state: 'ok' }, checks = [] }) {
  page.local = [];
  await page.route('http://localhost:3456/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    page.local.push({ path, method: req.method(), auth: req.headers().authorization });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (path === '/health') {
      return route.fulfill(reply({ status: 'ok', printer: 'Dock', version: '9.3.0', warnings: [], sync, lobbySlides: { tokenConfigured: true } }));
    }
    if (!/^Sync v1\./.test(req.headers().authorization || '')) return route.fulfill(reply({ error: 'Sign in to the settings page with the church passphrase first.' }, 403));
    if (path === '/config' && req.method() === 'POST') { saved.push(req.postDataJSON()); return route.fulfill(reply({ ok: true })); }
    if (path === '/config') return route.fulfill(reply({ printerName: 'Dock', backupPrinterName: '', pickupClubs: ['Sparks'], lateGraceMin: 10 }));
    if (path === '/printers') return route.fulfill(reply({ printers: [{ name: 'Dock' }, { name: 'Spare' }] }));
    if (path === '/clubs') return route.fulfill(reply({ clubs: ['Puggles', 'Sparks'] }));
    if (path === '/leaders') return route.fulfill(reply({ leaders: [{ key: 'ann lee', firstName: 'Ann', lastName: 'Lee', clubName: 'Sparks' }], hidden: 0, clubs: [] }));
    if (path === '/cloud/print-status' && req.method() === 'GET') return route.fulfill(reply({ station: true, jobs: { checkThePrinter: checks } }));
    if (path === '/cloud/print-status/clear') { checks.length = 0; return route.fulfill(reply({ station: true, jobs: { checkThePrinter: [] } })); }
    if (path === '/cloud/import-history') return route.fulfill(reply({ ok: true, rows: 120, stored: 118, duplicates: 2 }));
    return route.fulfill(reply({ error: 'not stubbed' }, 404));
  });
}

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
  page.w = makeWorld();
  await installWorker(page, page.w);
});

const openAtLaptop = async (page) => {
  await page.goto('/settings.html?lowPower=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Printing' }).click();
  await dialog.getByTestId('at-the-laptop').locator('summary').click();
  return dialog;
};

test('with no print service it says to open the page on the check-in laptop', async ({ page }) => {
  page.local = [];
  await page.route('http://localhost:3456/**', (route) => { page.local.push(route.request().url()); return route.abort(); });
  const dialog = await openAtLaptop(page);
  await expect(dialog.getByText('Open this page on the check-in laptop for the printer itself.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Look again' })).toBeVisible();
  await expect(dialog.getByLabel('Name tag printer')).toHaveCount(0);
});

test('on the laptop: the printer, its pick saved with the page\'s sign-in, never a token', async ({ page }) => {
  const saved = [];
  await stubLaptop(page, { saved });
  const dialog = await openAtLaptop(page);
  await expect(dialog.getByText('Everything looks right')).toBeVisible();
  const printer = dialog.getByLabel('Name tag printer');
  await expect(printer).toHaveValue('Dock');
  await printer.selectOption('Spare');
  await expect(dialog.getByText('Saved. The next label prints there.')).toBeVisible();
  expect(saved).toEqual([{ printerName: 'Spare' }]);
  for (const c of page.local.filter((x) => x.path !== '/health' && x.method !== 'OPTIONS')) expect(c.auth, c.path).toMatch(/^Sync v1\./);
  // what needs the laptop is here; what works anywhere is not
  await expect(dialog.getByRole('button', { name: 'Rehearsal mode' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Print a test label' })).toBeVisible();
  await expect(dialog.getByText('Attendance audit')).toBeVisible();
  await expect(dialog.getByText('Remembered leaders')).toBeVisible();
  await expect(dialog.getByLabel('From (time)')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Musical printer/ })).toBeVisible();
  await expect(dialog.getByText(/publish token/i)).toHaveCount(0);
  await expect(dialog.getByText('This laptop’s sign-in')).toHaveCount(0);
});

test('CHECK THE PRINTER is cleared at the laptop only', async ({ page }) => {
  await stubLaptop(page, { saved: [], checks: ['job1', 'job2'] });
  const dialog = await openAtLaptop(page);
  await expect(dialog.getByText(/CHECK THE PRINTER: 2 labels/).last()).toBeVisible();
  await dialog.getByRole('button', { name: 'I looked at it' }).last().click();
  await expect(dialog.getByText('Cleared. Thank you for looking.').last()).toBeVisible();
  expect(page.local.some((c) => c.path === '/cloud/print-status/clear' && c.method === 'POST')).toBe(true);
});

test('the laptop\'s own sign-in card shows only when the laptop is signed out', async ({ page }) => {
  await stubLaptop(page, { saved: [], sync: { signedIn: false, state: 'signed-out' } });
  const dialog = await openAtLaptop(page);
  await expect(dialog.getByText('This laptop’s sign-in')).toBeVisible();
  await expect(dialog.getByText('This laptop was signed out of the church’s sign-in.')).toBeVisible();
});

test('History → Import laptop history: found, it asks and imports; elsewhere it says to open on the laptop', async ({ page }) => {
  await page.goto('/settings.html?lowPower=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'History' }).click();
  await expect(dialog.getByRole('heading', { name: 'Import laptop history' })).toBeVisible();
  // not at the laptop
  page.local = [];
  await page.route('http://localhost:3456/**', (route) => { page.local.push(route.request().url()); return route.abort(); });
  expect(page.local).toEqual([]);
  await dialog.getByRole('button', { name: 'Import laptop history' }).click();
  await expect(dialog.getByText('Open this page on the check-in laptop to import its history.')).toBeVisible();
  // at the laptop
  await page.unroute('http://localhost:3456/**');
  await stubLaptop(page, { saved: [] });
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Import laptop history' }).click();
  await expect(dialog.getByText('Imported: 120 entries read, 118 new, 2 already there.')).toBeVisible();
  expect(page.local.some((c) => c.path === '/cloud/import-history' && c.method === 'POST' && /^Sync v1\./.test(c.auth))).toBe(true);
});

test('Printing is not on a screen\'s own Settings', async ({ page }) => {
  await page.goto('/?lowPower=1&configure=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.locator('.settings-nav__label')).toHaveText(['Tonight', 'What screens show', 'Slides & look', 'Account & app']);
  await expect(dialog.getByRole('tab', { name: 'Printing' })).toHaveCount(0);
  await expect(dialog.getByRole('tab', { name: 'History' })).toHaveCount(0);
});
