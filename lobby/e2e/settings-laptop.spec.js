import { expect, test } from '@playwright/test';

// The settings page's Laptop section (SETTINGS.md phase 3): it looks for the
// print server on http://localhost:3456 when opened. The server is stubbed
// with page.route (a stand-in for the laptop), once absent and once present.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-private-network': 'true',
};
const reply = (body, status = 200) => ({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function stubLaptop(page, { saved }) {
  await page.route('http://localhost:3456/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (path === '/health') {
      return route.fulfill(reply({ status: 'ok', printer: 'Dock', version: '8.3.0', warnings: [], lobbySlides: { tokenConfigured: true } }));
    }
    if (req.headers().authorization !== 'Bearer tok') return route.fulfill(reply({ error: 'Wrong publish token.' }, 403));
    if (path === '/config' && req.method() === 'POST') { saved.push(req.postDataJSON()); return route.fulfill(reply({ ok: true })); }
    if (path === '/config') return route.fulfill(reply({ printerName: 'Dock', backupPrinterName: '', pickupClubs: ['Sparks'], lateGraceMin: 10 }));
    if (path === '/printers') return route.fulfill(reply({ printers: [{ name: 'Dock' }, { name: 'Spare' }] }));
    if (path === '/config/label-templates') return route.fulfill(reply({ templates: {}, knownClubs: ['spark'] }));
    if (path === '/config/schedule') return route.fulfill(reply({ schedule: [], lateGraceMin: 10 }));
    if (path === '/history/today') return route.fulfill(reply([]));
    return route.fulfill(reply({ error: 'not stubbed' }, 404));
  });
}

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
});

test('with no print server it says to open the page on the check-in laptop', async ({ page }) => {
  await page.route('http://localhost:3456/**', (route) => route.abort());
  await page.goto('/settings.html?lowPower=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Laptop' }).click();
  await expect(dialog.getByText('Open this page on the check-in laptop to set the printer.')).toBeVisible();
  await expect(dialog.getByText('What shows up there')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Look again' })).toBeVisible();
});

test('on the laptop it shows the printer and saves a pick with the token', async ({ page }) => {
  const saved = [];
  await stubLaptop(page, { saved });
  await page.addInitScript(() => localStorage.setItem('awanaPublishToken.v1', 'tok'));
  await page.goto('/settings.html?lowPower=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Laptop' }).click();
  await expect(dialog.getByText('Everything looks right')).toBeVisible();
  const printer = dialog.getByLabel('Name tag printer');
  await expect(printer).toHaveValue('Dock');
  await printer.selectOption('Spare');
  await expect(dialog.getByText('Saved. The next label prints there.')).toBeVisible();
  expect(saved).toEqual([{ printerName: 'Spare' }]);
  await expect(dialog.getByRole('link', { name: 'Open the print dashboard' })).toBeVisible();
});

test('the Laptop section is not on a screen\'s own Settings', async ({ page }) => {
  await page.goto('/?lowPower=1&configure=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tab', { name: 'Setup' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Laptop' })).toHaveCount(0);
});
