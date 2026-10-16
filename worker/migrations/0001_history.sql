-- Online check-in history (ROADMAP.md#online-check-in, P0). Cloudflare D1,
-- binding HISTORY_DB (free plan: 5 GB, 5 million row reads and 100,000 row
-- writes a day; a club night writes a few hundred rows).
--
-- Every child's name lives ONLY inside history_rows.ct: an ECIES seal made by a
-- CLIENT to the history public key (lobby/shared/cloud-crypto.js sealRow), so
-- neither the Worker nor Cloudflare can read it at rest. The Worker stores what
-- it is handed and never decrypts. No ledger blob table: rows only.
--
-- Apply (the owner or CI; Claude sessions do not create Cloudflare resources):
--   npx wrangler d1 create awana-history
--   (paste the database_id into the commented [[d1_databases]] block in
--    wrangler.toml and uncomment it)
--   npx wrangler d1 migrations apply awana-history --remote
--
-- Never edit an applied migration: add 0002_*.sql.

-- One sealed row: a check-in, an undo, a check-out, a visitor, a friend
-- brought (BARF), a print. id is random (16 bytes, base64url, 22 characters),
-- never a clubber id; night is the church's LOCAL date (America/New_York,
-- YYYY-MM-DD), never UTC; kind is plaintext on purpose (counts by kind are
-- already public in the tally). The row's time is inside ct.
-- v, kid, epk, iv, ct are the sealed wire form {v, kid, epk, iv, ct}; the
-- AAD binds id, night, kind, epk and kid, so a row moved or relabelled will
-- not open.
CREATE TABLE IF NOT EXISTS history_rows (
  id    TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 22),
  night TEXT NOT NULL CHECK (length(night) = 10),
  kind  TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 32),
  v     INTEGER NOT NULL,
  kid   TEXT NOT NULL CHECK (length(kid) = 16),
  epk   TEXT NOT NULL,
  iv    TEXT NOT NULL,
  ct    TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS history_rows_night ON history_rows (night);

-- Plaintext aggregates per night and club: numbers only, never a name. The
-- same counts the plaintext `tally` already publishes to every screen.
CREATE TABLE IF NOT EXISTS night_summary (
  night       TEXT NOT NULL CHECK (length(night) = 10),
  club        TEXT NOT NULL,
  checked_in  INTEGER NOT NULL DEFAULT 0,
  checked_out INTEGER NOT NULL DEFAULT 0,
  undone      INTEGER NOT NULL DEFAULT 0,
  prints      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (night, club)
) WITHOUT ROWID;
