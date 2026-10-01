# TwoTimTwo integration — display side

**How the signage + presentation apps relate to TwoTimTwo.com, and the
design decisions that a future change must not accidentally undo.**

This repo **never talks to TwoTimTwo directly.** The print server
(`Print-TwoTimTwo-Labels`) is the *only* producer on the shared Pusher
channel; both pages here are subscribe-only consumers. The canonical, scraped
map of the TwoTimTwo site itself (DOM contract, `/clubber/csv` columns, every
endpoint) lives in that repo at **`docs/TWOTIMTWO.md`** and its in-app
Capabilities & Roadmap page. This file is the display-side companion.

> **Privacy invariant (do not relax):** everything crossing the channel is
> reduced to an allowlist by `src/lib/eventSanitizers.js` before anything sees
> it — first names only, ever. No last names, allergies, contact info, birth
> years, or photos. The shapes are pinned by
> `src/lib/__fixtures__/contract-vectors.json`, which is **byte-identical** to
> the printer repo's canonical `contract-vectors.json` (verified 2026-07-26).

---

## 1. The event contract we consume

Channel `awana-channel`. Each event is reduced to exactly these fields
(`src/lib/eventSanitizers.js`); anything else is dropped before the app sees it.

| Event | Allowlisted fields | Drives |
|---|---|---|
| `checkin` | `firstName`, `club`, `isBirthday`, `isFirstTimer` (+ optional `id`, `at`) | the live check-in celebration banner |
| `recap` | `entries[]` (verbatim checkin shapes with `id`+`at`) | replay of missed check-ins after a reconnect |
| `tally` | `counts` (per-club whole numbers), `total` | game-time scoreboard counts |
| `birthdays` | `entries[]` of `firstName`, `club`, `month` (1–12), `day` (1–31) — **never a year** | this-week birthday celebration |
| `ops` | `type` (`print-failure`\|`canary`\|`selector-fail`), optional `club` | operator status widgets only — never a public banner |
| `canary` | `at`, optional `nonce` | "is the pipe alive" end-to-end test |
| `tonight` | `checkedIn`, `booksCompleted`, `awardsEarned`, `friendsBrought` | the lobby ticker (D-1). Structurally numbers-only. |
| `points` | `groups` (team name → whole points), optional `club` | the projector scoreboard (D-2) |
| `schedule` | optional `nextMeetingDate` (strict `YYYY-MM-DD`), `title`, `noClubThisWeek` | next-meeting advisory (D-3). A malformed date is dropped, never rendered; iCal attendee/organizer data can never ride along. |
| `notice` | `level` (`info`/`warn`/`critical`), `message` | announcement/cancellation alert (D-5). **The only free-text field on the channel** — church-authored copy written for public display, bounded to 200 chars and forced to plain text at BOTH producer and consumer. Never derived from roster data. |

Club names arrive **exactly as the check-in system reports them** — e.g.
`"Sparks "` (trailing space), `"T&T"` (the extension decodes `&amp;`). Each
consumer normalizes on its own:
- **Signage:** `src/lib/clubs.js` `getClubPalette()` — trims, lowercases,
  alias-maps, and covers **all six** clubs (Puggles, Cubbies, Sparks, T&T,
  Trek, Journey) with full art; unknown clubs fall back to Awana-orange so a
  typo still yields a joyful banner.
- **Presentation:** `src/presentation/lib/birthdays.js` `normalizeClub()` —
  see the scope note below.

---

## 2. Club scope: all six clubs (changed in v5.2.0)

**History worth knowing:** the presentation tool used to be scoped to four clubs
(`puggles, cubbies, sparks, tnt`). That looked deliberate — it was consistent
across several files and asserted by tests — but it had a real consequence: a
Trek or Journey child's birthday was **silently dropped and never celebrated**,
because `normalizeClub()` returned `null` for them and `useBirthdays.js` gates on
`e.club in CLUBS`. `shared/theme.json` had defined all six clubs with colors and
art the whole time; only the code was behind.

All six clubs are now recognised. The pieces that must stay in agreement:

- `src/presentation/config.js` and `src/presentation/lib/shared-config.js`:
  `CLUB_IDS` lists all six.
- `normalizeClub()` in `lib/birthdays.js` matches trek and journey (an
  *unknown* club still returns `null` — that case is still asserted).
- `useBirthdays.js` gates on `e.club in CLUBS`, which now includes both.

**The one thing that is still deliberately data-driven, not code-driven:** which
clubs appear in the **game-time scoreboard** comes from `gameWindow.clubs` in
`shared/schedule.json`. Teen clubs are not forced into a game window the church
has not configured — Trek and Journey (grades 6–8 and 9–10, TwoTimTwo `club_id`
6 and 7) often meet outside main-room game time. So: a Trek child is no longer
dropped by the code, while the on-screen game-time roster stays whatever the
schedule says. If a church wants teens on the game-time board, that is a
`shared/schedule.json` edit, not a code change.

Note the signage app (`src/lib/clubs.js`) always covered all six with full art.

---

## 3. Display-side roadmap — all shipped in v5.2.0

Each was grounded in a real TwoTimTwo endpoint from the site map (see the
printer repo's `docs/TWOTIMTWO.md` §5–6). All data flows through the print
server as the sole Pusher producer, so the privacy invariant is intact.

| # | Feature | Source | Where it lives |
|---|---|---|---|
| D-1 | **Lobby "tonight" ticker** — counts of kids in, books finished, awards earned, friends brought | `/clubber/checkin_report` + `/meeting/report?output=csv` → `tonight` event | `src/components/TonightTicker.jsx`. Bottom strip; unmounts while a celebration banner is up; hides when stale or all-zero. |
| D-2 | **Color-team points scoreboard** | `/meeting/colorGroup` → `points` event | `src/presentation/views/ScoreboardView.jsx` + `lib/points.js`. QuickNav-reachable (a points race is a program a church may not run), ranked bars, competition ranking for ties. |
| D-3 | **Calendar-driven next-meeting awareness** | `/calendar/iCal` → `schedule` event | `src/presentation/lib/scheduleAdvisory.js`. Deliberately an **advisory layer**, not a replacement: pure, in-memory, never persisted, never overwrites canonical or device-local data, and an absent/stale broadcast is a complete no-op. `lib/schedule.js` — the highest-risk file here — gained only a `stateKey` case; no time-boundary logic was touched, and the Playwright boundary suite still passes 10/10. |
| D-4 | **Trek & Journey included** | n/a (code) | See §2 — this was fixing a silent drop, not a preference. |
| D-5 | **Cancellation / announcement alert** | `/msg/admin` → `notice` event | `src/components/NoticeBanner.jsx`. A `critical` notice is a full-width top bar above every other layer and renders unconditionally so it also reaches an OBS/ProPresenter feed. Message is rendered as a text child, never `dangerouslySetInnerHTML`, and expires after a few hours so a stale cancellation can't haunt the screen. |

Shared helper: `src/lib/freshness.js` — the repo's recurring "is this realtime
data still worth showing" check, extracted so every consumer ages data out
identically.

Any future feature that would surface a child's photo must gate on the roster's
`Photo Release?` value (see the printer repo) — but note nothing photo-related
can cross the sanitized channel today, and it must stay that way.
