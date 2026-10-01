# Auto-update feeds

These files are the update feeds the two Windows apps read (electron-updater,
generic provider). They are copied to `/updates/` by `site/build.mjs`, served
with `Cache-Control: no-cache`.

| Feed file | App | Read from |
| --- | --- | --- |
| `printer/latest.yml` | Club Label Printer | https://awana.kvbchurch.org/updates/printer/latest.yml |
| `lobby/lobby.yml` | Awana Lobby Display (sound room app, channel `lobby`) | https://awana.kvbchurch.org/updates/lobby/lobby.yml |

**Both are empty until the first release cut from this repo.** An installed
app that finds no feed simply sees "no update".

Do not edit them by hand. `.github/workflows/printer-release.yml` and
`desktop-release.yml` write them after publishing a GitHub Release: they take
electron-builder's generated yml, rewrite every `url` and `path` to the
absolute release asset URL
(`https://github.com/patrick-simpson/kvbcawana/releases/download/<tag>/<asset>`),
commit it to `main` and dispatch `ci.yml` so the site redeploys with it. The
installers and `.blockmap` files stay on the GitHub Release (Cloudflare Pages
cannot host files over 25 MB); the feed only points at them. Releases are
published with `make_latest: false`, since neither app uses "Latest" any more.
