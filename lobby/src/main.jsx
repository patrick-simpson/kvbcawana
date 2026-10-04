import React from 'react';
import ReactDOM from 'react-dom/client';
// Bundled fonts (no CDN) so the display looks right even on a church
// network that blocks or throttles font hosts. The three brand voices
// (shared/brand/README.md): Paytone One shouts (--font-shout, and
// --font-display at the old footprint) and Londrina Solid labels
// (--font-condensed; the 400 cut only, which is already bold, so no CSS
// weight can reach for the much fatter 900). Both are @font-face rules in
// app.css on the kit's own full font files, never an @fontsource subset,
// because each license reserves the font's name. Figtree is read
// (--font-body) and comes from @fontsource: its license reserves no name.
import '@fontsource-variable/figtree';
// Baloo 2 stays for good: it backs the shout stack for Devanagari, the one
// script a name may use that Paytone One lacks and a chunky face still draws,
// and the browser only fetches that subset when such a name appears. It is
// also the fall promo posters' display face (--promo-font-display).
import '@fontsource-variable/baloo-2';
// Pinned for the fall promo posters ONLY (--promo-font-*, --font-poster),
// which stay exactly as printed until they retire on 2026-11-05. Drop these
// three imports then, not before.
import '@fontsource-variable/nunito';
import '@fontsource-variable/oswald';
import '@fontsource/lilita-one';
import App from './App.jsx';
import { RootErrorBoundary } from './components/RootErrorBoundary.jsx';
import './styles/app.css';

// Jelly UI web components (<jelly-theme>, <jelly-button>, …), vendored
// locally in public/vendor/ so the always-on display never depends on
// jelly-ui.com being up (see public/vendor/README.md). It's an ES module
// served straight from public/ — resolved against the page URL (works
// under any deploy base) and deliberately NOT bundled (@vite-ignore).
// Custom elements upgrade in place whenever the module lands, so the
// render below never waits on it.
import(/* @vite-ignore */ new URL('vendor/jelly-ui.js', document.baseURI).href);

// Offline shell: cache-first for hashed assets and shared/ club art,
// network-first for HTML/JSON (see src/sw.js — emitted with a per-build
// cache version). Production only; failures are the pre-SW status quo.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// <jelly-theme> scopes the Jelly UI design tokens to the app (mode="auto"
// follows the OS light/dark preference). It renders display:contents —
// layout-neutral, paints nothing — so the signage stage is unaffected.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <jelly-theme mode="auto">
        <App />
      </jelly-theme>
    </RootErrorBoundary>
  </React.StrictMode>,
);
