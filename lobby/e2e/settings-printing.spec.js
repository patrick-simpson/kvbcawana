import { expect, test } from '@playwright/test';
import { generateKeyPair, importPrivateKey, keyRing, openAsStation } from '../shared/cloud-crypto.js';
import { SYNC_BASE, installWorker, makeWorld } from './settingsStub.js';

// The Printing section (docs/SETTINGS-OVERHAUL.md 2.5): the laptop's church-
// wide settings edited from any device through the Worker's church document
// (routes.md 10.3): saved against the revision shown, a stale 409 keeps what
// was typed, the not-seeded and paused states, and name tags sealed IN THE
// BROWSER to a real station key. Nothing here touches localhost until "At the
// laptop" is opened.

let station;
test.beforeAll(async () => { station = await generateKeyPair(); });

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
  page.w = makeWorld({ stations: [{ stationId: 'st1', name: 'Check-in laptop', pub: station.publicKey, kid: station.kid, registeredAt: 1, lastSeenAt: Date.now(), printer: { state: 'ok' } }] });
  page.local = [];
  await page.route(/localhost:3456/, (route) => { page.local.push(route.request().url()); return route.abort(); });
  await installWorker(page, page.w);
  await page.goto('/settings.html?lowPower=1');
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Printing' }).click();
});

const puts = (page) => page.w.calls.filter((c) => c.method === 'PUT' && c.path === '/v1/church/settings');

test('the church cards show the document and save a toggle at once, with baseRev', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('textbox', { name: 'Label footer' })).toHaveValue('KVBC Awana');
  await expect(dialog.getByRole('checkbox', { name: 'Sparks' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'T&T' })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Band the next label of a child who finished a handbook' }).click();   // controlled: it flips when the Worker has said yes
  await expect(dialog.getByText('Saved.').first()).toBeVisible();
  expect(puts(page)[0].body).toEqual({ baseRev: 2, settings: { trophyBand: false } });
  expect(page.w.church.rev).toBe(3);
});

test('the footer saves when you leave the field', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const footer = dialog.getByRole('textbox', { name: 'Label footer' });
  await footer.fill('Wednesdays 6:15 to 8:00');
  await footer.blur();
  await expect.poll(() => puts(page).length).toBe(1);
  expect(puts(page)[0].body.settings).toEqual({ labelFooter: 'Wednesdays 6:15 to 8:00' });
});

test('a stale save shows the newer value, keeps what was typed, and says to check and save again', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  page.w.churchStale = true;
  const grace = dialog.getByLabel('Late grace (minutes)');
  await grace.fill('25');
  const footer = dialog.getByRole('textbox', { name: 'Label footer' });
  await footer.fill('My footer');
  await footer.blur();
  await expect(dialog.getByText('Someone else changed this a moment ago; check and save again.')).toBeVisible();
  await expect(footer).toHaveValue('My footer');
  await expect(grace).toHaveValue('25');
  // saving again names the newer revision and lands
  await footer.focus();
  await footer.blur();
  await expect.poll(() => puts(page).length).toBe(2);
  expect(puts(page)[1].body.baseRev).toBe(3);
  expect(page.w.church.settings.labelFooter).toBe('My footer');
});

test('the schedule: a bad time is refused, a good one saves with the late grace', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Add a slot' }).click();
  await dialog.getByLabel('Row 1 club').fill('Sparks');
  await dialog.getByLabel('Row 1 starts').fill('soon');
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(dialog.getByText('A start time reads like 6:30.')).toBeVisible();
  expect(puts(page)).toHaveLength(0);
  await dialog.getByLabel('Row 1 starts').fill('6:30');
  await dialog.getByLabel('Row 1 activity').fill('Games');
  await dialog.getByLabel('Late grace (minutes)').fill('12');
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(dialog.getByText('Schedule saved.')).toBeVisible();
  expect(puts(page)[0].body.settings).toEqual({ schedule: [{ club: 'Sparks', startTime: '6:30', location: 'Games', room: '' }], lateGraceMin: 12 });
});

test('BARF Night: the nights are a list', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('button', { name: 'Remove 2026-10-28' })).toBeVisible();
  await dialog.getByLabel('Add a night').fill('2026-11-04');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => puts(page).length).toBe(1);
  expect(puts(page)[0].body.settings.barfNights).toEqual(['2026-10-28', '2026-11-04']);
  await expect(dialog.getByRole('button', { name: 'Show tonight’s list' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Print BARF Bag labels' })).toBeVisible();
  // The labels go sealed to the print stations as one job (owner 2026-10-14: the relayed job never printed).
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Print BARF Bag labels' }).click();
  await expect(dialog.getByText('Sent 2 BARF Bag labels to the label printer as one job: 1 child and 1 friend.')).toBeVisible();
  expect(page.w.barfAsks).toEqual([{ list: true }]);
  expect(page.w.reprints).toHaveLength(1);
  expect(page.w.reprints[0].jobId).toMatch(/^reprint:/);
  expect(JSON.stringify(page.w.reprints[0])).not.toMatch(/(?<![A-Za-z0-9+/])(?:Dot|Tester|Ed)(?![A-Za-z0-9+/])/);
});

test('before the laptop has sent its settings the cards are read-only, with one way forward', async ({ page }) => {
  page.w.church = { ...page.w.church, rev: 0, settings: null };
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Printing' }).click();
  await expect(dialog.getByText(/Waiting for the check-in laptop to send its settings \(KVBC Awana 9\.3\.0\)/)).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Label footer' })).toBeDisabled();
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Start from defaults instead' }).click();
  await expect.poll(() => puts(page).length).toBe(1);
  expect(puts(page)[0].body).toMatchObject({ baseRev: 0, fromDefaults: true });
  await expect(dialog.getByRole('textbox', { name: 'Label footer' })).toBeEnabled();
});

test('paused: read-only with the laptop pointer', async ({ page }) => {
  page.w.church = { ...page.w.church, paused: true };
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Printing' }).click();
  await expect(dialog.getByText(/Paused: change these at the laptop/)).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Label footer' })).toBeDisabled();
});

test('a name tag is sealed in the browser to the station key and posted as a reprint: job', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('Child’s first name').fill('Zed');
  await dialog.getByLabel('Child’s club').selectOption('T&T');
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Print tag' }).click();
  await expect(dialog.getByText(/Sent Zed’s tag: welcomed on the screens, not counted\./)).toBeVisible();
  const post = page.w.calls.find((c) => c.method === 'POST' && c.path === '/v1/print/reprint');
  expect(post.body.jobId).toMatch(/^reprint:[0-9a-f-]{36}$/);
  // the Worker saw ciphertext only
  expect(JSON.stringify(post.body)).not.toContain('Zed');
  expect(post.body.bundle.kind).toBe('print-job');
  // the station opens it with its own key and finds the record the print role runs
  const ring = await keyRing(await importPrivateKey(station.privateJwk), station.publicKey);
  const record = await openAsStation(ring, post.body.bundle);
  expect(record).toMatchObject({ route: '/print-oneoff', body: { firstName: 'Zed', clubName: 'T&T' }, source: 'settings' });
});

test('a leader tag and a custom label are sealed the same way; nothing goes to localhost', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  page.on('dialog', (d) => d.accept());
  await dialog.getByLabel('Leader’s name').fill('Bo Kim');
  await dialog.getByLabel('Leader’s club').selectOption('Sparks');
  await dialog.getByRole('button', { name: 'Print leader tag' }).click();
  await expect(dialog.getByText('Sent Bo Kim’s tag to the printer.')).toBeVisible();
  await dialog.getByLabel('Label text').fill('KITCHEN');
  await dialog.getByRole('button', { name: 'Print custom label' }).click();
  await expect(dialog.getByText('Sent to the printer.')).toBeVisible();
  const ring = await keyRing(await importPrivateKey(station.privateJwk), station.publicKey);
  const posts = page.w.calls.filter((c) => c.method === 'POST' && c.path === '/v1/print/reprint');
  expect(posts).toHaveLength(2);
  expect(await openAsStation(ring, posts[0].body.bundle)).toMatchObject({ route: '/print-leader', body: { name: 'Bo Kim', clubName: 'Sparks' } });
  expect(await openAsStation(ring, posts[1].body.bundle)).toMatchObject({ route: '/print-custom', body: { text: 'KITCHEN' } });
  expect(page.local).toEqual([]);
});

test('with no printing computer registered it says so instead of sealing to nobody', async ({ page }) => {
  page.w.stations = [];
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('Label text').fill('KITCHEN');
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Print custom label' }).click();
  await expect(dialog.getByText(/No printing computer is registered/)).toBeVisible();
  expect(page.w.calls.some((c) => c.path === '/v1/print/reprint')).toBe(false);
});

test('At the laptop is collapsed and nothing reaches localhost until it is opened', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByTestId('at-the-laptop')).not.toHaveAttribute('open', '');
  expect(page.local).toEqual([]);
  await dialog.getByTestId('at-the-laptop').locator('summary').click();
  await expect(dialog.getByText('Open this page on the check-in laptop for the printer itself.')).toBeVisible();
  expect(page.local.some((u) => u.endsWith('/health'))).toBe(true);
});

test('the Worker address is the only network the cards use', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('textbox', { name: 'Label footer' })).toBeVisible();
  expect(page.w.calls.every((c) => c.path.startsWith('/v1/'))).toBe(true);
  expect(SYNC_BASE.startsWith('https://')).toBe(true);
});
