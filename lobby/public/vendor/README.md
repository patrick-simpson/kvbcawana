# Vendored third-party assets

## jelly-ui.js

- **What:** [Jelly UI](https://jelly-ui.com/) — dependency-free web
  components (`<jelly-theme>`, `<jelly-button>`, …) with soft-body
  physics. Single self-contained ES module; registers 40 custom
  elements, fetches nothing at runtime, uses system fonts.
- **Source:** `https://jelly-ui.com/dist/jelly.js` (the documented
  `https://jelly-ui.com/package.js` entry point is a barrel that
  re-exports this file).
- **Retrieved:** 2026-07-17
- **Why vendored:** this app runs unattended on an always-on display;
  loading UI chrome from a third-party CDN at runtime would make the
  screen depend on jelly-ui.com uptime. Same one-line `<script>` tag in
  `index.html`, served from our own origin instead.
- **To update:** re-download the URL above over this file, verify the
  Settings panel still renders, and update the retrieved date.
  Dependabot cannot see vendored files, so this is a manual check —
  glance at jelly-ui.com's changelog every few months (or whenever a
  Settings-panel bug appears) and refresh if upstream moved.
