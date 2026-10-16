-- Who came on each club night, for /checkin's "Not here the last two club
-- nights" (owner 2026-10-15; src/recent.js). One row per (night, child seen),
-- the child as a KEYED HASH that is the same every night (identityTag under
-- the Worker's state key with a fixed date in place of the night): never a
-- clubber id or a name. Rows older than 70 days are deleted by the cron.
--
-- Apply with the rest: npx wrangler d1 migrations apply awana-history --remote
CREATE TABLE IF NOT EXISTS seen_nights (
  night TEXT NOT NULL CHECK (length(night) = 10),
  tag   TEXT NOT NULL CHECK (length(tag) BETWEEN 16 AND 64),
  PRIMARY KEY (night, tag)
) WITHOUT ROWID;
