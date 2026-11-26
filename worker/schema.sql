-- Marginalia v3 — D1 schema (READER-DESIGN §4.1, §4.1a).
-- Applied via:  wrangler d1 execute marginalia-v3 --remote --file=worker/schema.sql
-- Journals hold the capability-key hash only; the key itself never leaves the device.

CREATE TABLE IF NOT EXISTS journals (
  id             TEXT PRIMARY KEY,
  key_hash       TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 3,
  revision       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS books (
  id          TEXT PRIMARY KEY,
  journal_id  TEXT NOT NULL,
  shelf_id    TEXT,
  data        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE,
  FOREIGN KEY (shelf_id) REFERENCES shelves(id) ON DELETE SET NULL
);

-- Entries are columnar because they are queried by book and date; books,
-- quotes and shelves carry a JSON payload because their shape is still
-- evolving and D1 gains nothing from splitting never-filtered fields.
CREATE TABLE IF NOT EXISTS entries (
  id          TEXT PRIMARY KEY,
  journal_id  TEXT NOT NULL,
  book_id     TEXT,
  text        TEXT NOT NULL,
  on_date     TEXT,
  page        INTEGER,
  cfi         TEXT,
  percent     REAL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotes (
  id          TEXT PRIMARY KEY,
  journal_id  TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  data        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS positions (
  journal_id  TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  cfi         TEXT NOT NULL,
  percent     REAL NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (journal_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_books_journal   ON books(journal_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_books_shelf     ON books(journal_id, shelf_id);
CREATE INDEX IF NOT EXISTS idx_entries_journal ON entries(journal_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_quotes_journal  ON quotes(journal_id, updated_at);
