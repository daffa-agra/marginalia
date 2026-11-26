-- Marginalia v3 schema.
-- Mirrors docs/READER-DESIGN.md §4.1. Applied with:
--   wrangler d1 execute marginalia-v3 --remote --file=src/schema.sql
--
-- Safe to re-run: every statement is IF NOT EXISTS.

-- One row per journal. Holds the capability key hash and sync bookkeeping.
-- There is no user table on purpose: a journal *is* the unit of ownership, and
-- the key hash is its only credential.
CREATE TABLE IF NOT EXISTS journals (
  id             TEXT PRIMARY KEY,          -- public, opaque
  key_hash       TEXT NOT NULL UNIQUE,      -- SHA-256 hex of the capability key
  schema_version INTEGER NOT NULL DEFAULT 3,
  revision       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL
);

-- Shelves. updated_at/deleted_at make renames and deletions sync like any
-- other record; the manual order is part of the record.
CREATE TABLE IF NOT EXISTS shelves (
  id          TEXT PRIMARY KEY,
  journal_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);

-- Books. `shelf_id` is the whole of shelf membership: one book, one shelf, and
-- ON DELETE SET NULL means deleting a shelf can never take a book with it.
CREATE TABLE IF NOT EXISTS books (
  id          TEXT PRIMARY KEY,
  journal_id  TEXT NOT NULL,
  shelf_id    TEXT,
  data        TEXT NOT NULL,               -- JSON: the client Book record
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE,
  FOREIGN KEY (shelf_id) REFERENCES shelves(id) ON DELETE SET NULL
);

-- Quotes (marginalia). Columnar where the client needs it to sort or filter,
-- JSON for the rest because that shape is still evolving.
CREATE TABLE IF NOT EXISTS quotes (
  id          TEXT PRIMARY KEY,
  journal_id  TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  data        TEXT NOT NULL,               -- JSON: text, note, anchor, percent
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);

-- Reading positions. One row per book, keyed that way rather than by a
-- synthetic id, because "where am I in this book" has exactly one answer.
CREATE TABLE IF NOT EXISTS positions (
  journal_id  TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  chapter     INTEGER NOT NULL,
  fraction    REAL NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (journal_id, book_id),
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);

-- Reading is looked up by journal+recency; the sync query filters on updated_at.
CREATE INDEX IF NOT EXISTS idx_books_journal   ON books(journal_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_books_shelf     ON books(journal_id, shelf_id);
CREATE INDEX IF NOT EXISTS idx_quotes_journal  ON quotes(journal_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_quotes_book     ON quotes(book_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_shelves_journal ON shelves(journal_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_positions_journal ON positions(journal_id, updated_at);
