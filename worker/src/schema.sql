-- Marginalia v3 schema.
-- Mirrors docs/READER-DESIGN.md §4.1. Applied with:
--   wrangler d1 execute marginalia-v3 --remote --file=src/schema.sql
--
-- Safe to re-run: every statement is IF NOT EXISTS. An existing database is
-- upgraded by the migrations in src/migrations instead; this file is the
-- fresh-install shape and already includes what they add.

-- One row per journal. Holds the capability key hash and sync bookkeeping.
-- A journal is the unit of ownership: it is named either by a capability key
-- (the original model, still valid) or by a signed-in Google account
-- (migrations/005), which sets `user_id`.
CREATE TABLE IF NOT EXISTS journals (
  id             TEXT PRIMARY KEY,          -- public, opaque
  key_hash       TEXT NOT NULL,             -- SHA-256 hex of the capability key
  schema_version INTEGER NOT NULL DEFAULT 3,
  revision       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  -- Added by migrations/003: the R2 free-tier ledger.
  bytes_used           INTEGER NOT NULL DEFAULT 0,
  upload_signings      INTEGER NOT NULL DEFAULT 0,
  upload_window_start  INTEGER NOT NULL DEFAULT 0,
  gc_at                INTEGER,
  -- Added by migrations/005: the signed-in owner, when the journal belongs to
  -- a Google account rather than a bare key.
  user_id              TEXT
);

-- The key hash must be unique: it is how a journal is found, and the
-- create-on-first-contact insert upserts on it. Declared as a separate index
-- rather than a column constraint because this table may already exist from an
-- earlier schema that lacked it, and `CREATE TABLE IF NOT EXISTS` would silently
-- keep the old definition.
CREATE UNIQUE INDEX IF NOT EXISTS idx_journals_key_hash ON journals(key_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_journals_user ON journals(user_id) WHERE user_id IS NOT NULL;

-- Signed-in readers (migrations/005). The Google subject is the primary key
-- because it is immutable; email and profile fields are display data.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,     -- Google subject (`sub`), immutable
  email         TEXT,
  name          TEXT,
  picture       TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

-- Server-side half of a login. Only `SHA-256(token)` is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- Carries the PKCE verifier between /api/auth/start and /api/auth/callback.
CREATE TABLE IF NOT EXISTS oauth_states (
  state          TEXT PRIMARY KEY,
  code_verifier  TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

-- Shelves. updated_at/deleted_at make renames and deletions sync like any
-- other record; the manual order is part of the record. Composite primary key
-- for the same reason as books: a shelf id is only unique within one journal.
CREATE TABLE IF NOT EXISTS shelves (
  id          TEXT NOT NULL,
  journal_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  -- Set to the journal's revision at write time. `updated_at` is a client
  -- clock and cannot order a server-side incremental sync; `seq` can.
  -- See migrations/004.
  seq         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (id, journal_id),
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE
);

-- Books. `shelf_id` is the whole of shelf membership: one book, one shelf, and
-- ON DELETE SET NULL means deleting a shelf can never take a book with it.
--
-- The primary key is (id, journal_id), not id alone. Record ids are generated on
-- the client, so two journals can hold the same id; with a global primary key the
-- second journal's write would match the first's row and be rejected by the
-- `updated_at` guard, silently losing the record. See migrations/002.
CREATE TABLE IF NOT EXISTS books (
  id          TEXT NOT NULL,
  journal_id  TEXT NOT NULL,
  shelf_id    TEXT,
  data        TEXT NOT NULL,               -- JSON: the client Book record
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  seq         INTEGER NOT NULL DEFAULT 1,  -- see migrations/004
  PRIMARY KEY (id, journal_id),
  FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE,
  FOREIGN KEY (shelf_id) REFERENCES shelves(id) ON DELETE SET NULL
);

-- Quotes (marginalia). Columnar where the client needs it to sort or filter,
-- JSON for the rest because that shape is still evolving.
CREATE TABLE IF NOT EXISTS quotes (
  id          TEXT NOT NULL,
  journal_id  TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  data        TEXT NOT NULL,               -- JSON: text, note, anchor, percent
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  seq         INTEGER NOT NULL DEFAULT 1,  -- see migrations/004
  PRIMARY KEY (id, journal_id),
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
  seq         INTEGER NOT NULL DEFAULT 1,  -- see migrations/004
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

-- The R2 ledger (migrations/003): one row per book file in the bucket.
-- `delete_after` marks a deleted book's bytes for the nightly GC pass, so a
-- delete can stay undoable for a week without stranding storage.
CREATE TABLE IF NOT EXISTS book_files (
  journal_id   TEXT NOT NULL,
  book_id      TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  size         INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  delete_after INTEGER,
  PRIMARY KEY (journal_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_book_files_gc ON book_files(delete_after);
CREATE INDEX IF NOT EXISTS idx_book_files_journal ON book_files(journal_id);
