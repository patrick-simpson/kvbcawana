-- The trends back-fill (owner 2026-10-13; src/trendsimport.js, routes.md
-- section 3): per-night, per-club attendance read from TwoTimTwo's Attendance
-- Summary report (/report/attendance_summary?year_start=...&output=csv), every
-- season it has, so the History section's trends reach back before the desk.
--
-- Numbers only, never a name or an id: the report itself carries none. Kept
-- APART from night_summary (the desk's live counts, added as deltas), so an
-- imported night can never be added to a live one: GET /v1/history/summary
-- answers the live line where one exists for a night and club, else this one.
-- club is the app's club table name (lobby/shared/clubs.js: Puggles, Cubbies,
-- Sparks, T&T, Trek, Journey), the same spelling the live lines carry.
--
-- Apply with the rest: npx wrangler d1 migrations apply awana-history --remote
CREATE TABLE IF NOT EXISTS night_summary_import (
  night       TEXT NOT NULL CHECK (length(night) = 10),
  club        TEXT NOT NULL CHECK (length(club) BETWEEN 1 AND 24),
  attended    INTEGER NOT NULL CHECK (attended BETWEEN 0 AND 2000),
  imported_at TEXT NOT NULL,
  PRIMARY KEY (night, club)
) WITHOUT ROWID;
