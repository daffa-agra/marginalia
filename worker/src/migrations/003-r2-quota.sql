-- Migration 003: keep R2 inside the free tier.
--
-- R2's free allowance is 10 GB-month of storage, 1M Class A operations (writes,
-- lists) and 10M Class B (reads) per month, with zero egress. Egress is free, so
-- the only two ways to leave the free tier are:
--
--   1. storing more bytes than the allowance, and
--   2. orphaned objects — bytes nobody references, paid for forever.
--
-- Both are prevented here rather than hoped away. `bytes_used` makes a
-- per-journal quota answerable with one row read; `book_files` is the ledger of
-- what exists, so a deleted book's object can be removed by exact key without
-- ever listing the bucket (a list is a Class A operation, and this avoids one per
-- cleanup).
--
-- Applied with:
--   wrangler d1 execute marginalia-v3 --remote --file=src/migrations/003-r2-quota.sql

-- Running total per journal. Kept denormalised so the upload check is one read
-- instead of a SUM over every file row.
ALTER TABLE journals ADD COLUMN bytes_used INTEGER NOT NULL DEFAULT 0;

-- Upload-signing rate limit, in a fixed one-hour window.
--
-- Signing is free on R2, but an unbounded loop of it still burns Worker requests
-- and can fill storage with objects nobody reads. The window is reset lazily on
-- the next request after it expires, so no cron is needed.
ALTER TABLE journals ADD COLUMN upload_signings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE journals ADD COLUMN upload_window_start INTEGER NOT NULL DEFAULT 0;

-- When the cleanup pass last ran, so it can be cheap and idempotent.
ALTER TABLE journals ADD COLUMN gc_at INTEGER;

-- The ledger: one row per book file in R2.
--
-- `delete_after` is the GC marker. When a book is deleted, its row is marked
-- rather than removed, so the cron can delete the exact object by key and then
-- settle the quota. Deleting the row immediately would lose the key and strand
-- the bytes.
CREATE TABLE IF NOT EXISTS book_files (
  journal_id   TEXT NOT NULL,
  book_id      TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  size         INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  delete_after INTEGER,                    -- NULL = live; set = collect this
  PRIMARY KEY (journal_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_book_files_gc ON book_files(delete_after);

-- Files belong to a journal and go with it.
CREATE INDEX IF NOT EXISTS idx_book_files_journal ON book_files(journal_id);
