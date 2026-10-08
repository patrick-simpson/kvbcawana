# CLAUDE.md

Senior Software Engineer focused on **Technical Integrity, Quality, and Operational Excellence**. Surgical fixes addressing root causes, not workarounds.

## Project
Windows app for printing child check-in labels at Awana events from TwoTimTwo.com. Branded **"Club Label Printer"** since v5.9.0 (was "Awana Label Printer" — renamed for Awana Clubs International trademark compliance; see changes.md's 5.9.0 entry for the full rationale).

**Components:** React Simulator (root) | Chrome Extension (chrome-extension/, zipped for download by bump-version.cjs) | Electron App (electron-app/) | Print Server (print-server/) | Legacy Installer (install-and-run.ps1, deprecated)

**Branding vs. internal identifiers — don't conflate these when touching either:**
`productName` (`electron-app/package.json`) is "Club Label Printer" — every
user-visible string (window titles, tray, shortcuts, installer filename)
should match it. `"name"`/`"appId"` (`awana-label-printer` /
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
1. **Version bump** — `node scripts/bump-version.cjs <X.Y.Z>` (server.js or install-and-run.ps1 changes). Auto-updates all files + extension. Also regenerate lockfiles (`npm install --package-lock-only` in `print-server/` and `electron-app/`) — the bump script doesn't touch their `version` field.
2. **changes.md** — Add entry at top with version, date, and what changed + why.
3. **Website/UI** — Update React components if affecting user install/usage.
4. **Build** — `npm run build` to sync bookmarklet and dist.
5. **Commit & push** — Never leave uncommitted. Changes only done when deployed.
6. **Push to `main`** — the owner's rule for this repo (the old printer repo
   used PRs). Nothing is live until it is on `main`: the root `ci.yml` runs
   every app's checks on each push and then publishes the site (the home page,
   `/checkin`, the update feeds) to awana.kvbchurch.org. A pushed branch
   nobody merges is work stranded where the operator can't see it (it
   happened once, with the ideas page).
7. **Cut the release** (if `electron-app/` or `print-server/` changed) — see "Releasing the Windows app" below. Don't stop at pushing to `main`; the `.exe` isn't live until the tagged build publishes.

## Releasing the Windows app

**Never create the release tag manually** (`git tag` + `git push`, or the GitHub web UI "Draft a new release" flow). It has failed repeatedly in practice: a Claude Code session's git access is commonly scoped to branches only (tag pushes rejected), and manual tagging has hit silent footguns (tag name case, a republished release reusing its old tag ref).

Instead, once steps 1–5 are on `main`, dispatch **`.github/workflows/printer-release.yml`** (at the repo root) with the `version` input (e.g. `7.11.1`, no prefix; the tag it makes is `printer-v7.11.1`) and `ref` `main`:
- **Human:** GitHub → Actions → "Release Club Label Printer" → Run workflow → enter the version.
- **Claude:** `mcp__github__actions_run_trigger` with `method: "run_workflow"`, `workflow_id: "printer-release.yml"`, `ref: "main"`, `inputs: {"version": "7.11.1", "ref": "main"}`.

The workflow runs the test suites FIRST, then creates the tag (so a failing test never leaves a tag behind), builds the `.exe` on Windows, smoke-tests it (silent install, `/health`, `/preview`), publishes the GitHub Release with `make_latest: false`, and commits the update feed to `site/updates/printer/` (which `ci.yml` then publishes). **The feed is ours, not GitHub's "Latest"**: the app updates from awana.kvbchurch.org/updates/printer/, and the workflow refuses a version that would move the feed backwards. Watch it through with `mcp__github__actions_get`; a release is done when the run is green, the release has its assets, and the feed names the new version.

**Made a mistake?** Dispatch **`.github/workflows/printer-delete-release.yml`** with the exact stray tag; it removes the release and its tag with its own token (and revert the feed commit if one was made).

## Commands

| Context | Command |
|---------|---------|
| React (root) | `npm run dev` (port 3000) \| `npm run build` |
| Electron | `npm run dev` \| `npm run dist` (NSIS .exe) |
| Print Server | `PRINTER_NAME="Printer" node server.js` (port 3456) |
| Checks (root) | `npm test` runs every suite in `scripts/` (what `ci.yml` and the release run); extension logic is tested by lifting functions out of `content.js` (see `scripts/test-extension-*.cjs`) |

## Public website (root React app → the home page of awana.kvbchurch.org)

Built by `site/build.mjs` (`npm run build` here with `SITE_BASE=/`) and served
at the one site's root; the lobby lives under `/lobby`, Journey under
`/journey`, the phone page under `/checkin`. The home page is a capability showcase written for church leadership first
(then other churches and volunteers: the Simulator, Install Guide and FAQ
sit lower down, and the `#install`, `#simulator`, `#faq`, `#features` and
`#how-it-works` anchors must keep resolving). It is one of three "family"
pages with the Check-in Display's and Journey Display's `about.html`.

- **This repo holds the family design system.** `styles/family.css` is the
  canonical stylesheet and `docs/FAMILY-DESIGN.md` its spec
  (`docs/family-reference.html` renders every component). Byte-identical
  copies live at `lobby/public/family.css` and `journey/public/family.css`
  (`scripts/check-mirrors.mjs` fails CI if they drift): change the canonical
  file, copy it over both, and bump the `family.css?v=N` token on both about
  pages.
  Page-only styling goes in `styles/page.css` (`lbl-` prefix).
- **Tailwind v4 is compiled** (`@tailwindcss/vite`, `styles/site.css` with
  `source(none)` + explicit `@source` lines limited to the site's own files).
  No runtime CDN, no import map; icons are the inline SVG sprite in
  `components/family/Icons.tsx`.
- **The Simulator's DOM is a contract.** `#lastCheckin`, `.clubber`,
  `.name` and `.club img` (see `src/constants.ts` DOM_SELECTORS) mirror
  TwoTimTwo's real page, so keep that structure whenever it is restyled.
  Its roster (`data.ts`) is obviously fictional full names on purpose.
- **Claims track the code.** Every sentence must be true of the current
  release; a feature change that the page describes updates the page in the
  same PR. Opt-in features carry a `.fam-card__tag`, the phone's "Not here"
  list is always shown with its safeguards, and the label mocks follow
  `generateLabel()`. Screens are CSS recreations with generic first names
  and no Awana logos or club art; the disclaimer bar, meta description and
  footer carry the not-affiliated line. Links out go only to the two sibling
  about pages, the three repos and this app's own downloads, never to the
  live signage or kiosk roots.

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
`print-server/public/brand/` is a byte-identical
mirror of the canonical kit in `lobby/shared/brand/`, pinned
by `scripts/brand-kit.sha256` and checked by `scripts/test-brand-kit.cjs` (in
`npm test`); take a new kit with `node scripts/gen-brand-manifest.cjs --from
<canonical>`, never by hand (the text files are LF only; `.gitattributes`
keeps them so). `print-server/brand.js` registers Paytone One / Londrina Solid /
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
  surface's `--f-shout` fallback (dashboard, phone, bookmarklet, the status
  window) plus `step-chip.js`'s measuring family; `test-brand-kit.cjs` and
  `test-dashboard-chrome.cjs` fail if they drift. The installer's `/health`
  smoke check still needs 4 loaded fonts (Paytone One, Londrina Solid, Londrina
  Solid Black, Figtree): the number is unchanged.

**One printer: the 4x2 label printer (7.17.0, owner 2026-10-08).** The
receipt-printer trial (Star TSP100 / Rongta, `receipt.js`, printerType
`receipt`/`receipt-usb`, `/receipt/*`, "Printer jammed" and `/jam-reprint`,
`/touch/jam`) was removed for good: do not bring any of it back. `printLabel()`
is `printImage()` on the name tag printer with the backup printer
(`backupPrinter()`) as its only fallback. `RETIRED_PRINTER_KEYS` are ignored,
a backup naming the old `receiptPrinterName` is not used, and POST /config
drops them all. A late child (`lateGoToLine` answers) gets a plain name tag and
the household ONE drop-off label (`dropOffTagFor` / `generateDropOffTag`, once
per family per night) on the label printer. `printerSetupWarnings()` (pure)
judges the setup: `printerUnset`, `printerNotFound`, `printerOffline`
(Get-Printer PrinterStatus), `printerLooksLikeReceipt`; the dashboard and the
status window read offline and receipt-like as PROBLEM.
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

**Realtime privacy:** the screens' channel was a PUBLIC Pusher channel, which
has no server-side authorization primitive, so `checkin`, `recap` and
`birthdays` are sealed with AES-256-GCM before publish (`print-server/events.js`;
consumer half is `lobby/src/lib/envelope.js`). Since 2026-10-03 the screens
listen to the sync Worker's live channel instead and the Pusher keys are
cleared on the dashboard (SWITCH.md); the printer relays every frame to the
Worker (`events.setRelay`, a bounded queue with a breaker, `/health` warns
while it is open) under exactly the same sealing rules, and the Pusher
publisher stays until switch day's cleanup. Rules that must survive any
change, for whichever pipe is on:
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
- Bookmarklet fetches CSV → POST /update-csv
- Server reloads clubbers.csv on every print request
- Enrichment: Match firstName+lastName to allergies (Notes field)

## Reliability Mandates
- **Zero-Loop Policy:** Self-relaunching scripts MUST have recursion guards. Never assume admin checks are bulletproof.
- **Context-Aware:** Batch/PowerShell must account for parent process (CMD vs PowerShell vs Electron).
- **Never Crash:** uncaughtException handlers in server; silent failures for enrichment (print basic label).
- **Cleanup:** Always unlink temp files in finally blocks.
- **Update Safety:** Clear port 3456 before file operations in install-and-run.ps1.
