-- Migration 004: incremental sync needs a server-side write sequence.
--
-- The sync's read-back filtered rows with `updated_at > since`, where `since`
-- is the journal's revision counter. But `updated_at` is a client clock in epoch
-- milliseconds, and the revision is a small integer: after a device's first
-- sync, `since` was 1 while every record's `updated_at` was around 1.7e12, so
-- *everything* came back on *every* sync. The response grew with the journal and
-- the "only what changed" promise was false.
--
-- `updated_at` cannot be trusted for this: it is written by whichever device
-- edited the record, and clocks disagree. The filter needs a number the *server*
-- assigns in the same transaction as the write, and that it can hand out
-- monotonically. That is `seq`: the journal's revision, plus one, at the moment
-- the row is upserted.
--
-- Existing rows are backfilled to 1. Every client that had synced before this
-- migration already holds all rows (the echo bug guaranteed it), and its
-- revision is 1 or more, so `seq > since` correctly sends nothing to a client
-- that is up to date, while a brand-new device starting at `since = 0` still
-- receives the whole journal.
--
-- Applied with:
--   wrangler d1 execute marginalia-v3 --remote --file=src/migrations/004-seq.sql

ALTER TABLE books     ADD COLUMN seq INTEGER NOT NULL DEFAULT 1;
ALTER TABLE quotes    ADD COLUMN seq INTEGER NOT NULL DEFAULT 1;
ALTER TABLE shelves   ADD COLUMN seq INTEGER NOT NULL DEFAULT 1;
ALTER TABLE positions ADD COLUMN seq INTEGER NOT NULL DEFAULT 1;
