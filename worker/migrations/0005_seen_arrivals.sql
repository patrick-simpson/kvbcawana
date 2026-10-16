-- When each child was first seen on a club night, for /checkin's "usually
-- arrives first" family order (owner 2026-10-15; src/recent.js). Minutes after
-- local midnight (Eastern), only for the night the watcher saw live: a night
-- filled afterwards from TwoTimTwo's report has no times (NULL). Same keyed
-- hash rows as 0004, no id or name. Rows now kept 300 days (a whole season;
-- 0004 says 70).
--
-- Apply with the rest: npx wrangler d1 migrations apply awana-history --remote
ALTER TABLE seen_nights ADD COLUMN at INTEGER CHECK (at IS NULL OR at BETWEEN 0 AND 1439);
