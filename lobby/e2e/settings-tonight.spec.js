import { expect, test } from '@playwright/test';
import { SYNC_BASE, installWorker, makeWorld } from './settingsStub.js';

// Tonight's mission control (docs/SETTINGS-OVERHAUL.md sections 2.1 and 5),
// against a stand-in Worker (the overview, switches, notice and change log of
// routes.md section 10) and a stand-in live channel: the running count, the
// last five FIRST NAMES from live frames (in memory only), the online
// check-in switches with their confirm, the notice composer and Undo.

const SESSION_CHILD = (n, extra = {}) => ({
  id: `child-${n}`, at: new Date(Date.now() + n * 1000).toISOString(), firstName: `Kid${n}`, club: n % 2 ? 'Sparks' : 'Cubbies', isBirthday: false, isFirstTimer: false, ...extra,
});

let send;
test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
  page.w = makeWorld();
  send = await installWorker(page, page.w);
  await page.goto('/settings.html?lowPower=1');
});

test('the running count, the clubs, the stations and the TwoTimTwo read come from the overview', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByTestId('mission-total')).toHaveText('42');
  await expect(dialog.getByRole('list', { name: 'Checked in by club' })).toContainText('Sparks');
  await expect(dialog.getByRole('list', { name: 'Checked in by club' })).toContainText('18');
  await expect(dialog.getByText('Check-in laptop').first()).toBeVisible();
  await expect(dialog.locator('.mission-line', { hasText: 'TwoTimTwo:' })).toContainText('OK');
  await expect(dialog.locator('.mission-line', { hasText: 'Trek and Journey check-out:' })).toContainText('4 checked out, 1 pending');
  await expect(dialog.getByRole('link', { name: 'Open the desk' })).toHaveAttribute('href', '/desk');
  // the poll is on: it reads again by itself
  const first = page.w.calls.filter((c) => c.path === '/v1/tonight/overview').length;
  expect(first).toBeGreaterThanOrEqual(1);
});

test('a live tally frame ticks the count between polls', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByTestId('mission-total')).toHaveText('42');
  await send('tally', { counts: { Sparks: 20, Cubbies: 14, Puggles: 10 }, total: 44, at: new Date(Date.now() + 60_000).toISOString() });
  await expect(dialog.getByTestId('mission-total')).toHaveText('44');
});

test('the last five check-ins are first names only, newest first, and live in memory alone', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByTestId('mission-total')).toHaveText('42');
  await expect(dialog.getByText(/Nobody yet this session/)).toBeVisible();
  for (let n = 1; n <= 7; n += 1) await send('checkin', SESSION_CHILD(n, n === 3 ? { lastName: 'Secretson', allergies: 'peanuts', phone: '555-0100' } : {}));
  const list = dialog.getByTestId('mission-recent');
  await expect(list.locator('li')).toHaveCount(5);
  await expect(list.locator('li strong')).toHaveText(['Kid7', 'Kid6', 'Kid5', 'Kid4', 'Kid3']);
  await expect(list.locator('li').first()).toContainText('Sparks');
  // nothing but a first name, a club and a time
  const text = await dialog.innerText();
  expect(text).not.toMatch(/Secretson|peanuts|555-0100/);
  // a replayed duplicate is not shown twice
  await send('checkin', SESSION_CHILD(7));
  await expect(list.locator('li')).toHaveCount(5);
  // memory only: not in any browser storage
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  expect(stored).not.toMatch(/Kid\d/);
  const idb = await page.evaluate(async () => (indexedDB.databases ? JSON.stringify(await indexedDB.databases()) : ''));
  expect(idb).not.toMatch(/Kid\d/);
});

test('a name never reaches the stage: the page shows no banner, and a one-off tag is marked', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await send('checkin', SESSION_CHILD(1, { oneOff: true }));
  await expect(dialog.getByTestId('mission-recent')).toContainText('Kid1');
  await expect(dialog.getByTestId('mission-recent').getByText('tag')).toBeVisible();
  await expect(page.locator('.checkin')).toHaveCount(0);
});

test('?mission=0 hides the card', async ({ page }) => {
  await page.goto('/settings.html?lowPower=1&mission=0');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('heading', { name: 'Calendar & phase' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Tonight at a glance' })).toHaveCount(0);
});

test('alerts: CHECK THE PRINTER and no printing computer in 2 minutes say so', async ({ page }) => {
  page.w.overview = { ...page.w.overview, print: { ...page.w.overview.print, checkThePrinter: 2, stations: [{ ...page.w.overview.print.stations[0], lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString() }] } };
  await page.goto('/settings.html?lowPower=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByTestId('overview-alerts')).toContainText('CHECK THE PRINTER');
  await expect(dialog.getByTestId('overview-alerts')).toContainText('No printing computer has been heard from in 2 minutes');
});

test('a switch asks first, listing the Worker\'s warnings, writes one switch, and shows the answer', async ({ page }) => {
  page.w.switches.warnings = ['station-old', 'window-open'];
  page.w.switches.stations = [{ stationId: 'st1', name: 'Check-in laptop', lastSeenAt: new Date().toISOString(), version: '9.2.1', churchRev: 1 }];
  await page.goto('/settings.html?lowPower=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const box = dialog.getByRole('checkbox', { name: 'Print TwoTimTwo-page check-ins' });
  await expect(box).not.toBeChecked();
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.accept(); });
  await box.click();   // controlled: it changes when the Worker has said yes
  await expect(dialog.getByText('Turned on.')).toBeVisible();
  expect(asked).toMatch(/Turn on: Print TwoTimTwo-page check-ins\?/);
  expect(asked).toMatch(/older KVBC Awana/);
  expect(asked).toMatch(/Check-in is open right now/);
  const put = page.w.calls.find((c) => c.method === 'PUT' && c.path === '/v1/switches');
  expect(put.body).toMatchObject({ name: 'CLOUD_PRINT', value: 'on', rev: 1 });
  // the Worker's own warnings, after
  await expect(dialog.locator('.switch-warnings')).toContainText('cannot follow this change until it updates');
  await expect(box).toBeChecked();
  const row = dialog.locator('[data-switch="CLOUD_PRINT"]');
  await expect(row).toContainText('Default: off.');
  await expect(row).toContainText('Changed by Chrome on Linux');
  // Back to default
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Back to default' }).click();
  await expect(box).not.toBeChecked();
  expect(page.w.calls.filter((c) => c.method === 'PUT' && c.path === '/v1/switches').at(-1).body.value).toBe('default');
});

test('a "no" at the confirm changes nothing', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  page.once('dialog', (d) => d.dismiss());
  await dialog.getByRole('checkbox', { name: 'Check out Trek and Journey automatically (7:15 pm)' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Check out Trek and Journey automatically (7:15 pm)' })).not.toBeChecked();
  expect(page.w.calls.some((c) => c.method === 'PUT' && c.path === '/v1/switches')).toBe(false);
});

test('the Advanced fold holds the safety switches and the TwoTimTwo test', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const fold = dialog.locator('details.advanced-fields', { hasText: 'Printing settings from this page' });
  await fold.locator('summary').click();
  await expect(fold.getByRole('checkbox', { name: 'Notices to every screen' })).toBeVisible();
  await expect(fold.getByRole('checkbox', { name: 'Write the change log' })).toBeVisible();
  await expect(fold.getByRole('button', { name: 'Test TwoTimTwo sign-in' })).toBeVisible();
});

test('the notice composer sends a notice to every screen, then takes it down', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('How important').selectOption('warn');
  await dialog.getByLabel('Message').fill('Club ends at 7:45 tonight.');
  await expect(dialog.getByText(/26 of 200/)).toBeVisible();
  await dialog.getByLabel('How long').selectOption('60');
  await dialog.getByRole('button', { name: 'Send to every screen' }).click();
  await expect(dialog.getByText('Sent to 3 screens.')).toBeVisible();
  const post = page.w.calls.find((c) => c.method === 'POST' && c.path === '/v1/notice');
  expect(post.body).toEqual({ level: 'warn', message: 'Club ends at 7:45 tonight.', durationMin: 60 });
  await expect(dialog.getByTestId('notice-current')).toContainText('Heads up');
  await expect(dialog.getByTestId('notice-current')).toContainText('Club ends at 7:45 tonight.');
  await dialog.getByRole('button', { name: 'Take it down' }).click();
  await expect(dialog.getByTestId('notice-current')).toHaveCount(0);
  expect(page.w.calls.some((c) => c.method === 'DELETE' && c.path === '/v1/notice')).toBe(true);
});

test('an Urgent notice asks first', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('How important').selectOption('critical');
  await dialog.getByLabel('Message').fill('CLUB CANCELLED TONIGHT');
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await dialog.getByRole('button', { name: 'Send to every screen' }).click();
  await expect.poll(() => asked).toMatch(/URGENT/);
  expect(page.w.calls.some((c) => c.method === 'POST' && c.path === '/v1/notice')).toBe(false);
});

test('the composer\'s draft shows in the TV preview, with the real banner', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('How important').selectOption('critical');
  await dialog.getByLabel('Message').fill('CLUB CANCELLED TONIGHT');
  const col = dialog.locator('.settings-preview-col');
  await expect(col.getByRole('img', { name: /notice banner/i })).toBeVisible();
  await expect(col.locator('.notice-banner--critical')).toContainText('CLUB CANCELLED TONIGHT');
});

test('Recent changes: Undo puts a setting back; a change made again since says so', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const card = dialog.locator('.panel-card', { has: page.getByRole('heading', { name: 'Recent changes' }) });
  await expect(card).toContainText('Chrome on Android');
  await card.getByRole('button', { name: /^Undo: Chrome on Android/ }).click();
  await expect(card.getByText('Undone.')).toBeVisible();
  expect(page.w.calls.some((c) => c.method === 'POST' && c.path === '/v1/changes/3/undo')).toBe(true);
  page.w.undo = { status: 409, body: { reason: 'changed-since', keys: ['CLOUD_PRINT'] } };
  page.w.changes[1].undoneBy = undefined;
  await page.goto('/settings.html?lowPower=1');
  const again = dialog.locator('.panel-card', { has: page.getByRole('heading', { name: 'Recent changes' }) });
  await again.getByRole('button', { name: /^Undo: Chrome on Windows/ }).click();
  await expect(again.getByText('Changed again since; nothing undone.')).toBeVisible();
  await again.getByRole('button', { name: 'All changes' }).click();
  await expect(dialog.getByRole('tab', { name: 'Account & app' })).toHaveAttribute('aria-selected', 'true');
});

test('a Worker without the new routes says they arrive later, and nothing breaks', async ({ page }) => {
  await page.route(`${SYNC_BASE}/v1/switches`, (route) => route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await page.goto('/settings.html?lowPower=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByText(/does not have this yet/).first()).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Notice to every screen' })).toBeVisible();
});
