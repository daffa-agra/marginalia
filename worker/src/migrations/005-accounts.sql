-- Migration 005: accounts.
--
-- The journal moves from "whoever holds the key" to a signed-in reader, the way
-- Google Play Books ties a library to an account rather than to a device. The
-- capability key stays valid — existing devices keep syncing with it unchanged —
-- but a Google account can now own a journal, and the client can reach it with
-- a session token instead of a key.
--
-- `users` is the Google identity: the immutable `sub` claim is the primary key,
-- because email addresses can change and reassign while a subject never does.
-- `sessions` holds the server-side half of a login: only `SHA-256(token)` is
-- stored, so a copy of the database does not hand anyone a working session.
-- `oauth_states` carries the PKCE verifier between /api/auth/start and
-- /api/auth/callback so the code exchange never trusts a client round trip.
--
-- Applied with:
--   wrangler d1 execute marginalia-v3 --remote --file=src/migrations/005-accounts.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,     -- Google subject (`sub`), immutable
  email         TEXT,
  name          TEXT,
  picture       TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,       -- SHA-256 hex of the opaque bearer token
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- One row per sign-in attempt, deleted on use. Short-lived by construction.
CREATE TABLE IF NOT EXISTS oauth_states (
  state          TEXT PRIMARY KEY,
  code_verifier  TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

-- Who owns a journal. NULL for the legacy key-only journals, which keep working.
ALTER TABLE journals ADD COLUMN user_id TEXT;

-- One journal per account. A partial index: legacy journals have NULL here and
-- would otherwise crowd the uniqueness the account path relies on.
CREATE UNIQUE INDEX IF NOT EXISTS idx_journals_user ON journals(user_id) WHERE user_id IS NOT NULL;
