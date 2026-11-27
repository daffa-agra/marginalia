-- Migration 002: record ids are unique *within a journal*, not globally.
--
-- Every table keyed records by a bare `id PRIMARY KEY`. Ids are generated on the
-- client (`b-mwxx…`, `s1`), so two journals can easily hold the same id — and
-- when they did, the upsert's conflict target matched the other journal's row and
-- its `updated_at` guard silently rejected the write. The record appeared to save
-- and then never came back. Shelves hit this first because their ids are short
-- and often literally `s1`.
--
-- The fix is the identity the app actually has: (id, journal_id). SQLite cannot
-- alter a primary key in place, so each table is rebuilt.
--
-- Applied with:
--   wrangler d1 execute marginalia-v3 --remote --file=src/migrations/002-composite-ids.sql

CREATE TABLE IF NOT EXISTS books_new (
  id          TEXT NOT NULL,
  journal_id  TEXT NOT NULL,
  shelf_id    TEXT,
  data        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (id, journal_id),
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO books_new (id, journal_id, shelf_id, data, updated_at, deleted_at)
  SELECT id, journal_id, shelf_id, data, updated_at, deleted_at FROM books;
DROP TABLE IF EXISTS books;
ALTER TABLE books_new RENAME TO books;

CREATE TABLE IF NOT EXISTS quotes_new (
  id          TEXT NOT NULL,
  journal_id  TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  data        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (id, journal_id),
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO quotes_new (id, journal_id, book_id, data, updated_at, deleted_at)
  SELECT id, journal_id, book_id, data, updated_at, deleted_at FROM quotes;
DROP TABLE IF EXISTS quotes;
ALTER TABLE quotes_new RENAME TO quotes;

CREATE TABLE IF NOT EXISTS shelves_new (
  id          TEXT NOT NULL,
  journal_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (id, journal_id),
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO shelves_new (id, journal_id, name, sort_order, created_at, updated_at, deleted_at)
  SELECT id, journal_id, name, sort_order, created_at, updated_at, deleted_at FROM shelves;
DROP TABLE IF EXISTS shelves;
ALTER TABLE shelves_new RENAME TO shelves;

CREATE INDEX IF NOT EXISTS idx_books_journal    ON books(journal_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_quotes_journal   ON quotes(journal_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_shelves_journal  ON shelves(journal_id, updated_at);
