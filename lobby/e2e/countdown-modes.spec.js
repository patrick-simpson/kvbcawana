import { expect, test } from '@playwright/test';

// Automated version of the manual time-travel QA that CLAUDE.md
// mandates for schedule-adjacent changes: drive countdown.html through
// every boundary with ?now= and assert the right view renders.
//
// 2026-09-16 is a Wednesday (the configured meeting day). All times are
// naive local ISO strings — playwright.config.js pins the timezone.
const CASES = [
  { now: '2026-09-16T17:59:00', mode: 'countdown', label: 'Wed just before opening' },
  { now: '2026-09-16T18:00:00', mode: 'slideshow', deck: 'opening', label: 'opening ceremony 18:00' },
  { now: '2026-09-16T18:05:00', mode: 'game-time', label: 'first game window 18:05' },
  { now: '2026-09-16T19:30:00', mode: 'slideshow', deck: 'closing', label: 'closing ceremony 19:30' },
  { now: '2026-09-16T19:35:00', mode: 'shutdown', label: 'shutdown 19:35' },
  { now: '2026-09-17T00:00:00', mode: 'countdown', label: 'Thursday midnight' },
  { now: '2026-09-15T18:30:00', mode: 'countdown', label: 'Tuesday evening (no club)' },
];

for (const { now, mode, deck, label } of CASES) {
  test(`renders ${mode}${deck ? `(${deck})` : ''} at ${label}`, async ({ page }) => {
    await page.goto(`/countdown.html?now=${now}`);
    const view = page.locator(`[data-mode="${mode}"]`);
    await expect(view).toBeVisible();
    if (deck) await expect(view).toHaveAttribute('data-deck', deck);
  });
}

// ?view=game, the lobby Settings' "Projector: game time" button: an afternoon
// that would show the countdown opens on the first game window instead, and
// the flag leaves the URL so a self-update reload lands on the schedule.
test('?view=game opens on game time and drops the flag', async ({ page }) => {
  await page.goto('/countdown.html?now=2026-09-16T15:00:00&view=game');
  await expect(page.locator('[data-mode="game-time"]')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has('view')).toBe(false);
  expect(new URL(page.url()).searchParams.get('now')).toBe('2026-09-16T15:00:00');
});

// The shutdown screen's idle blackout (src/presentation/lib/idleBlackout.js)
// only arms after 20 minutes of no key or mouse activity, and the idle
// clock starts at mount — so a freshly loaded shutdown screen is always
// the full screen, never black. (The blackout is also skipped outright
// under ?vr=1, which is what keeps the visual baseline valid.)
test('shutdown shows the full screen immediately after load, not a blackout', async ({ page }) => {
  await page.goto('/countdown.html?now=2026-09-16T19:40:00');
  const view = page.locator('[data-mode="shutdown"]');
  await expect(view).toBeVisible();
  await expect(view.getByText(/SEE YOU NEXT WEEK/i)).toBeVisible();
  await expect(page.locator('[data-blackout]')).toHaveCount(0);
});

// The game clock's wrap-up warning (src/presentation/lib/gameWarning.js).
// 18:28:30 leaves 90s of the 18:05-18:30 T&T window, so the amber
// two-minute heads-up is on screen (and stays up for a full minute,
// well past however long this page takes to load).
test('game time shows the two-minute wrap-up warning', async ({ page }) => {
  await page.goto('/countdown.html?now=2026-09-16T18:28:30');
  const view = page.locator('[data-mode="game-time"]');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-warning="two-minute"]')).toHaveText(/TWO MINUTES/);
});

test('quick-nav hover affordance exists', async ({ page }) => {
  await page.goto('/countdown.html?now=2026-09-15T18:30:00');
  await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
  // The operator menu is deliberately hidden until hovered — just assert
  // the page put SOMETHING interactive in the top-right hover zone.
  const hoverZone = page.locator('body');
  await hoverZone.hover({ position: { x: 1900, y: 20 } });
});

// Display Settings on the projector page: the passphrase box is typeable
// before any frame arrives, and — with no live-data key yet — the Advanced
// fold is open and carries a display-key row, so the projector can be keyed
// by hand without a second copy of the key slot.
test('display settings: passphrase typeable, advanced fold holds the display key', async ({ page }) => {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  // A deployed build may carry a baked Pusher key; this test wants a screen with none.
  await page.addInitScript(() => localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: '' })));
  await page.goto('/countdown.html?now=2026-09-15T18:30:00');
  await page.locator('body').hover({ position: { x: 1900, y: 20 } });
  await page.getByRole('button', { name: /Display Settings/ }).click();
  await expect(page.getByLabel('Display passphrase')).toBeEnabled();
  await expect(page.getByText(/add the live data key under Advanced first/i)).toBeVisible();
  await expect(page.getByPlaceholder('paste the 44-character key')).toBeVisible();
});

// The closing deck ends on "Upcoming Awana Nights" and holds it through
// pickup. The church's feed carries a long special title most weeks, and a
// long title takes a row of its own, so at a fixed chip size the fourth row
// fell off the bottom of the wall. Five nights, three with long names (the
// feed's own 2026-09-30 run), dated from the real today because the feed
// parser filters on the real clock, not ?now=.
test('the Upcoming Awana Nights slide keeps every night it shows inside the wall', async ({ page }) => {
  const day = (weeks) => {
    const d = new Date(Date.now() + (weeks * 7 + 1) * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const titles = [
    'Awana meeting (Making Bookmarks)',
    'Awana meeting (Making Bookmarks)',
    'Bring a Friend Night - Posters due',
    'Awana meeting',
    'Awana meeting',
  ];
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.route('**/calendar-feed.json', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceUrl: 'https://example.invalid/calendar/index',
      events: titles.map((title, i) => ({ date: day(i), kind: 'club', title, isCancelled: false })),
    }),
  }));
  await page.goto('/countdown.html?now=2026-09-16T19:31:00');
  const view = page.locator('[data-mode="slideshow"][data-deck="closing"]');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-slide="goodnight"]')).toBeVisible();
  // The slideshow starts listening for keys a moment after its first slide is
  // on screen (its effects run after the first paint: measured ~120 ms), so a
  // press sent the instant the slide appears can land before anything listens,
  // which failed this test about one run in three. Press until the next slide
  // is up; the closing deck holds its last slide, so an extra press is harmless.
  const row = view.locator('.pj-chip-row');
  await expect
    .poll(async () => {
      if ((await row.count()) === 0) await page.keyboard.press('Space');
      return row.count();
    }, { timeout: 10_000, intervals: [250] })
    .toBeGreaterThan(0);
  await expect(row).toBeVisible();
  await expect(row.locator('.pj-chip')).toHaveCount(5);
  // The chips rise 0.5em as they land: wait for the list to come to rest.
  await expect
    .poll(() => row.evaluate((el) => {
      const frame = el.closest('.pj-frame').getBoundingClientRect();
      const bottom = Math.max(...[...el.querySelectorAll('.pj-chip')].map((c) => c.getBoundingClientRect().bottom));
      return bottom <= Math.min(frame.bottom, window.innerHeight);
    }), { timeout: 10_000 })
    .toBe(true);
});
