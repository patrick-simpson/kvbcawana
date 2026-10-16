# printer/ decisions and history
Terse, dated. Rules live in `CLAUDE.md`; this is the why. Tests cited pin the behavior.

## Naming and identifiers
- 5.9.0: "Awana Label Printer" -> "Club Label Printer" for Awana Clubs International trademark compliance (`changes.md` 5.9.0). 9.0.0 (owner 2026-10-11): one app, "KVBC Awana".
- `name`/`appId` kept at `awana-label-printer`: electron-builder derives install dir and `userData` from `name` (confirmed in `build-electron.yml`'s CI comment); renaming would orphan every install's data and break the NSIS upgrade-in-place lookup for no user-visible gain. The title-cased `Club Label Printer` data folder in older docs was a doc bug (corrected in the 5.9.0 pass); it never existed.
- Channel `awana-channel`, `AWANA_*`, `X-Awana-Pin`, `window.awana`, `pusherChannel`: internal, not branding, so they never move with a rename.

## The church's logo (owner 2026-10-13)
- Approved logo sheet: the church's own KVBC Awana logo replaces the Awana Clubs mark on the home page (header two-line ink, footer full white), the reel stand-in, the projector miniature (top left, as on the wall), /checkin, and the Windows app (status header, wizard rail). Always one colour by field; minimum widths (full 520, two-line 260, stacked 130 px) because "BAPTIST CHURCH" is a thin weight, so a narrow place takes another version instead of a smaller one: the phone header could not hold 260px beside the count and menu (hence the scrolling band), the wizard's 236px rail takes the stacked one, and the first page had 512px for the full one (needs 520), so it has none. Trademark line word for word, favicons, the app icon, labels and club marks unchanged. The reel film still shows the old mark until `npm run reel` is rerun.

## Releases
- Manual tagging failed repeatedly: sessions' git access is commonly branch-scoped (tag pushes rejected), plus silent footguns (tag name case, a republished release reusing its old tag ref). Hence dispatch-only releases.
- The printer repo used PRs; the owner's rule for this repo is push to `main`. A pushed branch nobody merges is work stranded where the operator cannot see it.
- Update feed is ours (awana.kvbchurch.org/updates/printer/), not GitHub "Latest": Pages cannot host 170 MB installers, so the feed points at release assets.

## KVBC Awana 9.0.0 (owner 2026-10-11, `ROADMAP.md#kvbc-awana-one-app`)
- One Windows app, two roles (print, display). The sound room app (`lobby/desktop`) ends at 2.1.0, which hands the PC over via `handoff.json`.
- Role decision order protects the 8.x check-in laptop: it upgrades to print on / display off / setup done and never sees the wizard.
- Sync protocol is a generated copy because the packaged app has no `lobby/` folder and the asar cannot require print-server.
- Bridge releases before switch day: printer 6.22.0, sound room 1.1.0 (2026-10-01).

## Tonight's count
- Each rule came from a bug. 7.13.0: a shared bogus name (the report's "YES 1 Share 1 Point" cell) merged 11 children into 2, hence id-and-name identity and "two ids are two children". Live 2026-10-03: the report's name is the edit-link cell ([edit] Name [undo]).
- Unregistered visitors are not counted while a report is fresh: owner's decision, they are not on it.
- 7.15.0 (owner): checked out tonight comes off every count; ledger untouched. 7.16.0 (owner 2026-10-08): the still-here list is built here because TwoTimTwo's Checkout page lists nobody at KVBC. 7.16.1: the phone roster used to read only this printer's rows by exact name, so the youth page offered children checked in at the desk or on TwoTimTwo.
- 7.14.0: Remove (local) vs Undo check-in (TwoTimTwo) split; the older extension would answer "Already checked in" ok:true to an undo, hence `?accept=`.

## Printers and tags
- 7.17.0 (owner 2026-10-08): receipt-printer trial (Star TSP100 / Rongta) removed for good; one 4x2 label printer. Late child: the card says GO TO and time, never "late"; owner: nothing singles a child out.
- 7.18.0 (owner 2026-10-08): one-off name tags (`/print-oneoff`); Undo check-in replaced Printer jammed on the touch screen.
- 7.19.0: Linux/CUPS print path for the Raspberry Pi station (`ROADMAP.md#cloud-check-in`); never inferred from the OS because suites run on Linux with a stand-in `powershell`.
- 8.1.0 (owner 2026-10-11): BARF Night; 8.2.0: BARFED tag is the name alone, BARF Bag labels as one job.

## Brand and fonts
- 6.17.0 brand kit; 6.18.0 shout face Paytone One. Owner 2026-09-29: Galindo "looks too much like SpongeBob". OFL Reserved Font Names forbid subset/re-encode, so the kit ships full fonts + a WOFF2 meeting the OFL's WOFF exception; Londrina reserves its name too (its web copies were Latin subsets until the 6.18.0 kit).
- Paytone vs Galindo: draws Ș Ț and precomposed Vietnamese (Galindo did not), still lacks Cyrillic/Greek/CJK and a few Latin (Ewe ɔ). Measured at 'top' baseline: capitals start 0.26 em down, descenders shallower; Ấ rises 0.23 em above origin, the Ș comma hangs to 1.31 em; Ấ line extent 1.19-1.22 em vs the old 1.15 pitch.
- Mark room: first attempt charged the whole room to `blockH` (accented names lost up to a quarter of their size on a crowded label); letting the leftover ride down printed the callout over the chip. Current order: paper, block, size.
- `test-dashboard-chrome.cjs` keeps its name though the dashboard is retired.
- The kit used to be served before the PIN gate for the Wi-Fi phone page's PIN screen; both are gone.

## Realtime
- Pusher replaced by the Worker live channel 2026-10-03; publisher, npm package, `provision` frame, dashboard fields and the app's release-ping client removed 2026-10-12, along with the display login (passphrase state, `buildProvisionFrame`, KDF, `/config/display-login/generate`, vector section). Updates poll the feed every 10 min.
- A bare-string `/health` warning once painted an empty yellow box, hiding the privacy warnings.
- Plaintext with no key is deliberate: an operator who has not opted in must not have banners break on an auto-update.
- Plain `Object.assign` could not delete a key; clearing the old phone PIN once left the old one accepted until restart (why `applySavedConfig()`).

## Online only (owner 2026-10-11, built 2026-10-12)
- Dashboard and Wi-Fi phone page retired (9.1.0); tools moved to awana.kvbchurch.org/settings. With no internet the desk uses the extension and prints; no phones or settings changes until back. Builds on "everything free, forever" (root `CLAUDE.md`, `ROADMAP.md#online-check-in`).
- 8.0.0 (owner 2026-10-11): cloud check-in from the online phone page, Worker answers TwoTimTwo itself.
- P2 (2026-10-12): the print role is an online check-in station; at-most-once printing is an owner rule (a duplicate tag is the worse failure, so unknown outcomes raise CHECK THE PRINTER instead of reprinting). P5: the Worker makes tally/ticker/still-here; station greets because only it has roster and history.

## Public website and reel (owner 2026-10-11)
- Demo reel page in the look of the Awana Clubs 2026-27 catalog, to show off the cool things it does; old family page was 38,648 px tall, new ~5,100. The old "no shape copied from the kit" rule went with the old page.
- Awana marks allowed (owner 2026-10-11) with the trademark line. White on `--c-deep` fails AA (T&T 4.3); kit hot is 3.4, hence `--hot-btn`.
- Container-unit caveat: a container cannot size its own padding in its cq units (they resolve against the viewport), so roots use `%`.
- Reel: 60-90 s film of the screens on a club night, first thing on the site. Pages' static files ignore Range and Safari will not play video without it, so films stream via `site/functions/reel`. Real footage, never mock-ups. Real logos/marks allowed inside the film (in-house use).
