import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = resolve(__dirname, 'shared');

const MIME = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.md': 'text/markdown',
  // The brand kit (shared/brand/): an <img> will not render an SVG served
  // as application/octet-stream, and a browser refuses mistyped fonts/CSS.
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};

// Hosts the repo-root `shared/` directory (schedule.json, theme.json,
// club art) for the whole Awana app family: served at `/shared/*` by the
// dev server and copied into `dist/shared/` on build so GitHub Pages
// publishes it. Lives at the repo root (not `public/`) because the
// presentation page imports the JSONs directly and Vite forbids
// importing from the public dir. Ported from KVBC-Awana-Countdown,
// which remains the canonical host until retirement.
function sharedDir() {
  return {
    name: 'awana-shared-dir',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [url, query] = (req.url ?? '').split('?');
        // Vite rewrites source imports of the shared JSONs to
        // `/shared/*.json?import` and must transform those itself —
        // this middleware only serves plain runtime fetches (art PNGs,
        // sibling apps reading the JSONs in dev).
        if (query && query.split('&').includes('import')) return next();
        const prefix = '/shared/';
        if (!url.startsWith(prefix)) return next();
        const rel = normalize(decodeURIComponent(url.slice(prefix.length)));
        if (rel.startsWith('..')) return next();
        const file = join(SHARED_DIR, rel);
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      cpSync(SHARED_DIR, resolve(__dirname, 'dist/shared'), { recursive: true });
    },
  };
}

// The one build identity, used for three things.
//
// 1. sw.js (from src/sw.js) gets the hash and a precache manifest baked in.
//    The hash is a sha of the emitted filenames: any code change renames a
//    hashed asset, so every deploy gets a new cache name and `activate` drops
//    the old one (never-stale-JS guarantee). shared/ is deliberately NOT
//    precached (sharedDir() copies it after this hook); it's runtime-cached by
//    the SW's fetch rules instead.
// 2. `dist/version.json` publishes it, so a page that has been running for
//    days can ask whether it is still the current build.
// 3. Both HTML entries carry it in a `<meta name="awana-build">` tag, which is
//    how app code reads its own build without importing anything. The
//    presentation page shares src/lib/buildReload.js that way without
//    breaking its isolation rule. See CLAUDE.md, "Self-updating pages".
//
// The hash is only knowable once rollup has named every file, so
// transformIndexHtml writes a token and the post-order generateBundle below
// swaps it for the real hash in the emitted HTML. The HTML files themselves
// are kept out of the hashed/precached file list, so sw.js is unchanged by
// this: a token in the markup must not be able to move the cache name.
function serviceWorker() {
  return {
    name: 'awana-service-worker',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(
        '</head>',
        '  <meta name="awana-build" content="__BUILD_HASH__" />\n  </head>'
      ),
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const files = Object.keys(bundle).sort().filter((f) => !f.endsWith('.html'));
        const hash = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
        const precache = files
          .filter((f) => /\.(js|css|woff2?)$/.test(f) && !f.startsWith('powerpoint-addon/'))
          .map((f) => `./${f}`);
        const source = readFileSync(resolve(__dirname, 'src/sw.js'), 'utf8')
          .replace('__BUILD_HASH__', hash)
          .replace('__PRECACHE_MANIFEST__', JSON.stringify(precache, null, 2));
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: `${JSON.stringify({ build: hash, builtAt: new Date().toISOString() }, null, 2)}\n`,
        });
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (!fileName.endsWith('.html') || chunk.type !== 'asset') continue;
          chunk.source = String(chunk.source).replace('__BUILD_HASH__', hash);
        }
      },
    },
  };
}

// Relative asset paths so the build works at any URL — local preview,
// GitHub Pages under /<repo>/, a custom domain, anywhere — with zero
// env-var configuration. Crucial for novice deploys.
export default defineConfig({
  plugins: [react(), tailwindcss(), sharedDir(), serviceWorker()],
  base: './',
  server: {
    host: true,
    port: 3000,
  },
  build: {
    rollupOptions: {
      // Two independent pages: the check-in signage stage (index.html)
      // and the full-screen presentation tool (countdown.html). Each has
      // its own JS/CSS graph — Tailwind is imported only by the
      // presentation stylesheet, so the signage bundle never sees it.
      input: {
        index: resolve(__dirname, 'index.html'),
        countdown: resolve(__dirname, 'countdown.html'),
      },
    },
  },
  // The default public/ dir holds the favicon plus the PowerPoint add-in
  // under public/powerpoint-addon/, matching the /powerpoint-addon/…
  // URLs in the add-in manifest.
  test: {
    environment: 'jsdom',
    // Playwright specs live in e2e/ and must never run under vitest. The
    // desktop app's tests run in its own pipeline (build-desktop.yml), so a
    // desktop TEST can never block a site redeploy (the root lint still
    // covers desktop/).
    exclude: [...configDefaults.exclude, 'e2e/**', 'desktop/**', 'worker/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      // Count un-imported files in the denominator so untested code is
      // visible, not invisible.
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/**/*.test.{js,jsx}',
        'src/**/__fixtures__/**',
        'src/main.jsx',
        'src/presentation/main.jsx',
        'src/sw.js', // service worker — never runs under jsdom
        'desktop/**', // the sound room app: tested in build-desktop.yml
      ],
      // Ratchet DELIBERATELY (no autoUpdate): measured 2026-07 baseline
      // (stmts 44 / branches 47 / funcs 37 / lines 46) minus ~5 points
      // of headroom. Raise as the component layer gains tests; never
      // lower without a written reason.
      thresholds: { lines: 41, statements: 39, functions: 31, branches: 41 },
    },
  },
});
