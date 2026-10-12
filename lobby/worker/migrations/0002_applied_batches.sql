-- Online check-in P6: makes the Worker's outbox safe to retry. Every batch the
-- Worker writes to D1 inserts its own id here FIRST, inside the same atomic
-- D1 batch as its rows and its night_summary deltas. A retry of a batch that
-- already landed hits the primary key, the whole batch rolls back, and the
-- Worker treats that as "already done", so night_summary is never counted twice.
-- id is SHA-256 of the batch's row ids and summary (22 base64url characters).
--
-- Apply with the rest: npx wrangler d1 migrations apply awana-history --remote
CREATE TABLE IF NOT EXISTS applied_batches (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 22),
  at TEXT NOT NULL
) WITHOUT ROWID;
