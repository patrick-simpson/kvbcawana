# CLAUDE.md

Senior Software Engineer focused on **Technical Integrity, Quality, and Operational Excellence**. Surgical fixes addressing root causes, not workarounds.

## Project
Windows app for printing child check-in labels at Awana events from TwoTimTwo.com. Since **9.0.0 the Windows app is "KVBC Awana"**, one app for every KVBC Awana computer: a print server, a display (the sound room app moved in), or both (see "KVBC Awana (9.0.0)" below and the root `ROADMAP.md#kvbc-awana-one-app`). It was "Club Label Printer" from v5.9.0 (and "Awana Label Printer" before that — renamed for Awana Clubs International trademark compliance; see changes.md's 5.9.0 entry), and the public site still calls the print server that.

**Components:** React Simulator (root) | Chrome Extension (chrome-extension/, zipped for download by bump-version.cjs) | Electron App (electron-app/) | Print Server (print-server/)

**Branding vs. internal identifiers — don't conflate these when touching either:**
`build.productName` (`electron-app/package.json`) is "KVBC Awana" since
9.0.0 (`APP_NAME` in main.js) — every user-visible string in the app (window
titles, tray, notifications, shortcuts, installer filename) should match it.
It must stay under `build` only: a TOP-LEVEL `productName` would become
Electron's app name and move userData (`electron-app/test/roles.test.cjs`
fails if one appears). `"name"`/`"appId"` (`awana-label-printer` /
`com.kvbc.awana-label-printer`) are **deliberately still the old name** —
electron-builder derives the install directory and `app.getPath('userData')`
from `"name"`, not `productName` (confirmed in `build-electron.yml`'s CI
comment), so renaming it would orphan every existing install's data folder
and break the NSIS upgrade-in-place registry lookup for zero user-visible
benefit. `%APPDATA%\awana-label-printer\chrome-extension` is therefore the
real, current path — don't "fix" it back to a title-cased `Club Label
Printer` folder; it was never that, even under the old branding (that was a
pre-existing doc bug, corrected in the 5.9.0 pass). Same reasoning protects
the channel name `awana-channel` (the wire protocol shared with the lobby
app in `lobby/`) and the `AWANA_*` env vars / `X-Awana-Pin`
header / `window.awana` bridge (internal-only, never shown to a user) — none
of these are part of the product's public branding, so none of them move if
"Club Label Printer" ever changes again.

## MANDATORY Checklist
Every functional change requires:
1. **Version bump** — `node scripts/bump-version.cjs <X.Y.Z>` (server.js changes). Auto-updates all files + extension. Also regenerate lockfiles (`npm install --package-lock-only` in `print-server/` and `electron-app/`) — the bump script doesn't touch their `version` field.
2. **changes.md** — Add entry at top with version, date, and what changed + why.
3. **Website/UI** — Update React components if affecting user install/usage.
4. **Build** — `npm run build` to rebuild the site (`dist`).
5. **Commit & push** — Never leave uncommitted. Changes only done when deployed.
6. **Push to `main`** — the owner's rule for this repo (the old printer repo
   used PRs). Nothing is live until it is on `main`: the root `ci.yml` runs
   every app's checks on each push and then publishes the site (the home page,
   `/checkin`, the update feeds) to awana.kvbchurch.org. A pushed branch
   nobody merges is work stranded where the operator can't see it.
7. **Cut the release** (if `electron-app/` or `print-server/` changed) — see "Releasing the Windows app" below. Don't stop at pushing to `main`; the `.exe` isn't live until the tagged build publishes.

## KVBC Awana (9.0.0): roles, the display, the wizard

Owner, 2026-10-11 (the root `ROADMAP.md#kvbc-awana-one-app` has the decisions and the full
build notes). The electron-app is one app with two roles:

- **`roles.json`** in userData (`src/roles.js`): `{print, display, name,
  setupDone}`, decided ONCE on the first v9 start, before anything writes to
  userData: a saved file wins; then the sound room's hand-off (a display);
  then printer data already in userData (`PRINTER_DATA`: the check-in laptop
  upgrading from 8.x is a print server with the display OFF and setup done,
  so it never sees the wizard or the display); else a new install (the
  wizard). Every write keeps `roles.json.bak`, read when the file is damaged.
- **The print server runs only with the print role**: `startServer()` and
  `ensureServerRunning()` return at once without it, and everything the app
  did at launch is `startPrintRole()`. Turning print off relaunches the app
  (the server module keeps timers of its own once loaded).
- **The display** is `src/display/` (the sound room app's main process,
  `createDisplay()`, started and stopped by the display role; the rules are
  lobby/CLAUDE.md's "The sound room desktop app", except that the hours are
  per computer, `settings.hours`, default 17:00-20:00, and the tray, updater,
  login item and single-instance lock are main.js's). Its pure modules'
  tests are `electron-app/test/*.test.cjs` on `node:test` (`npm run
  test:app`, part of `npm test`).
- **Updates**: every 10 minutes for every role, installed the moment they
  download (the sound room's rule). The print role adds no idle gate beyond
  a busy poll on the server's `isBusy()`, capped at a minute; a display-only
  computer takes the 5 s grace.
- **Busy** (`isBusy()` in `print-server/server.js`, exported, not on
  /health): a request on a printing route (`/print*`, `/reprint*`,
  `/canary`, `/play-tune`) still being answered, a job on the printer chain
  (`withPrinter`), a stretch reprint, or a phone check-in the extension has
  not driven yet (within the queue's 10-minute life).
  `scripts/test-print-async.cjs` pins it.
- **Start with Windows** is one login item for both roles: config.json's
  `launchOnBoot` (the tray's checkbox, the display's Settings, the wizard).
- **The wizard** (`src/setup-wizard.js`, `static/setup.html`, a six-call
  preload): role, the church passphrase (signs in through
  `print-server/sync-client.js`; the session goes to `sync-session.bin`
  encrypted with safeStorage, memory only where it cannot encrypt, never a
  plain file; the passphrase is held in memory until the wizard closes, to
  sign the print server in too via its loopback `/config/sync-login`), a
  name, the printer, the screen + monitor + hours. Tray: "Set up this
  computer...". It styles itself from the print server's brand-kit copy,
  two folders up from `static/` both unpackaged and packaged.
- **The sound room hand-off**: `src/handoff.js` reads
  `%APPDATA%\awana-label-printer\handoff.json` (written by
  `lobby/desktop` 2.1.0), and `src/old-app.js` uninstalls Awana Lobby
  Display afterwards. The format is shared with
  `lobby/desktop/src/handoff.js`: change both together.
- **The sync protocol is shared** (address and session rules, request building,
  login answers): `print-server/sync-client.js`, `sync-session.js` and
  `device-sync.js` run on `print-server/sync-protocol.js`, a GENERATED CommonJS
  copy of `lobby/shared/sync-protocol.js` (never edit it; run
  `node scripts/gen-sync-protocol.mjs` at the repo root, which
  `check-mirrors.mjs` enforces). It is a copy, not a runtime import of
  `lobby/`, because the packaged app ships `print-server/*.js` and has no
  `lobby/` folder; main.js hands `syncClient.protocol` to device-sync because
  the asar cannot require print-server.
- **On /settings** (`src/device-sync.js`, `test/device-sync.test.cjs`): a
  computer set up and signed in (the wizard's `sync-session.bin`, else on a
  print server the print server's own config.json sign-in) is the Worker's
  `computer` screen: `POST /v1/screens/hello` and `GET .../settings` at
  start and every 2 minutes, under `roles.json`'s `deviceId` (made once).
  The four keys (`printRole`, `displayRole`, `displayFrom`, `displayUntil`;
  `SPEC` is pinned to `SCREEN_SPECS.computer`) are reconciled against the
  last agreed copy (`device-sync.json`) like the lobby's `reconcileScreen`:
  a /settings change goes through `applyDeviceSettings` (display.configure
  for the hours, `checkRolesChange` + `applyRoles` for the roles, the
  wizard's path), a local one (`applyRoles`, the display's Settings window)
  is nudged up with PUT. A print-off while `isBusy()` is HELD: the rest
  applies, `pendingRoleChange` rides the hello, and it applies once idle.
  401 = signed out: it stops, the tray says so, and it resumes on a
  different session. Renames go both ways. `roles:get` / `roles:set` stay
  for the app's own file:// windows.

## Releasing the Windows app

**Never create the release tag manually** (`git tag` + `git push`, or the GitHub web UI "Draft a new release" flow). It has failed repeatedly in practice: a Claude Code session's git access is commonly scoped to branches only (tag pushes rejected), and manual tagging has hit silent footguns (tag name case, a republished release reusing its old tag ref).

Instead, once steps 1–5 are on `main`, dispatch **`.github/workflows/printer-release.yml`** (at the repo root) with the `version` input (e.g. `7.11.1`, no prefix; the tag it makes is `printer-v7.11.1`) and `ref` `main`:
- **Human:** GitHub → Actions → "Release KVBC Awana" → Run workflow → enter the version. (Since 9.0.0 its smoke test installs `KVBC-Awana-Setup.exe`, expects `KVBC Awana.exe` in `%LOCALAPPDATA%\Programs\awana-label-printer`, runs the process `KVBC Awana` and checks the upgraded laptop's `roles.json`.)
- **Claude:** `mcp__github__actions_run_trigger` with `method: "run_workflow"`, `workflow_id: "printer-release.yml"`, `ref: "main"`, `inputs: {"version": "7.11.1", "ref": "main"}`.

The workflow runs the test suites FIRST, then creates the tag (so a failing test never leaves a tag behind), builds the `.exe` on Windows, smoke-tests it (silent install, `/health`, `/preview`), publishes the GitHub Release with `make_latest: false`, and commits the update feed to `site/updates/printer/` (which `ci.yml` then publishes). **The feed is ours, not GitHub's "Latest"**: the app updates from awana.kvbchurch.org/updates/printer/, and the workflow refuses a version that would move the feed backwards. Watch it through with `mcp__github__actions_get`; a release is done when the run is green, the release has its assets, and the feed names the new version.

**Made a mistake?** Dispatch **`.github/workflows/delete-release.yml`** with `app` = printer and the exact stray tag; it removes the release and its tag with its own token (and revert the feed commit if one was made).

## Commands

| Context | Command |
|---------|---------|
| React (root) | `npm run dev` (port 3000) \| `npm run build` |
| Electron | `npm run dev` \| `npm run dist` (NSIS .exe) |
| Print Server | `PRINTER_NAME="Printer" node server.js` (port 3456) |
| Checks (root) | `npm test` runs every suite in `scripts/` (what `ci.yml` and the release run); extension logic is tested by lifting functions out of `content.js` (see `scripts/test-extension-*.cjs`) |

## Public website (root React app → the ONE family page, the home of awana.kvbchurch.org)

Built by `site/build.mjs` (`npm run build` here with `SITE_BASE=/`) and served
at the one site's root; the lobby lives under `/lobby`, Journey under
`/journey`, the phone page under `/checkin`. **This is the family's one
about page** (owner, 2026-10-12: the lobby's `about.html` and Journey's were
merged into it; `/lobby/about.html` and `/journey/about.html` 301 to `/#lobby`
and `/#journey`, `site/lib/redirects.js`, tested in `site/test/redirects.test.mjs`).
The page is a capability showcase written for church leadership first (then
other churches and volunteers). Its order: the label printer / KVBC Awana app
(hero, stats, `#features`, the whole club night `#family`, `#how-it-works`,
the Simulator `#simulator`, the Install Guide `#install`, the FAQ `#faq`),
then **`#lobby`** (the lobby signage and the projector,
`components/Lobby.tsx`, styles `styles/lobby.css`, classes `cid-`) and
**`#journey`** (the Journey kiosk, `components/Journey.tsx`,
`styles/journey.css`, classes `jd-`). The `#install`, `#simulator`, `#faq`,
`#features` and `#how-it-works` anchors must keep resolving
(`scripts/test-about-page.cjs` fails if one goes). The two product sections
wear their own accent (`data-accent="checkin"` / `"journey"`), keep their own
Fig. numbers, and carry their own hero; each was generated once from the old
static page and is edited here now. `components/family/ScreenIcons.tsx` is
the extra icon sprite they use (never a symbol id the family sprite already has).

- **This repo holds the family design system.** `styles/family.css` is the
  one committed stylesheet and `docs/FAMILY-DESIGN.md` its spec
  (`docs/family-reference.html` renders every component). The site bundles
  it through `styles/site.css`. `node scripts/family-assets.mjs` (repo root)
  still writes ignored copies to `lobby/public/family.css` and
  `journey/public/family.css`, which nothing links now that the static about
  pages are gone (to be dropped). Page-only styling goes in `styles/page.css`
  (`lbl-` prefix), `styles/lobby.css` (`cid-`) and `styles/journey.css` (`jd-`).
- **Tailwind v4 is compiled** (`@tailwindcss/vite`, `styles/site.css` with
  `source(none)` + explicit `@source` lines limited to the site's own files).
  No runtime CDN, no import map; icons are the inline SVG sprites in
  `components/family/Icons.tsx` and `ScreenIcons.tsx`.
- **The Simulator's DOM is a contract.** `#lastCheckin`, `.clubber`,
  `.name` and `.club img` (see `src/constants.ts` DOM_SELECTORS) mirror
  TwoTimTwo's real page, so keep that structure whenever it is restyled.
  Its roster (`data.ts`) is obviously fictional full names on purpose.
- **Claims track the code.** Every sentence must be true of the current
  release; a feature change that the page describes updates the page in the
  same commit. Opt-in features carry a `.fam-card__tag` (and that tag is used
  for nothing else: "set up once" notes are a plain `.cid-setup` line), the
  phone's "Not here" list is always shown with its safeguards, and the label
  mocks follow `generateLabel()`. The lobby's pick-up board is always shown
  with its four safeguards, worded as `decideBoard()` behaves; when the
  signage's look changes, rebuild its recreations in the same commit.
- **No Awana art, generic names.** Screens are CSS/SVG recreations of the
  CURRENT looks, drawn fresh: no logos, club wordmarks, mascots or curriculum
  clipart (the owner uses the official branding on the church's OWN screens,
  TRADEMARKS.md, and by his choice not on this public page), and no shape
  copied from the kit. Each is `role="img"` with a full `aria-label`, captioned
  "Recreated for illustration", with generic first names only; club names are
  plain text where the real screen shows a mark. The disclaimer bar, the meta
  description and the footer legal paragraph carry the not-affiliated line, and
  the first visible "Awana" carries the ®. Two deliberate AA departures,
  commented in `lobby.css` / `journey.css`: the check-in kicker is white on the
  club's deep wave, and the hot sticker / Begin button is `#CF4518`, not the
  kit's `#F15A28`. The lobby's chips (`.cid-step`) are generated by its own
  `chipGeometry()` around Paytone One's measured widths: regenerate them, never
  hand-edit (`lobby/src/lib/aboutChips.test.js` fails on drift). Doodles are
  placed for the headline that was there; the old browser test that measured
  every recreation for text touching a doodle (`e2e/about.visual.spec.js`)
  went with the static page, so check a changed recreation by eye at phone,
  tablet and desktop width.
- **Faces: the kit's own, never Google's** (owner, 2026-09-29: Galindo "looks
  too much like SpongeBob"; the projector's Lilita One went with it). Paytone
  One shouts, Londrina Solid labels, Figtree is read, from the lobby kit's
  `fonts.css` (`index.html` links `/lobby/shared/brand/fonts.css`, served by the
  one site; the full, unmodified files: their licenses reserve the names, so
  never a Google or `@fontsource` subset). Google is asked only for the
  editorial faces (Fraunces, Source Sans 3, IBM Plex Mono), in the ONE
  stylesheet each page links, and nothing else comes from another host: a v1
  `css?family=Paytone+One` link, a mirror, a preload, an `@import`, a
  page-local `@font-face` or a `url()` to another host all fail
  `scripts/test-about-page.cjs` (part of `npm test`), which also pins the
  lobby's three voices, the Journey start screen's palette to the kit's
  `tokens.css`, the no-image / no-kit-art rule, the not-affiliated line, the
  anchors and the links below. (A standalone `npm run dev` here has no
  `/lobby/shared/`, so it falls back to system faces.)
- **Journey's licensing wording is strict** (journey/CLAUDE.md, "Licensing
  boundary"): the `#journey` section says the kiosk plays curriculum the church
  already licenses through its own Awana Ministry Membership, used only within
  the church's own program, and never links to, names or advertises a lesson
  video, transcoded copy, release asset, transcript, handout or slide image
  (no "re-host", "mirror", "download" near the videos). Its room is students,
  never children.
- **Links out go only** to the three repos, this app's own downloads and the
  page's own sections (`/#lobby`, `/#journey`), never to the live signage
  (`/lobby/`, `/lobby/countdown`) or the kiosk root (`/journey/`).

## Architecture

**Label Generation:**
- ONE renderer: `generateLabel()` in `print-server/server.js` draws a
  1200×600 canvas PNG (4x2 @ 300dpi), printed via PowerShell
  `System.Drawing`. Electron does NOT render labels — its only hidden
  BrowserWindow is for printer enumeration; it require()s the print server
  in-process. (The extension's offline fallback label in `content.js` is a
  deliberately degraded safety artifact, not a second layout to keep in sync.)
- Per-club layout: `config.labelTemplates` (overrides-only, keyed by
  `clubKey()`), resolved by `labelTemplateFor()` in the HANDLERS and passed
  in as `input.template` — the renderer never reads config (golden-suite
  purity). Fail open: any broken template renders the stock label. Safety
  content (allergy icons, no-photo camera, birthday) is not templatable.
- **Three modules are GENERATED copies of `lobby/shared/`** (the installer
  holds only this folder): `print-server/clubTable.js` (the club table and the
  two matchers; `clubKey()` is the substring one on purpose, `brand.js`'s
  `MARK_FILES` / `MARK_NAMES` and `CLUB_MONOGRAM` come from the same rows),
  `print-server/textClean.js` (`cleanName`, `stripControlChars`,
  `sanitizeStoredText`, `cleanFriendName` keep their own limits) and
  `electron-app/src/display/clubNight.js` (the club-night rule, with this
  computer's hours). Never edit them: change the source in `lobby/shared/`,
  run `node scripts/shared-copies.mjs` from the repo root, commit both;
  `scripts/check-mirrors.mjs` fails CI on drift.

**Printing on Linux (7.19.0, ROADMAP.md#cloud-check-in's Raspberry Pi print station).**
`print-server/cups.js` prints the same label PNG through CUPS (`lp`, argument
arrays only, a queue name with spaces is refused) and reads `lpstat -l -p -d`
into the Get-Printer shape `printerSetupWarnings()` already judges. It is ON
only when `AWANA_PRINT_BACKEND=cups` (the station's service sets it, with
`PRINTER_NAME`): never inferred from the OS, because the test suites run on
Linux with a stand-in `powershell`. `config.cupsMedia` names the roll (default
DYMO 30256, `w167h288`). The Windows path is untouched.
`scripts/test-cups.cjs` (parsers, and the runners against stand-in `lp` /
`lpstat`) and `scripts/test-cups-server.cjs` (the real server in station mode).

**Tonight's count:** TwoTimTwo's own `/clubber/checkin_report` is the source of
truth when it is fresh (received within `REPORT_FRESH_MS`, 12 minutes); the
printer's own history is the fallback, and `/health` raises a
`{type:'tally-source'}` warning whenever it is the one being used.
`authoritativeTonight()` in `print-server/server.js` is **the one function** —
`publishTally()`, `computeTonightStats()` (so `/stats/tonight` and the
dashboard), `/phone/tonight` and `/health` all read it, and none of them
computes a count of its own. Rules: only a report the reconcile pass actually
APPLIED is kept (one the mass-undo guard refused would zero a night); a row
marked `undoneBy` — the phone's Remove or Undo check-in, or `/reset-tonight` — beats the report,
because TwoTimTwo goes on listing that child all evening; unregistered visitors
do not count while a report is fresh (owner's decision — they are not on it);
identities match on BOTH the clubber id and the name, so one child is never two,
but two DIFFERENT clubber ids are always two children (7.13.0: a shared bogus
name, the report's "YES 1 Share 1 Point" cell, merged 11 children into 2). The
report's name is the text of the cell holding the edit link (live since
2026-10-03: [edit] Name [undo]); a summary cell is never a name (both the
extension and `validateCheckinReportBody` refuse one), and a name-less entry is
never printed. A report that parsed fewer children than its own `Count:` footers
(`declared`) is PARTIAL: neither the count nor an undo list, and `/health` says
`report-partial`. The tally's tick runs from `TALLY_LEAD_MIN` (60) before the
club window to `TALLY_GRACE_MIN` after, and a state frame (tally, recap, …) the
sync relay could not deliver is OWED and resent once the service answers.
`scripts/test-report-parse.cjs` runs the extension's parser on the live layout.
**Checked out tonight comes off every count (7.15.0, owner).** The extension's
youth check-out (`ymSweep`) posts its whole list of clubber ids for the meeting
date to `POST /feed/checked-out` after every pass (replace semantics, merged so
a shorter list never puts a child back); `authoritativeTonight()` leaves those
ids out in both modes and reports `checkedOut`, so `checkedIn` everywhere means
"here now". The attendance ledger is untouched.
The `tally` payload shape is unchanged and must stay so.
**The phone's roster reads the same children (7.16.1).** `/phone/roster`'s
`checkedIn` comes from `rosterCheckedInKeys()`: every identity key the count
reads (`tonightHereNow()`), this printer's active rows, and anyone checked out
tonight, matched on the CSV's `ClubberID` and the normalised name. It used to
read only this printer's rows by exact name, so the youth page offered children
checked in at the desk or on TwoTimTwo. The report pass matches a row WITH an
id on its id only, and a name-only row on the report entry's name too.

**The brand kit (6.17.0, shout face Paytone One since 6.18.0).**
`print-server/public/brand/` is NOT committed: it is a generated, byte-identical
copy of the one canonical kit in `lobby/shared/brand/`, made by
`node ../scripts/family-assets.mjs printer` before anything reads it
(`npm test`'s `pretest`, print-server's `prestart`, electron-app's `predev` /
`pretest` / `prebuild:renderer` so `npm run dist` packages it, and
`release-app.yml` before the render smoke test), so the server, the tests and
the installer all hold a full local copy and nothing fetches it at runtime.
`scripts/test-brand-kit.cjs` (in `npm test`) fails if the copy is missing or
differs from the canonical kit, if any build script loses its copy step, or if
a text file has a CR (the text files are LF only; `lobby/.gitattributes`
keeps them so). Change the kit in `lobby/shared/brand/`, never the copy; a
bare `node server.js` or an individual `npm run test:*` needs `npm run assets`
once first. Golden label baselines show what a changed font or mark draws. `print-server/brand.js` registers Paytone One / Londrina Solid /
Figtree with the canvas and loads the official one-colour club marks, and
EVERYTHING in it fails open: a missing or damaged font, or a letter the font
lacks, prints that word in the old Windows face; a missing mark falls back to
the letter monogram; with the whole kit gone the label is the pre-rebrand one.
`/health` reports `fonts` / `clubMarks` and raises `brandFonts` / `brandMarks`
`{type, message}` warnings (reasons are fixed strings, never paths). The kit
folder is the ONE path served before the PIN gate (`/brand/`, only `.css`,
`.woff2`, `.ttf`, `.svg` with plain paths), because the phone page is the PIN
screen; keep it to public brand files only.

**The shout is Paytone One (6.18.0), not Galindo.** Owner decision 2026-09-29:
Galindo "looks too much like SpongeBob", so the first name, the monogram, a
custom label and every screen's headline are Paytone One (OFL; its Reserved
Font Names forbid a subset or re-encode, so the kit ships the FULL font and a
WOFF2 built to meet the OFL's WOFF exception: never swap in a Google or
@fontsource subset). Londrina Solid (label voice) and Figtree (read voice)
stayed; Londrina reserves its name too, so it ships whole the same way (its
web copies were Latin subsets until the 6.18.0 kit). What that means here:
- **Coverage moved.** Paytone One draws Ș Ț and every precomposed Vietnamese
  letter, which Galindo did not, so those first names and custom labels now
  print in the kit. It still lacks Cyrillic, Greek, CJK and the rest, and a
  few Latin letters (Ewe ɔ), which fall back whole. Figtree still lacks the
  precomposed Vietnamese letters, so a last name like "Nguyễn" falls back on
  its own (each voice decides for itself). Any test about "a letter the shout
  face lacks" must use a letter its character map really lacks: Cyrillic or
  Greek (`test-brand-kit.cjs` pins that they stay uncovered).
- **The ink sits differently in its box.** Measured off the canvas at a 'top'
  baseline: Paytone's capitals start 0.26 em down and its descenders are
  shallower than Galindo's, so the name is drawn `NAME_LIFT_BRAND` above its
  line box and the box is `NAME_LINE_H_BRAND`; and because it draws accents
  and the Ș comma far outside that box (Ấ rises 0.23 em above the origin, the
  comma hangs to 1.31 em), the layout also measures the name's own ink
  (`labelType().inkReach`) and reserves room above and below when a glyph
  needs it. `'middle'`-baseline lines (custom label, monogram) are centred on
  the capitals with `labelType().capCentre`. All of that applies only when the
  line prints in the kit face, so the old-Windows-face fallback labels are
  byte-identical to before (`fonts-fallback` and `kit-missing` baselines did
  not change), and the golden suite's "ink clear of the badge and the last
  name" checks measure pixels, not the layout numbers.
- **A mark's room comes from the paper first, then the block, then size.** A
  rising mark (É, Ấ) may print as near as `NAME_INK_TOP` (4 pt, what 6.17.0
  already printed) to the top edge; `accentCharge` charges the block only for
  what that margin cannot give. Past the 18 pt floor the room a mark or a comma
  asks for is given back in name size (at most `NAME_ROOM_SHRINK_MAX` under
  the floor), never left to land on the bottom band: the busiest step-up label
  (trophy chip, "Go to", milestone, twin hint) prints its callout exactly where
  an ordinary name does. Do not charge the whole room to `blockH` again (it cost
  accented names up to a quarter of their size on a crowded label), and do not
  let the leftover ride down (it printed the callout over the chip).
- **Wrapped custom labels set their pitch from the ink.** The marks are taller
  than the old 1.15 em line pitch (Ấ 1.19-1.22 em), so `customLineH` widens the
  pitch to the first line's lowest ink + the second's highest + a small gap
  whenever the whole label is in the kit face, and `fitCustomLabelText` fits
  the height with it (`lineH` in its result). Old-face labels keep 1.15 exactly.
  Any other place that stacks two kit lines needs the same, measured with
  `inkReach(..., 'alphabetic')`.
- **One name in three places.** The family string is `FONT_FILES[0]` in
  `brand.js`, `--brand-font-display` / `fonts.css` in the kit, and each
  surface's `--f-shout` fallback (dashboard, phone, the status
  window) plus `step-chip.js`'s measuring family; `test-brand-kit.cjs` and
  `test-dashboard-chrome.cjs` fail if they drift. The installer's `/health`
  smoke check still needs 4 loaded fonts (Paytone One, Londrina Solid, Londrina
  Solid Black, Figtree): the number is unchanged.

**One printer: the 4x2 label printer (7.17.0, owner 2026-10-08).** The
receipt-printer trial (Star TSP100 / Rongta, `receipt.js`, printerType
`receipt`/`receipt-usb`, `/receipt/*`, "Printer jammed" and `/jam-reprint`,
`/touch/jam`) was removed for good: do not bring any of it back. `printLabel()`
is `printImage()` on the name tag printer with the backup printer
(`backupPrinter()`) as its only fallback. Any receipt keys left in an old
config.json are never read. A late child (`lateGoToLine` answers) gets a plain name tag and
the household ONE drop-off label (`dropOffTagFor` / `generateDropOffTag`, once
per family per night) on the label printer. The card's band says GO TO and the time, never "late", and the child's own tag is identical to everyone's (owner: nothing singles a child out). `printerSetupWarnings()` (pure)
judges the setup: `printerUnset`, `printerNotFound`, `printerOffline`
(Get-Printer PrinterStatus); the dashboard and the
status window read offline as PROBLEM.
`scripts/test-label-printer.cjs`.

**One-off name tags (7.18.0, owner 2026-10-08).** `POST /print-oneoff`
{firstName, clubName} (typed name + a club from `CLUB_LIST`, no roster lookup)
prints the club's stock label for that first name, logs a history row with
`oneOff: true` (kept by `addHistoryEntry`; `isNonCheckinRow()` keeps it out of
every count, attendance, the still-here list and the reconcile pass), and
publishes a sealed `checkin` with `oneOff: true` (contract optional field):
the screens welcome the child and never count them. Never into the recap
buffer, no `publishTally()`. A reprint of a one-off (`reprintRow`) stays a
one-off and greets nobody. The touch check-in, the phone's + menu (relayed:
both allowlists carry it) and the dashboard all call the same route.
The touch check-in's **Undo check-in** (7.18.0, it replaced Printer jammed)
lists `/phone/tonight` and undoes through `/phone/undo` exactly like the
phone; a successful TwoTimTwo undo also `unmarkPrinted()`s the child, or a
check-in after it was answered "Already checked in at this station".

**Custom labels never write history.** `POST /print-custom` prints one line of
free text on a blank label and records nothing at all: no `addHistoryEntry`, no
`recordAttendance`, no `publishTally`, no `events.publish*`. It is not a
check-in in any mode, so it carries no TEST band either.

**Realtime:** the screens' channel is the sync Worker's live channel. The
print server's `events.publish()` seals a frame and hands it to the relay
(`events.setRelay`, installed by `server.js`: a bounded queue with a breaker,
and an OWED resend of state frames; `/health` warns while the breaker is open),
which only works while this computer is signed in to the sync service. The
Pusher publisher, its npm package and the cache-channel `provision` frame are
gone (2026-10-12), and so are the dashboard's Pusher fields; the electron app's
Pusher release-ping client went with them (updates poll the feed every 10
minutes). Old config.json files may still hold `pusher*` keys: they are never
read, and `pusherSecret` stays redacted from GET /config. The display
login is gone too (the passphrase state, `buildProvisionFrame`, the KDF,
`/config/display-login/generate` and the `provision` section of
`envelope-vectors.json`); an old `displayLoginPassphrase` stays redacted and any
POST /config scrubs it from disk. `/health` reports the
channel as `live` (`configured` means signed in), and the church-config key
`pusherChannel` keeps its old name because it is the relay's channel name.
Names stay sealed end to end under the old design's rules. Rules that must
survive any change:
- **Fail closed, never plaintext.** If a key is configured but a payload cannot
  be sealed, publish NOTHING. A silent downgrade is the worst outcome available.
- With **no** key configured the publisher stays plaintext on purpose (an
  operator who has not opted in must not have banners break on an auto-update),
  and `/health` says so loudly. Anti-downgrade lives on the consumer.
- Padding is part of the spec, not an optimisation — GCM leaks
  `len(firstName) + len(club)` without it, and club is inferable from the
  plaintext `tally`. `npm run test:envelope` fails the build if two `checkin`
  frames differ in length.
- The framing is pinned by `envelope-vectors.json`, mirrored byte-identically
  into the display repo. Changing it means bumping `ENVELOPE_VERSION`,
  `npm run gen:envelope-fixture`, and landing both repos together — there is no
  partial failure, either the sides agree or no name renders anywhere.
- **Printing is never gated on the pipe.** A child at the door gets a label even
  if the key, Pusher and the network are all broken.

**Extension distribution:** the extension is loaded UNPACKED, so Chrome never
auto-updates it and a self-hosted `update_url` is not honoured — silent update
is not available and must not be claimed. Instead `chrome-extension/` ships in
`extraResources` and the app syncs it into
`%APPDATA%\awana-label-printer\chrome-extension` on every launch
(`electron-app/src/extension-sync.js`), so an update costs a Chrome restart.
Rules: the target lives under **userData**, never `resources/` (an update
replaces that wholesale and Chrome would be left pointing at nothing); files are
written tmp+rename because Chrome may be reading them; files a new version drops
are pruned, or manifest.json loads old code beside new. The folder path is
loopback-only in `/health` — it contains the operator's Windows username and
`/health` is CORS-readable from the check-in site. The version is not gated;
the extension needs it for the update banner.

**`/health` warnings must be `{type, message}` objects.** The dashboard renders
`w.message`, so a bare string painted an EMPTY yellow box — the privacy and
phone-PIN warnings were invisible for exactly this reason. `warningTexts()` in
`test-server-realtime.cjs` fails by name if strings come back.

**Config writes:** `config.json` has several writers with different views of it.
Use `applySavedConfig()` for the live sync — plain `Object.assign` cannot DELETE,
which is why clearing the phone PIN used to leave the old one accepted until a
restart. The Electron app must merge via `electron-app/src/config-store.js`,
never write the file whole. Every write of config.json (both sides) is
tmp + fsync + rename with a `.bak` of the file it replaces; a damaged file is
restored from the backup or moved aside, never written over, and `/health`
says so. Every other data file goes through `saveFileAtomic()` in server.js
(retrying rename, a `/health` warning while a save keeps failing), the
history and the attendance ledger are held in memory and re-read only when
their file changes, and club logos are stored once by hash
(`club-icons.json`), never in each history row.

**One printing tab.** Every TwoTimTwo tab runs `content.js`, but only the
tab holding the `awana-print-leader` Web Lock runs the print machinery
(`startPrintMachinery`); the dedup state is one localStorage copy keyed by the
day (`dedupStore`), never sessionStorage. A phone action is claimed on the
server (`POST /pending-actions/:id/claim`, a 90 s lease) before it is driven.

**The phone's Tonight list: Remove vs Undo check-in (7.14.0).** Remove
(`POST /phone/undo`) is LOCAL: `markManualUndo(..., 'phone')`, the ledger strip,
`publishTally()`, nothing sent to TwoTimTwo. Undo check-in is the same route
with `inTwoTimTwo: true` (the website's relay allowlist already carries
`/phone/undo` and `/phone/status/:id`, and the Worker's list lives outside this
folder, so do not add a route for it): it needs a `clubberId` (400 otherwise:
visitors and id-less rows get Remove only), obeys `enableDrivenCheckin` (409),
and queues a `{type:'undo'}` pending action that NOTHING applies until the
extension reports `ok === true` (`applyTwoTimTwoUndo`: `undoneBy: 'twotimtwo'`,
so the roster offers Check in again, never Add back). Undo actions go only to a
poller with `?accept=undo` (an older extension would answer "Already checked
in", ok:true), fail with the reason if unclaimed in `UNDO_PICKUP_MS` or if a
claim's lease runs out (never re-driven), and take one result only. The
extension (`undoCheckinOnTwoTimTwo`) posts `checkinclubberundo` with the fresh
`#calendar_id` and the clubber id, counts only `undoReplyVerdict`'s short
"(checkin undone)" (never a page, the login form or "Login Required"), and
then requires the report not to list the child. `scripts/test-phone-undo.cjs`.

**Cloud check-in from the online phone page (8.0.0, owner 2026-10-11).** On
awana.kvbchurch.org/checkin the sync Worker answers POST /phone/checkin itself
(`lobby/worker/src/phone.js`): TwoTimTwo's own check-in post, with Bible and
Brought a friend as ticked, laptop on or off. With the laptop online it then
queues a JOB for it, `POST /print {name, clubName, clubberId, cloud: true}`.
A job is marked `job: true`, only the Worker makes one (`enqueueJob`), and
`phone-relay.js` runs a job only from `JOB_ROUTES` (print only), so
`RELAY_ROUTES` stay the phone page's own calls and still pin equal to the
Worker's. `cloud: true` writes `cloudCheckin: true` on the history row, and
`printedTonightFor()` then refuses a later `/print` for that child tonight
(the extension finding them by report or roster diff, by id or by name), and
refuses a cloud job for a child already printed tonight; an undone row counts
for neither. `scripts/test-cloud-print.cjs`, `test-phone-relay.cjs`.

**BARF Night (8.1.0, owner 2026-10-11).** On a date in `barfNights`
(church-config.json; config.json's own wins, which the tests use),
`performCheckinPrint` with `broughtFriend` prints a second tag after the
child's own, `generateBarfTag()` (slime band, BARFED!, the first name,
`barfFriendLine()`), never in the way of the first. `/print` reads
`friend: true` and `friendName` (`cleanFriendName`: one line, 24 chars);
`/phone/checkin` keeps `options.FriendName` only with `Friend`. The extension
leaves a friend note (`noteFriend`, by clubber id and name, 15 minutes) from
the touch bridge, a phone action, and a capture-phase click on TwoTimTwo's
own `#checkin` button when its Brought a friend box is ticked
(`friendBoxTicked`, no name); `doPrint` takes it (`takeFriendNote`), so
whichever path prints the tag carries it. `reportFriend()` sends the child,
club and friend's name to the Worker (`POST /v1/cloud/friend`) for the
night's email, except for a cloud check-in, which the Worker recorded
itself. The touch screen and phone.html ask "Friend's first name" under
Brought a friend (`friendInput`); a sibling's card never copies the name.
8.2.0: the BARFED tag is the name alone (no friend line), and
`POST /print-barf-bags {names}` prints one BARF Bag label per name
(`generateBarfBag`, `barfBagOwner`: "SOPHIA’S", "JAMES’") as ONE job:
`printImages()` is one PrintDocument with a page per label on Windows and one
`lp` with every file under CUPS, never retried. It is a Worker JOB route
(`JOB_ROUTES`), sent from the lobby's Settings. `scripts/test-barf.cjs`.

**The settings page reaches this server (8.3.0, owner 2026-10-11).**
awana.kvbchurch.org/settings (its Laptop section) calls this server on
localhost. `security.SETTINGS_PAGE_ORIGIN` is the one exact origin (never
`displayOrigins`), `SETTINGS_PAGE_ROUTES` the whole list of paths and methods,
`SETTINGS_PAGE_CONFIG_KEYS` the only keys POST /config takes from it; every
route but /health needs a loopback socket and either the page's sync session
(`Authorization: Sync`, confirmed with the sync service by
`settingsPageSessionOk`, only while this server is signed in to it) or the
publish token (`corsPolicy`
sets `req.settingsPage`), and the preflight answers Private Network Access
for those routes only. A route that should accept the page next to the
dashboard uses `isTrustedOrSettingsPage`; anything holding a secret or opening
the network keeps `isTrustedConfigOrigin` alone. The extension's options,
popup and "Printing to Change" link open the settings page; the dashboard is
the offline fallback. `scripts/test-settings-page.cjs`.

**The still-here list and the phone's Check out (7.16.0, owner 2026-10-08).**
The lobby's pickup list (shown from 7:30) is built HERE, not scraped:
TwoTimTwo's Checkout page lists nobody at KVBC. `tonightHereNow()` is the
"who" behind `authoritativeTonight()` (one child per identity, same rules,
visitors only when history-built), and `publishStillHere()` filters it by
config `pickupClubs` (`print-server/pickup.js`; default every club but Trek
and Journey; the dashboard's "Clubs on the pickup list") and publishes the
existing sealed `checkout` event through `events.buildCheckout` (shape
unchanged and mirrored with the lobby: entries {firstName, club} plus
`printed`). Every minute in the tally window and, debounced, on any change
(`publishTally()` calls `stillHereChanged()`), never outside the window.
`POST /feed/checkout` still validates and answers ok but NEVER publishes (an
empty scrape would clear the lobby). Phone Check out = `/phone/undo` with
`checkout: true` (same relay reasoning as Undo): with a clubber id it queues
a `{type:'checkout'}` one-shot action (only for `?accept=...checkout`, same
pickup/lease failures as undo) applied only on a literal `ok === true`
(`applyTwoTimTwoCheckout` → `markCheckedOut` → `publishTally`); the extension
(`checkoutOnTwoTimTwo`) uses the youth sweep's `readCheckoutPage` +
`postClubberCheckout` and accepts only an exact "OK". Without an id it is a
local by-name mark (`checkedOutTonight.names`). `/phone/tonight` lists
`features: ['checkout']` so a newer website phone page never offers it to an
older laptop. Check-outs made on the Checkout page: feeds.js compares two
genuine reads (`checkoutDisappearances`) and posts ids with
`source: 'checkout-page'`; the server skips ids whose newest row is undone.
`scripts/test-pickup-board.cjs`.

**Data Flow:**
- The extension fetches the CSV → POST /update-csv
- Server reloads clubbers.csv on every print request
- Enrichment: Match firstName+lastName to allergies (Notes field)

## Reliability Mandates
- **Zero-Loop Policy:** Self-relaunching scripts MUST have recursion guards. Never assume admin checks are bulletproof.
- **Context-Aware:** PowerShell the print path shells out to must account for the parent process (the app, a CUPS station, or a bare `node server.js`).
- **Never Crash:** uncaughtException handlers in server; silent failures for enrichment (print basic label).
- **Cleanup:** Always unlink temp files in finally blocks.
