-- Migration 001: positions by (chapter, fraction), not by CFI.
--
-- The original positions table stored a CFI and a percentage, with both columns
-- NOT NULL and no defaults. The client stores a reading position as
-- `(chapter, fraction)`, because that is what actually survives a reflow: a CFI
-- names a DOM path, and this reader re-renders each chapter from scratch. Keeping
-- the old shape meant the API could not express the position the app has, and
-- every insert failed on the two NOT NULL columns it never supplied.
--
-- SQLite cannot drop or retype a column in place, so the table is rebuilt.
--
-- Applied with:
--   wrangler d1 execute marginalia-v3 --remote --file=src/migrations/001-positions.sql
--
-- Safe to re-run: the rebuild copies with INSERT OR IGNORE, and the old table is
-- dropped only after the new one is populated.

CREATE TABLE IF NOT EXISTS positions_new (
  journal_id  TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  chapter     INTEGER NOT NULL DEFAULT 0,
  fraction    REAL NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (journal_id, book_id)
);

-- Legacy CFI rows are not carried across. A CFI names a DOM path in another
-- engine, so it cannot be mapped to a chapter without guessing; revisiting a book
-- from the start is recoverable, landing someone at the wrong sentence is not.
INSERT OR IGNORE INTO positions_new (journal_id, book_id, chapter, fraction, updated_at)
  SELECT journal_id, book_id, chapter, fraction, updated_at
  FROM positions
  WHERE updated_at IS NOT NULL;

DROP TABLE IF EXISTS positions;

ALTER TABLE positions_new RENAME TO positions;

CREATE INDEX IF NOT EXISTS idx_positions_journal ON positions(journal_id, updated_at);
