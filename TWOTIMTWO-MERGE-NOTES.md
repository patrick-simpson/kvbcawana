# TwoTimTwo merge notes: facts from lobby/docs/TWOTIMTWO.md

For the owner to merge into `printer/docs/TWOTIMTWO.md` (printer/ was not
edited). `lobby/docs/TWOTIMTWO.md` is deleted in the same change. Its
event-contract table is already in `lobby/CONTRACT.md`, and its endpoint
facts are already in the printer doc (§2, §3, §5, §6, §8), so only these
are unique to it:

## Club scope (changed in display v5.2.0, 2026-07)

- The presentation tool was once scoped to four clubs (puggles, cubbies,
  sparks, tnt). Trek (club_id 6) and Journey (club_id 7) birthdays were
  silently dropped because `normalizeClub()` returned null for them.
  All six clubs are now recognised.
- The game-time scoreboard is still data-driven: which clubs appear comes
  from `gameWindow.clubs` in `lobby/shared/schedule.json`, not from code.
  Teen clubs often meet outside game time, so a church opts them in by
  editing that file.
- Club names arrive exactly as TwoTimTwo reports them (`"Sparks "` with a
  trailing space, `"T&T"` after decoding `&amp;`). Each consumer trims,
  lowercases and alias-maps on its own. The signage's `getClubPalette()`
  falls back to orange for an unknown club.

## Which TwoTimTwo report feeds which display feature

| Display feature | TwoTimTwo source | Channel event |
|---|---|---|
| Lobby "tonight" ticker (kids in, books finished, awards, friends brought) | `/clubber/checkin_report` plus `/meeting/report?output=csv` | `tonight` |
| Colour-team points scoreboard | `/meeting/colorGroup` | `points` |
| Next-meeting advisory | `/calendar/iCal` (`text/calendar`) | `schedule` |
| Cancellation / announcement alert | `/msg/admin` | `notice` |

The next-meeting advisory is advisory only: pure, in memory, never
persisted, and an absent or stale broadcast does nothing.

## Rules the display side relies on

- `notice` is the only free-text field on the channel. It is church-authored
  copy, capped at 200 characters and forced to plain text at both the
  producer and the consumer. It is never built from roster data.
- A child's photo may only be shown when the roster's `Photo Release?`
  value allows it. Nothing photo-related crosses the sanitised channel today.
- Display data goes stale on purpose: `src/lib/freshness.js` is the one
  "is this realtime value still worth showing" check every consumer uses.
