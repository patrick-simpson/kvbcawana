# Settings overhaul (spec, owner decisions 2026-10-12; ships before club night Wed 2026-10-14)

Machine-oriented. Wire/route truth: `lobby/worker/src/routes.md` section 10 (this file
never restates a shape it defines). Rules that hold throughout: root `CLAUDE.md`
"Everything free" (10 ms CPU per Worker request, no key work in the Worker),
`CLAUDE.md` "Privacy invariant" (first names only, names sealed end to end,
one sanitizer per event), contract/envelope vectors printer-canonical first, at-most-once
printing unchanged (`routes.md` section 6), `CLAUDE.md` config-write rules.
Line numbers are `origin/main` at `da64825`. Section 9 of `routes.md`
(`YM_CHECKOUT`, branch `worker-ymcheckout`) is assumed merged before Track A starts.

*2026-10-16 (KVBC Awana 10.0.0): the Chrome extension, the laptop relay, the `/phone/*`
routes, the attendance audit and `/checkin/classic` are gone, and the classic rail is
removed. Mentions of them below are the spec as written; the notes in brackets say what
changed.*

User: the owner, alone, from a phone or home PC (awana.kvbchurch.org/settings). TVs keep
their own Settings panel with a reduced rail.

## 1. The rail

| # | id | Label | Blurb | Page | TV's own panel | Screen opened from Screens |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `tonight` | Tonight | Live count, printer, switches, notice | yes | yes (this screen's connection + tonight) | yes (`ScreenOverviewSection`, as today's `status`) |
| 2 | `screens` | Screens | Every TV, projector, kiosk, computer | yes | no | no |
| 3 | `show` | What screens show | Welcomes, celebrations, pickup, corner | yes | yes | yes |
| 4 | `look` | Slides & look | Slides, calendar, background, season | yes | yes | yes |
| 5 | `printing` | Printing | Labels, name tags, schedule, BARF Night | yes | no | no |
| 6 | `history` | History | Trends, nights, import | yes | no | no |
| 7 | `account` | Account & app | Sign-in, passphrase, KVBC Awana | yes | yes (+ Export / Import / Reset / Debug) | no |

`settingsSections.js`: `SECTIONS` = the seven; `sectionsFor(page, {remote})` = page: all
seven; TV: `tonight, show, look, account`; remote: `tonight, show, look`.
`openingSection`: page = `account` until signed in, else `tonight`; TV = `account` when it
cannot work (not signed in / no key), `tonight` when anything is wrong, else `show`.
`LEGACY_TABS` (old ids still resolve): `status`→`tonight`, `checkins`→`show`,
`slides`→`look`, `screen`→`show`, `celebrations`→`show`, `pickup`→`show`,
`setup`→`account`, `laptop`→`printing`, `connection`→`account`, `background`→`look`,
`banners`→`show`, `display`→`show`, `calendar`→`look`. Every copy string naming an old
section ("Settings → Setup", "→ Slides", "→ Screen & corner", "→ Laptop", "→ Status") is
rewritten (`CLAUDE.md` rename rule; grep `lobby/src`, `journey/`, `printer/print-server`
error strings, `printer/chrome-extension` options/popup copy [the extension was deleted 2026-10-16]).

Kill switch for the rail (`?rail=classic`, or localStorage `awanaSettingsRail.v1 =
'classic'`): removed 2026-10-16, with the old section components. `LEGACY_TABS` still
maps the old tab ids to the new sections.

## 2. Section → card → control (old location → new)

Store: **S** shared settings (`SHARED_SPEC`, `PUT /v1/settings`), **C** church settings
(Worker, routes.md 10.3), **W** Worker route, **D** this device's overrides, **R** a
registered screen's own (`SCREEN_SPECS`), **L** the print server on localhost, **live**
the live channel in this browser.

### 2.1 Tonight

| Card | Controls / content | Old location | Store | Shown |
| --- | --- | --- | --- | --- |
| Sign-in & connection | page: signed in or not (link to Account); TV: realtime, sync, names lines | Status → Connection (`StatusSection.jsx:228-242`) | — | all |
| Mission control (new) | running count per club (club chips, big total, source + report age), last 5 check-ins (first name + club chip, time), print station(s) (name, last seen, printer state), CHECK THE PRINTER count + "I looked at it" (at the laptop only: `POST /cloud/print-status/clear`), last TwoTimTwo read (ok / error / signed out / blocked), youth check-out line (checked out / pending / failed), "Open the desk" link `/desk` | — | W `GET /v1/tonight/overview` + live (section 5) | page |
| Calendar & phase | right now (`PHASE_WORDS`), calendar preview, published slides line, Refresh calendar now | Status → Tonight (`StatusSection.jsx:244-256`) | — | all |
| Alerts | `statusProblems()` + overview-derived: CHECK THE PRINTER, no station in 2 min while the window is open, TwoTimTwo read error / login blocked, dead jobs, YM failures, history outbox `pending > 0`, church settings not applied by the station (`churchRev < rev` for 2 min) | Status alerts (`StatusSection.jsx:177-222`) | — | all (overview ones page only) |
| Online check-in switches (new) | three toggles `CLOUD_PRINT` "Print TwoTimTwo-page check-ins", `SINGLE_PUBLISHER` "The service runs the screens' count and pickup list", `YM_CHECKOUT` "Check out Trek and Journey automatically (7:15 pm)"; each shows default + "changed by <device>, <when>"; confirm dialog lists the Worker's `warnings`; "Back to default" per switch; Advanced fold: `CHURCH_SETTINGS`, `NOTICES`, `CHANGE_LOG`; Test TwoTimTwo sign-in | Setup → Cloud check-in (`SetupSection.jsx:121-127`, `fields.jsx:507-537`) | W `GET/PUT /v1/switches` | page |
| Notice to every screen (new) | level (Info / Heads up / Urgent = info/warn/critical), message (200, counter), how long (15 min, 30 min, 1 h, 2 h, 4 h; `durationMin`), Send (confirm for critical), current notice with "Take it down" | — | W `POST/DELETE /v1/notice` | page |
| Recent changes | last 5 change-log entries, Undo on undoable ones, "All changes" → Account | — | W `GET /v1/changes` | page |
| About this screen | build, self-update line | Status → About (`StatusSection.jsx:273-283`) | — | TV |

### 2.2 Screens (unchanged section, wording only)

`screens.jsx` as today. Wording: computer rows "print server" → "Prints labels"
(`screens.jsx:127`, `:180`); "Setup → Shared settings is off" → "it keeps its own values
(Account & app → Church-wide settings is off)" (`screens.jsx:294`).

### 2.3 What screens show

| Card | Controls | Old location | Store | Shown |
| --- | --- | --- | --- | --- |
| Simplified mode | switch | Screen & corner (`ScreenSection.jsx:22-29`) | D local | TV |
| Welcome banners | name seconds, birthday/first-timer seconds, Preview a check-in (TV / remote action) | Check-ins (`CheckinsSection.jsx:22-41`) | S | all |
| Welcome extras | first arrival, birthday-week ribbon, club colour wash | Check-ins → Extras (`:43-68`) | S | all |
| Club lines | one line per club | Check-ins → Club lines (`:70-99`) | S | all |
| Celebrations | room milestone, club milestone, books list, awards list | Celebrations (`CelebrationsSection.jsx`) | S | all |
| Pickup board | count down in corner, names-at-or-below guard, stale minutes; "Which clubs: Printing → Pickup list" link; demo on this TV (TV / remote) | Pickup board (`PickupSection.jsx:21-81`) | S | all |
| Corner | wall clock, counter (+ correction note), corner weather; weather location + units in a fold | Screen & corner → Corner, Weather (`ScreenSection.jsx:31-86`) | S | all |
| This TV | chime, keep awake, club count, numbers strip, confetti, reduce motion, connection sticker | Screen & corner → This TV (`ScreenSection.jsx:88-139`) | D / R | TV, remote (hidden on the page: `scope="screen"`, not `keep`) |

### 2.4 Slides & look

| Card | Controls | Old location | Store | Shown |
| --- | --- | --- | --- | --- |
| Preview the promos | buttons | Slides (`SlidesSection.jsx:52-74`) | — | TV |
| Background | source radio, upload, embed URL, seconds per slide | Slides → What plays behind the names (`:76-143`) | D / R | TV, remote |
| Slides | Edit slides…, follow published slides (TV/remote), Forget received deck (TV) | Slides → Typed & published (`:145-158`); Setup → Publishing slides' forget button (`SetupSection.jsx:103-118`) | D / W | all (`keep`) |
| Calendar slides | calendar-aware, welcome wording, three slide toggles, season promos, calendar source fold | Slides → Calendar slides (`:160-205`) | S | all |
| Season (ONE control) | select: Auto (calendar), None (classic), every skin in `SKIN_TABLE`; line "Tonight: <skin> (why)" | Look & season → Season (`LookSection.jsx:7-30`) AND Laptop → Club night → Screen season (`laptop.jsx:443-449`) | S `nightTheme` + `followPrinterTheme` and C `seasonTheme` (below) | all (C part page only) |
| Weather effects | particles, weather mood | Look & season (`LookSection.jsx:32-53`) | S | all |
| Just for fun | April Fools | Look & season (`:55-63`) | S | all |

Season mapping (one control, two writes, no wire change): Auto → S `{nightTheme: 'auto',
followPrinterTheme: true}` + C `{seasonTheme: 'auto'}`. None → S `{nightTheme: 'none'}` + C
`{seasonTheme: 'off'}`. Skin X → S `{nightTheme: X}` + C `{seasonTheme: inverse
PRINTER_SEASON_TO_SKIN[X] or 'off'}` (a pinned skin beats the printer season on screens
already; the C half keeps the tally's `season` consistent for anything else reading it).
The TV's own panel writes only S (no C access needed: it is signed in, so it MAY write C;
it does not, to keep one writer of `seasonTheme` per press: the page). The select's value is
derived from S `nightTheme` alone.

### 2.5 Printing (works from anywhere; one "At the laptop" card for what needs localhost)

| Card | Controls | Old location | Store | Notes |
| --- | --- | --- | --- | --- |
| Labels | label footer, visitor black palette, trophy band, connect card, auto on first-ever check-in, greeting, "Let the check-in laptop's Chrome extension check children in on TwoTimTwo directly (desk clicks, phone Undo and Check out)" | Laptop → Labels (`laptop.jsx:330-357`) | C | `enableDrivenCheckin` kept (section 3, item 4) [2026-10-16: the switch is hidden; the key stays in the church table, read by nothing] |
| Each club's label | club select, six toggles, name size cap; Save | Laptop → Labels → TemplateEditor (`laptop.jsx:230-299`) | C `labelTemplates` | preview image only when the laptop is reachable (`GET /preview`); elsewhere "Preview on the check-in laptop" |
| Club night schedule | rows, add/remove, late grace; Save | Laptop → Club night (`laptop.jsx:414-442`) | C `schedule`, `lateGraceMin` | |
| Pickup list | six club boxes | Laptop → Pickup list (`laptop.jsx:402-413`) | C `pickupClubs` | |
| BARF Night | nights (date list add/remove), Show tonight's list, Print BARF Bag labels | Setup → Cloud check-in → BARF Night (`SetupSection.jsx:128-130`); `church-config.json` `barfNights` (no UI before) | C `barfNights`; W `GET /v1/cloud/friends`, `POST /v1/cloud/barf-bags` (unchanged) | |
| Tonight's prints | tonight's history rows (unlock with the passphrase, as History does), Reprint per row | Laptop → Tonight's prints (`laptop.jsx:456-500`) | W `GET /v1/history/rows?night=` (sealed, opened in the browser) + `POST /v1/print/reprint` (bundle sealed in the browser to every station, record `{route: '/reprint', body: {name, clubberId}, source: 'settings'}` + a `reprint` history row via `POST /v1/history/rows`) | lists what reached D1 (desk, station-printed TwoTimTwo-page and phone jobs); an extension-only print is not there: "At the laptop" still has the laptop's own list |
| Name tags | leader tag (typed name + club), one-off tag, custom label | Laptop → Name tags (`laptop-tools.jsx:221-235`) | W `POST /v1/print/reprint` with a tool record `{route: '/print-leader' \| '/print-oneoff' \| '/print-custom', body}` (sealed in the browser; `JOB_PULL_ROUTES` already allow them; job id `reprint:<uuid>`) | remembered leaders list + Forget from anywhere: C `leaders` (section 4; moved from the laptop's `leaders.json`, owner 2026-10-12) |
| At the laptop | collapsed until opened (probes `http://localhost:3456/health` on open only, as today); then: This laptop (status, warnings, Print a test label, Run diagnostics, Clear print queue, Rehearsal mode, Play test tune, print failures), CHECK THE PRINTER clear, Printers (tag + backup, musical printer, update beacon), label preview, Reprint a stretch, Attendance audit [removed 2026-10-16 with its server routes], This laptop's sign-in (only when the print server is signed out) | Laptop (`laptop.jsx:96-228`, `502-579`; `laptop-tools.jsx:237-410`) | L | not found: one line "Open this page on the check-in laptop for the printer itself" |

Before the seed (`GET /v1/church/settings` `rev: 0`): the C cards are read-only with "Waiting
for the check-in laptop to send its settings (KVBC Awana 9.3.0)" and one button "Start from
defaults instead" (`fromDefaults: true`, confirm). `paused` (`CHURCH_SETTINGS` off): C cards
read-only, "Paused: change these at the laptop", and At the laptop shows today's localhost
editors for those keys (the print server accepts them again, section 4).

Each C card saves on change (toggles) or Save (typed, schedule, templates) with `baseRev`;
409 `stale` → reload the doc, re-apply the card's unsaved edits, show "Someone else changed
this a moment ago; check and save again".

### 2.6 History

| Card | Old location | Notes |
| --- | --- | --- |
| Trends, Nights | History (`history.jsx`) | unchanged |
| Import laptop history (new card) | tray only; `POST /cloud/import-history` (L) | at the laptop: button; elsewhere: "Open on the check-in laptop" |

### 2.7 Account & app

| Card | Controls | Old location | Shown |
| --- | --- | --- | --- |
| Sign in / Connect this screen | sync sign-in, sign out; TV: screen name, use as template | Setup → Connect this screen / Sign in (`SetupSection.jsx:70-92`) | all |
| Passphrase | change passphrase; sign-in security line from `GET /v1/cloud/status` `auth` ("New sign-in (v2) on; old sign-ins: last seen <when>, allowed / off") | Setup (`fields.jsx:382-431` `ChangePassphraseField`) | page, TV |
| This device (new) | device name for the change log (`awanaDevice.v1` `{id, name}`, default "<browser> on <OS>") | — | page |
| Church-wide settings | follow switch | Setup → Shared settings (`SetupSection.jsx:22-52`) | TV, remote (the page always follows) |
| Change log (new) | 50 newest, "Older", Undo, filter by kind | — | page |
| KVBC Awana | download for Windows, first-run note, release notes (`ReleaseNotesField`, retitled "KVBC Awana release notes") | Setup → KVBC Awana for Windows + Release notes (`SetupSection.jsx:134-186`) | all |
| This screen's tools | Debug panel, Export, Import, Reset tonight's counter, Reset this screen | Setup → Tools (`SetupSection.jsx:140-169`) | TV |
| About | trademark line | Status → About | all |

## 3. Removals (file:line at `da64825`)

| # | What | Where | Note |
| --- | --- | --- | --- |
| 1 | Display login field | `lobby/src/components/settings/fields.jsx:149-258` (`DisplayLoginField`); `sections/SetupSection.jsx:78` (the `!viaSync` branch); `sections/StatusSection.jsx:152-163` (`loginLine`), `:234` (Display login row) | `shared/sync.json` always names the service; `useDisplayLogin.js` stays (projector, `SettingsPanel.jsx:156-158` `keyed`) |
| 2 | Display key paste fold | `SetupSection.jsx:79-91`; `fields.jsx:626-719` (`DisplayKeyField`); `StatusSection.jsx:94-101` hints naming "Advanced" / "print server" | `INSECURE_CONTEXT_COPY` (`fields.jsx:22`) stays (sync sign-in uses it) |
| 3 | Publish token (field, card, laptop fold) | `fields.jsx:721-795` (`PublishTokenField`); `SetupSection.jsx:99-102` (card body; the forget-deck button moves to Look → Slides); `laptop.jsx:2`, `:10`, `:80-94` (`ConnectCard` fold; keep the lead line), `:503-525` (token state: proof = sync session only) | `lib/publishToken.js` stays (logout clears it; `App.jsx:591` non-sync fallback untouched). Print server keeps accepting a token (no Track B change) |
| 4 | "Allow driven check-ins from phones" | `laptop.jsx:345-346` | **NOT removed (verified)**: it still gates the extension's direct TwoTimTwo post on desk clicks (`printer/chrome-extension/content.js:712`, `:5108`) and the phone page's Undo / Check out through the laptop (`printer/print-server/server/phone-routes.js:183`, `:242`); `/phone/checkin` (`:342`) is the old relay path. Reworded, moved to Printing → Labels as C `enableDrivenCheckin`; dies with the extension (P7) [done 2026-10-16: hidden everywhere, acted on by nothing; the key stays] |
| 5 | "Other screens" links | `StatusSection.jsx:258-271`, import `:7` | |
| 6 | Duplicate season | `LookSection.jsx:7-30` + `laptop.jsx:24-28`, `:395-398`, `:443-449` | one Season control (2.4) |
| 7 | Duplicate sign-in | `laptop-tools.jsx:370-410` (`SyncSignInCard`) shown always | shown only when the print server reports signed out, inside At the laptop |
| 8 | Duplicate send-shared button on the page | `SetupSection.jsx:38-48` | TV only |
| 9 | Stale "Cloud check-in" card | `SetupSection.jsx:121-132` ("Being built… only watches") | its parts move to Tonight / Printing |
| 10 | Tools on the page | already hidden (`SetupSection.jsx:140`) | TV only, in Account |

Stale wording (replace, one commit per file group; glossary: "print server" / "printer app"
→ "the check-in laptop" (the computer) or "KVBC Awana" (the app); "dashboard" → gone (say
where the control is now); "Club Label Printer" → "KVBC Awana"; "phone page" → "phone
check-in (awana.kvbchurch.org/checkin)"; "shared settings" → "church-wide settings"; "sync
service" stays only in Account's technical lines, elsewhere "the church's sign-in"):

- "dashboard": `PickupSection.jsx:26`; `fields.jsx:121` (comment), `:197`, `:199`, `:708-711`; `laptop.jsx:15` (comment)
- "Club Label Printer": `SetupSection.jsx:135`; `fields.jsx:611`
- "phone page": `laptop.jsx:345`; `laptop-tools.jsx:393`
- "print server": `StatusSection.jsx:94-101`, `:156`, `:168`; `SetupSection.jsx:12`, `:46`, `:88`; `fields.jsx:185-199`, `:722`; `laptop-tools.jsx:159`; `PickupSection.jsx:31`; `screens.jsx:127`, `:180`; `lib/printServer.js:99`, `:109-110`, `:136` (user-visible strings only)
- "shared settings": `SetupSection.jsx:29`, `:34`; `SettingsPanel.jsx:549`; `fields.jsx:113-114`; `screens.jsx:294`
- section paths ("Setup →", "Laptop on awana.kvbchurch.org/settings"): `StatusSection.jsx:16`, `:19`, `:94-98`, `:123`, `:184`, `:233`; `SettingsPanel.jsx:551`; printer error strings `phone-routes.js:184`, `:243`, `:343` ("→ Laptop → Allow driven check-ins" → "→ Printing → Labels") (Track B)

A vitest (`settingsCopy.test.js`, Track C) fails on `/dashboard|Club Label Printer|print server|shared settings/i` in user-visible strings under `src/components/settings/**` and `SettingsPanel.jsx` (comments excluded).

## 4. Laptop settings into the Worker (church settings)

Keys moving (exact list = routes.md 10.3 `CHURCH_SPEC`): `labelFooter`, `firstTimerInverted`,
`trophyBand`, `connectCard`, `connectCardAutoFirstTimer`, `connectCardGreeting`,
`enableDrivenCheckin`, `labelTemplates`, `schedule`, `lateGraceMin`, `pickupClubs`,
`seasonTheme`, `barfNights`, `leaders` (owner 2026-10-12: the remembered leaders, today
the print server's `leaders.json` behind `/leaders` + `/leaders/forget`, move here so
`/checkin`'s leader-tag chips work from any phone; rows `{firstName, lastName, clubName,
lastPrintedAt, printCount}`, adult volunteers' names only, at most 80, one per
name; the station seeds it from `leaders.json` and, on apply, writes `leaders.json` (its
`rememberLeader` / `forgetLeader` then edit the Worker copy with `baseRev`); a remember or
forget from a phone is a church edit of the whole `leaders` list, logged like any other).
Staying per laptop (config.json only, At the laptop): `printerName`, `backupPrinterName`,
`cupsMedia`, `musicalPrinter` (TSPL hardware), `updateBeacon`, `worksheetPrinter`; never on
the page: `checkinUrl`, `historyRetentionDays`, `fleetConfigUrl`, `SECRET_CONFIG_KEYS`.

Station side (`printer/print-server/church-sync.js`, new; started by `server.js` after the
sync sign-in, for every signed-in print server, station or not):

1. **Fetch.** At start (5 s after sign-in), whenever `GET /v1/print/next`'s `church.rev` or
   `church.switchesRev` is above the applied one (stations: within ~5 s), and every 60 s
   when not a station: `GET /v1/church/settings`.
2. **Precedence.** Worker value > config.json for a key the Worker doc HAS; a key the doc
   lacks keeps config.json's. Not signed in / Worker unreachable / `paused` / config.json
   `churchSync: false` (local last resort, never written by any UI) → config.json alone, as
   today.
3. **Apply** (only when `rev` > applied rev): `sanitizeChurch` (generated copy), then the
   SAME per-key cleaning POST /config uses (refactor `config-routes.js:158-336` into
   `cleanChurchPatch(next, body)`; `labelTemplates` through `tags.sanitizeLabelTemplates`,
   `schedule` through the `/config/schedule` row cleaner `config-routes.js:346-351`,
   `pickupClubs` through `pickup.normalizePickupClubs`, `seasonTheme` through
   `SEASON_KEYS`); one `writeConfigFile(next)` (tmp + fsync + rename + `.bak`) +
   `applySavedConfig(next)`; then `stillHereChanged()` if `pickupClubs` changed,
   `sendStationExtras(true)` if `seasonTheme` / `pickupClubs` changed, `publishTally()` if
   `seasonTheme` changed and not single-publisher. `barfNights` lands in config.json (already
   wins over `church-config.json`, `tags.js:105-107`). Applied state in
   `church-applied.json` `{rev, switchesRev, appliedAt}` (`saveFileAtomic`). A key the
   print server's cleaner refuses keeps its config.json value and raises `/health` warning
   `{type: 'church-settings', message}`.
4. **Offline fallback.** config.json always holds the last applied values (write-through),
   so a restart with no internet prints exactly as last night. Printing never waits on this
   module (fail open: errors are logged and warned, never thrown into a print path).
5. **First run (migration).** `GET` answers `rev: 0` → `PUT /v1/church/settings {seed: true,
   settings}` with config.json's church part (`schedule` = `ledger.scheduleRows()` only if
   config.json has its own rows; `barfNights` = config.json's else `church-config.json`'s);
   201 → applied rev 1 (no file write needed: same values); 200 `already` → fetch and
   apply. Only a station seeds (route auth `station`). A station whose first fetch came
   before it was a station seeds when `configureCloud()` runs and on every lease while the
   doc is still empty. A rev BELOW the applied one (the doc lost, or "Start from defaults"
   after a loss) never deletes a config.json key: its keys apply with no deletion, and a
   station sends the keys the doc lacks back on the edit route (`baseRev`; the doc's own
   keys still win), logged.
6. **One writer.** While church sync is active (signed in, not paused, applied rev ≥ 1), a
   SETTINGS-PAGE request (`req.settingsPage`) to POST /config, `/config/schedule` or
   `/config/label-templates` that touches a church key answers 409 `{reason:
   'church-managed', error: 'This is a church-wide setting now: change it under Printing.'}`.
   The extension's and Electron's own writes are unaffected [the extension is gone since 2026-10-16].
7. **Switch-aware gates.** The fetched `switches` are kept in memory: `publishers.js:50`,
   `:97`, `:110` gate on `cloudStation && switches.SINGLE_PUBLISHER === 'on'` (a runtime
   off makes the station publish the tally and still-here list again within ~5 s);
   `canary.js` (after the `worker-ymcheckout` merge, its `/config/church` hand-off) sets
   `ymCheckout.enabled: false` only when `cloudStation && switches.YM_CHECKOUT === 'on'`.
   Unknown (never fetched) = today's behaviour.
8. **Report.** Heartbeat adds `version` (app version) and `churchRev` (applied rev);
   `/health` adds `church: {rev, appliedAt, source: 'worker' | 'config', paused}`.

## 5. Mission control data flow

```
TwoTimTwo ─(watcher, 1 read/5 s clock)─▶ Worker DO ──GET /v1/tonight/overview (10 s poll, session)──▶ /settings Tonight
                                          │  counts, codes, station names, switch values, notice, last change
                                          │
station ─heartbeat {printer, version, churchRev}─▶│
                                          └─ live channel /v1/live (sealed checkin/recap/checkout, plaintext tally/tonight/ops/notice)
                                                 ▼
                       /settings App: useSocket (the ONLY socket) → decrypt in browser → sanitizers → missionFeed
```

- Count: overview `count.byClub` (Worker's `authoritativeTonight`), ticked between polls by
  the live `tally` frame (`counts`), whichever `at` is newer.
- Last check-ins: `checkin` and replayed `recap` frames, decrypted in this browser with the
  display key it got at sign-in, through `sanitizeCheckin` / `sanitizeRecap`: first name +
  club + `at` only; ring of 5, newest first, deduped by id; `oneOff` shown with a "tag" chip.
  In React state only: never localStorage, never sent anywhere; cleared on sign-out and
  when the page is hidden for 30 min. `App.jsx` in settings-page mode passes a `missionFeed`
  sink (configure-mode handlers stay no-ops for the stage); `useSocket.js` remains the only
  file opening the socket (`privacyGuard.test.js`).
- Printer state / CHECK THE PRINTER / stations / TwoTimTwo read / YM / switches / notice /
  changes: overview only.
- Calendar / phase: the props `SettingsPanel` already gets (`calendar`, `phase`).
- Pure reducer `src/lib/missionControl.js` (`reduceMission(state, {type, payload})`,
  `alertsFrom(overview, now)`), tested; the card is presentational.

## 6. Live TV preview

`src/components/settings/TvPreview.jsx` (Track C), settings page only, ≥ 1200 px wide: a
sticky right column (360 px) beside the pane; narrower: a "Preview" toggle strip at the top
of `show` / `look` (off by default). Not on a TV's own panel, not in configure mode.

- A fixed 1600×900 stage scaled to the column (`.slide-card-frame` precedent,
  `app.css:655-667`: `--lobby-u: 16px`, `transform: scale(w / 1600)`), inside
  `ZeroAnimationContext.Provider value={true}` so every `M` element renders its last
  keyframe (the zero-animation rule makes that the finished frame), `pointer-events: none`,
  `aria-hidden`, plus one `role="img"` label describing it.
- Real components, fed the panel's draft `form` (not saved values): `CatalogScene still`
  with `sceneForSkin(resolveSkin(form.nightTheme, today, tonightTitle))`, `SlideCopy` of a
  sample slide (or the first published slide); then by focus: `welcome` → `CheckInMoment`
  with a made-up name (`SAMPLE_NAMES`) and `form.clubPhrases`; `pickup` → `CheckoutBoard`
  with `decideBoard({demo: true, namesAbove: form.checkoutBoardNamesAbove})` (the
  `PickupSection.jsx:12-18` preview, moved here); `corner` → `CornerChip` for clock / tally /
  weather as enabled; `notice` → `NoticeBanner` with the composer's draft. Focus = the card
  the pointer or keyboard focus is in (`data-preview` on `PanelCard`), default `slide`.
- Sample names only (`demoNames.js`), never mission-control names.
- Fallback: an error boundary around the stage; on any throw it renders a static CSS
  miniature (the `printer/components/home/Screens.tsx` approach, re-drawn in lobby CSS:
  wave, plate, first name, corner chip) and logs once.
- Kill: `?preview=0`; the boundary also hides it after two throws.

## 7. Notice and change log

Notice (routes.md 10.4): Tonight card composes `{level, message, durationMin}` → `POST
/v1/notice`; the Worker publishes a plaintext `notice` (it is church-authored copy, not
child data; the contract keeps it unsealed) on the live channel, replayed to late joiners
with the time left; screens hide it `durationSec` after receipt; "Take it down" =
`DELETE /v1/notice`. Screen side (Track C): `sanitizeNotice` keeps `durationSec` (int
0..14400, else dropped); `noticeShowing(notice, now)` uses `min(durationSec * 1000,
NOTICE_MAX_AGE_MS)` from the receive stamp; `0` clears (`clearNotice`). Contract vectors:
`printer/contract-vectors.json` `events.notice.optionalFields: ["durationSec"]` + one valid
vector with it + one dirty (`durationSec: -5` dropped), then copy byte-identical to
`lobby/src/lib/__fixtures__/contract-vectors.json`.

Change log (routes.md 10.5): every write path logs who (device name), when, which keys,
before/after; Undo on Tonight's Recent changes and Account's Change log calls `POST
/v1/changes/<seq>/undo`; 409 `changed-since` → "Changed again since; nothing undone".
The page sends `X-Device` / `X-Device-Name` on every Worker call (`syncRequest` gains them;
screens send their screen id + name; Track C). Bounded: 200 entries, ≤ 2 KB each, 10 + 20
storage keys.

## 8. Build tracks (disjoint file ownership)

Order: Track A's first commit is `lobby/shared/churchSettings.js` + its test (API in
routes.md 10.3); B and C stub against that API until it lands. All three branch from main
after `worker-ymcheckout` is merged.

### Track A: Worker

Owns: `lobby/worker/**` (src, test, `wrangler.toml`, `README.md`, `src/routes.md` BUILT
marks), `lobby/shared/churchSettings.js`, `lobby/shared/churchSettings.test.js`.

- `src/device.js` (10.1 header parse), `src/switches.js` (10.2: store, effective-env
  wrapper, routes), `src/church.js` (10.3), `src/notice.js` (10.4 routes, gate, replay
  rewrite), `src/changes.js` (10.5 ring, undo dispatcher), `src/overview.js` (10.6); each
  mounted with one line in `SyncCore` (registry); `sync.js`: `rawEnv` / effective env,
  `switches.load()` in `handle` / `alarm` / `cron`, log hooks in `putSettings`,
  `putSlides`, `putTemplate`, `putJourney`, `changePassphrase`, `screenRoute`,
  `livePublish` notice gate, `replayFrames` notice rewrite; `checkinRoutes.js`:
  `/v1/print/next` `church` field, heartbeat `version` / `churchRev` →
  `stations.touch`; `stations.js`: keep `version`, `churchRev`.
- `wrangler.toml`: comment "stored switches override these defaults (routes.md 10.2)",
  add `SWITCHES_STORED = "on"`; leave the three online values as they are.

### Track B: print server + Electron

Owns: `printer/print-server/**`, `printer/electron-app/**`, `printer/scripts/test-*.cjs`
(new + edited), `printer/package.json`, `printer/changes.md`, `CLAUDE.md`, version
files via `bump-version.cjs` (9.3.0), and the two root generator lines
(`scripts/shared-copies.mjs` entry for `churchSettings.js`, `scripts/check-mirrors.mjs`).

- `church-sync.js` (section 4), generated `churchSettings.js`; `server/config-routes.js`
  (`cleanChurchPatch` refactor, 409 `church-managed`); `server/station.js` (start sync,
  extras on apply); `server/publishers.js` + `server/canary.js` (switch-aware gates);
  `job-puller.js` (read `church` from `/v1/print/next`, expose `onChurch(rev,
  switchesRev)`; heartbeat `version`, `churchRev`); `server/updates.js` `/health` `church`;
  `server/phone-routes.js:184`, `:243`, `:343` wording. Electron: no behaviour change
  (version bump; optional tray line "Printing settings from awana.kvbchurch.org (rev n)").
- Release 9.3.0 (`printer-release.yml`) by Tuesday 2026-10-13 evening.

### Track C: lobby settings UI (+ the screen side of `notice.durationSec`)

Owns: `lobby/src/**` (not `worker/`), `lobby/e2e/**`, `CLAUDE.md`, `ROADMAP.md`
"Settings page" status lines, `printer/contract-vectors.json` (the `notice` entry only) and
`lobby/src/lib/__fixtures__/contract-vectors.json`.

- `lib/settingsSections.js`, `components/SettingsPanel.jsx`, new
  `components/settings/sections/{TonightSection,ShowSection,LookSection,PrintingSection,AccountSection}.jsx`
  (the old section files' shared cards stay; the classic-only section wrappers were removed 2026-10-16), `settings/{TvPreview,MissionControl,SwitchesCard,NoticeCard,ChangeLogCard,ChurchCards,AtTheLaptop}.jsx`,
  `lib/{missionControl,churchClient,deviceId,toolJobs}.js` (`toolJobs` seals via
  `shared/cloud-crypto.js` `sealForStations`, reseals on 409 `stations-changed` up to 3
  times, as `site/desk/desk-transport.js` does), removals and wording (section 3),
  `lib/syncService.js` device headers, `lib/screenSync.js` device headers, `App.jsx`
  `missionFeed`, `lib/eventSanitizers.js` + `components/NoticeBanner.jsx` (`durationSec`).

### Interfaces between tracks

| From → to | Interface | Defined in |
| --- | --- | --- |
| A → B, C | `churchSettings.js` API (`CHURCH_SPEC`, `CHURCH_KEYS`, `sanitizeChurch`, `mergeChurch`, `CHURCH_JSON_MAX`) | routes.md 10.3 |
| A ↔ B | `GET/PUT /v1/church/settings`, `/v1/print/next` `church`, heartbeat `version` / `churchRev`, `switches` in the church answer | routes.md 10.2, 10.3 |
| A ↔ C | `/v1/switches`, `/v1/church/settings`, `/v1/notice`, `/v1/changes`, `/v1/tonight/overview`, `X-Device` headers | routes.md 10 |
| A → screens (C) | `notice` frame with `durationSec` | routes.md 10.4, contract vectors |
| B → C | localhost: 409 `{reason: 'church-managed'}`; `/health` `church` | section 4 |
| none | no new localhost route: `SETTINGS_PAGE_ROUTES` unchanged | `printer/print-server/security.js:185-224` |

## 9. Test plan

Track A (`npx vitest run --config worker/vitest.config.js`, root `npm run lint`):
switches: default from env, stored override, `default` deletes, stale rev, `SWITCHES_STORED
off`, a flip changes `adopt.on` / `core.singlePublisher` / `ym.enabled` in the same request,
reload after a restart (new `SyncCore`, same storage) before the first alarm, warnings;
church: shared vectors (`churchSettings.test.js`: every rule, junk, sizes), seed first-writer
wins, edit merge with `null` delete, stale 409, not-seeded 409, `fromDefaults`, 413,
paused 503, doorbell, `print/next` `church` field; notice: build, 400s, gate drops the
laptop's notice while current and passes it after expiry, replay rewrites `durationSec` /
drops expired, take-down publishes `durationSec: 0` and deletes replay; change log: bucket
math and wrap at 200, `logv` big befores, 2 KB cap, undo per kind (happy, changed-since,
already-undone, gone, not-undoable), logging failure does not fail the write, `CHANGE_LOG
off`; overview: shape, and a test that no test child name or clubber id appears in any of
the new routes' JSON (seed state with names, grep the answers); CPU: no `crypto.subtle`
call in the new modules (source scan). `printer/scripts/test-cloud-e2e.cjs` stays green
(run by Track B).

Track B (`cd printer && npm test`): new `scripts/test-church-sync.cjs`: seed when empty
(station only), apply newer rev writes config.json atomically (+ `.bak`) and the live
config, precedence (missing key keeps config.json), offline start reads config.json,
cleaner refusal keeps old value + `/health` warning, pickup change → `stillHereChanged` +
extras, season change → extras + tally, `paused` and `churchSync: false` stop applying,
409 `church-managed` from the settings page only (extension / loopback no-Origin writes
pass); `test-settings-page.cjs` updated for the 409; `test-station-greeting.cjs` /
`test-cloud-e2e.cjs`: `SINGLE_PUBLISHER` runtime off → station publishes tally + still-here,
on → silent; `YM_CHECKOUT` gate on `/config/church`; `test-job-puller.cjs`: `church` field
read, heartbeat carries `version` + `churchRev`; `check-mirrors.mjs` passes; electron
`npm run test:app`.

Track C (`npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build`, `npm run
e2e`): `settingsSections.test.js` (rail per surface, legacy ids, opening section),
`settingsCopy.test.js` (stale words), `missionControl.test.js` (first names only, ring of
5, dedupe, cleared on sign-out, nothing in localStorage), `eventSanitizers.test.js` +
contract vectors (`durationSec`), `NoticeBanner` duration / `0` clears, `churchClient.test.js`
(baseRev, stale retry keeps unsaved edits), `toolJobs.test.js` (record shapes, reseal on
`stations-changed`), `TvPreview.test.jsx` (renders under zero animation, fallback on throw,
sample names only), `privacyGuard.test.js` still passes (one socket);
e2e: `settings-page.spec.js` (new rail), new `settings-tonight.spec.js` (stubbed `/api`
overview + live frames: count, last names, switch confirm with warnings, notice send/take
down, undo), `settings-printing.spec.js` (C cards, not-seeded state, stale 409),
`settings-laptop.spec.js` (At the laptop), `settings-screens.spec.js`, `embedded.spec.js`
unchanged. Visual baselines: only via `lobby-update-snapshots.yml` if a signage screenshot
moved (it should not: the preview is settings-page only).

## 10. Wednesday risks and kill switches

Deploy plan: A (Worker) and C (site) merge and deploy Tuesday 2026-10-13 by 6 pm Eastern;
B released as 9.3.0 Tuesday (the laptop updates within 10 min, seeds the church doc on
first sync). NO Worker deploy on Wednesday (a deploy drops every screen's socket); no site
deploy between 4:30 and 9:30 pm Wednesday.

| Piece | Risk | Kill switch (no deploy unless noted) |
| --- | --- | --- |
| Runtime switches | a flip with a 9.2.0 station: `SINGLE_PUBLISHER` off leaves nobody publishing; `YM_CHECKOUT` off leaves nobody sweeping until the TwoTimTwo tab reloads | each switch "Back to default" (= `wrangler.toml`); Worker warns `station-old` / `ym-tab-reload`; deploy kill `SWITCHES_STORED = "off"` |
| Church settings | a bad apply prints wrong labels; seed from a wrong config.json | `CHURCH_SETTINGS` off (stations stop applying; config.json keeps the last applied values; page edits refused); laptop-local `churchSync: false`; undo the change in the log |
| Season single control | two writes, one fails | each write is independent and logged; Look shows the S value, Printing the C value; fix by pressing again |
| Notice | owner notice stuck on screens | "Take it down"; `NOTICES` off stops new ones; worst case the 4 h ceiling |
| Notice `durationSec` wire | old screens ignore it | additive optional; take-down re-sends the same text, never a new one |
| Change log | storage growth / write latency | `CHANGE_LOG` off; fixed 30 keys max; logging never fails a write |
| Mission control | poll load, names leak | overview has no names (test); poll stops after 3 failures; `?mission=0` hides the card; names only in React state |
| TV preview | crash or jank on the page | error boundary → static miniature; `?preview=0` |
| New rail | owner cannot find a control | the `?rail=classic` kill switch was removed 2026-10-16; `LEGACY_TABS` keep old deep links working |
| Tool jobs from anywhere (name tags, reprint) | duplicate tags | at-most-once journal per jobId unchanged; each press mints ONE `reprint:<uuid>` (button disabled until answered); confirm before sending |
| Removed publish-token fallback | the laptop page cannot prove itself without a sync session | sign in under Account (the page's sync session is the proof); the print server still accepts a stored token |

## 11. Reorganize (2026-10-12/13, owner: "full reorganize, logical and easy to use"; plus the Journey section)

Decided without a plan step (owner). What a volunteer needs on a club night
comes first, what is set once comes later. Nothing changed what a setting does
or its stored key / wire name; section ids, `LEGACY_TABS` are unchanged (`?rail=`, `awanaSettingsRail.v1` and the classic rail were removed 2026-10-16). Section and card
names that other pages cite were kept (Printing → Labels, Printing → At the
laptop, Printing → Pickup list, What screens show → Pickup board, Account &
app → Sign in / Church-wide settings). Card order is pinned by
`lobby/src/components/SettingsPanel.rail.test.jsx` ("the reorganized
sections"); no card title is used twice on the page (same test).

### 11.1 The rail (page: all eight; a TV: Tonight, What screens show, Slides & look, Account & app; a screen opened from Screens: Tonight, What screens show, Slides & look)

| # | id | Label | Blurb | Moved |
| --- | --- | --- | --- | --- |
| 1 | `tonight` | Tonight | Live count, problems, notice to screens | |
| 2 | `printing` | Printing | Reprints, name tags, labels, schedule | up from 5th: reprints and name tags are club-night tools |
| 3 | `screens` | Screens | Every TV, projector, kiosk and computer | |
| 4 | `show` | What screens show | Welcomes, celebrations, pickup, corner | |
| 5 | `look` | Slides & look | Slides, calendar, background, season | |
| 6 | `journey` | Journey | Captions, teaching slides, saved lessons | NEW (page only) |
| 7 | `history` | History | Trends, past nights, import | |
| 8 | `account` | Account & app | Sign-in, passphrase, the Windows app | |

### 11.2 Section → cards (page; TV-only cards in brackets)

- **Tonight**: [its alerts] · *Sign in first* (only while signed out; signed
  in, the header pill already says so, so the old always-on "Sign-in &
  connection" line left the page) · Needs a look (moved first: something to
  act on) · Tonight at a glance · Notice to every screen (moved up: a club-night
  action) · Schedule and calendar (was "Calendar & phase": "phase" is jargon) ·
  Recent changes · Online check-in switches (moved last: set once, risky to
  touch). [TV: its alerts · Sign-in & connection · Schedule and calendar · About
  this screen.]
- **Printing**: the church-document gate (only when it has something to say) ·
  Tonight's prints · Name tags and labels (both moved to the top: used on club
  nights) · BARF Night (a few nights a year) · Labels · Each club's label · Club
  night schedule (was "Club night": it is the schedule and the late grace) ·
  Pickup list · At the laptop (collapsed, needs this computer).
- **Screens**: summary · one card per kind (Lobby TVs, Projectors, Journey
  kiosks, Computers), each row with its status line and its own settings in
  the row. A Journey kiosk's row no longer repeats its download switches: it
  points at Journey → Lessons on the Journey PCs (one place per control).
  "How a screen shows up" now says where each kind signs in (a Journey kiosk:
  its Settings → Sync).
- **What screens show**: [Simplified mode] · Welcome banners · Welcome extras ·
  Club lines · Celebrations · Pickup board · [Preview] · Corner (weather
  location and units in its fold) · [This TV]. Unchanged order; plain words:
  "needs a display key" → "needs the screen to be signed in", "the printer's
  live per-club counts" → "the check-in desk's live count for each club".
- **Slides & look**: [Preview the promos] · [What plays behind the names] ·
  Typed & published slides · Calendar slides · Season · Weather effects (its
  hint now names where the weather location is: What screens show → Corner) ·
  Just for fun. Unchanged order.
- **Journey** (NEW, owner 2026-10-12: the kiosk's own Settings "really live in
  the master settings page"): Captions (show captions, text size, dark
  backdrop) · Teaching slides (auto-advance, the three extras; tonight's
  bullets stay on the kiosk) · Lessons on the Journey PCs (every kiosk:
  progress in words and as a bar, Start / Pause / Resume / Stop / Delete
  downloaded lessons with a confirm, disabled while the kiosk is off, checking
  or unable to save; "Download lessons automatically" and "Include Leader
  Videos" per kiosk). Captions and Teaching slides carry an "Every Journey
  kiosk" tag. Wire: `lobby/worker/src/routes.md` 10.8. The kiosk's own panel
  keeps every control (the fallback at the PC); the lesson picker and the
  bullet editor stay only there (owner's choice).
- **History**: Trends · Nights · Import laptop history. Unchanged.
- **Account & app**: Sign in · Passphrase · This device · Change log · KVBC
  Awana for Windows · KVBC Awana release notes · About. [TV: Connect this
  screen · Passphrase · Church-wide settings · KVBC Awana cards · This
  screen's tools · About.] Unchanged.

### 11.3 Left alone on purpose

Section names (printer docs, print-server error strings and the extension cite
"Printing → …"), every stored key and wire name, the classic rail (removed 2026-10-16, as planned), the TV's own panel order (a TV opens on
What screens show and its emergency switch, Simplified mode, stays first), the
TV preview (Tonight, What screens show, Slides & look only), "Typed &
published slides" (a radio label of the same words is test-pinned), and the
online check-in switch titles (the owner's own words).
