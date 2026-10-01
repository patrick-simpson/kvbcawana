import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Some dev sandboxes preinstall Chromium at a stable path (exposed as
// /opt/pw-browsers/chromium) that may not match the exact build this
// @playwright/test version would download. Prefer it when present and
// no downloaded browser is available; CI always downloads via
// `npx playwright install --with-deps chromium`.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = !process.env.CI && existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined;

// E2E suites run against the built site (dist/) via `vite preview` —
// the same artifact GitHub Pages serves. `base: './'` means every
// asset path is relative, so tests navigate plain
// `/countdown.html` / `/index.html` regardless of where Pages mounts
// the site.
//
// Two projects:
//   smoke  — functional assertions (runs in ci.yml AND deploy.yml)
//   visual — screenshot comparisons (ci.yml only, so a 1-px font drift
//            can never block a club-night redeploy)
export default defineConfig({
  testDir: 'e2e',
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  snapshotPathTemplate: 'e2e/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    // The schedule engine runs on local wall-clock time; pin the zone so
    // naive `?now=` ISO strings mean church time on any runner.
    timezoneId: 'America/New_York',
    // Keep the service worker out of functional tests — the app must
    // work without it, and caching would mask asset regressions.
    serviceWorkers: 'block',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    // `smoke` gates the live deploy (deploy.yml), so it holds only fast,
    // stable, load-bearing checks. `visual` and `events` run in ci.yml only —
    // pixel drift and multi-step event choreography should flag a PR or the
    // weekly run, never stand between someone and a 5:55pm club-night fix.
    {
      name: 'smoke',
      testMatch: /.*\.spec\.js/,
      testIgnore: [/.*\.visual\.spec\.js/, /.*\.events\.spec\.js/],
    },
    { name: 'visual', testMatch: /.*\.visual\.spec\.js/ },
    { name: 'events', testMatch: /.*\.events\.spec\.js/ },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/countdown.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
