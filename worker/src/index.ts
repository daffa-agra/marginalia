/**
 * The API router.
 *
 * Four endpoints, deliberately: one sync, two for files, one to register a key.
 * A REST surface per entity would mean twelve endpoints that each need their own
 * auth, validation and scoping, and twelve chances to forget the `journal_id`
 * filter. One sync endpoint can be made correct once.
 *
 * Everything is scoped by the journal resolved from the key. No endpoint accepts
 * a journal id from the body.
 */

import { hashKey, json, looksLikeKey, timingSafeEqual, unauthorised } from './auth';
import { mergeCollection, toRow } from './sync';
import type { Syncable } from './sync';
import { objectKey, presign } from './r2';
import { isConfigured } from './r2';
import { checkQuota, checkRate } from './quota';

export interface Env {
  DB: D1Database;
  BOOKS: R2Bucket;
  /** Optional pepper; without it the hash is a plain SHA-256 of the key. */
  JOURNAL_PEPPER?: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  /** Allowed browser origins, comma separated. */
  ALLOWED_ORIGINS?: string;
}

/** Sync bodies above this are refused before being read. */
const MAX_SYNC_BODY = 2 * 1024 * 1024;

const DEFAULT_ORIGINS = [
  'https://books.daffagra.my.id',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : DEFAULT_ORIGINS;
  const origin = request.headers.get('Origin') ?? '';
  const permitted = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': permitted,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Journal-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Resolves the journal named by the key, creating it on first contact. */
async function resolveJournal(request: Request, env: Env, create: boolean): Promise<{ id: string; revision: number } | null> {
  const key = request.headers.get('X-Journal-Key');
  if (!looksLikeKey(key)) return null;
  const hash = await hashKey(key, env.JOURNAL_PEPPER);
  const now = Date.now();

  const existing = await env.DB.prepare('SELECT id, revision, key_hash FROM journals WHERE key_hash = ?')
    .bind(hash)
    .first<{ id: string; revision: number; key_hash: string }>();

  if (existing) {
    if (!timingSafeEqual(existing.key_hash, hash)) return null;
    // Cheap liveness stamp; also gives the GC a way to spot abandoned journals.
    await env.DB.prepare('UPDATE journals SET last_seen_at = ? WHERE id = ?').bind(now, existing.id).run();
    return { id: existing.id, revision: existing.revision };
  }

  if (!create) return null;

  // The journal id is opaque and derived from the key hash, so the same key
  // always names the same journal even across a race between two devices.
  const id = `j_${hash.slice(0, 24)}`;
  await env.DB.prepare(
    `INSERT INTO journals (id, key_hash, schema_version, revision, created_at, last_seen_at)
     VALUES (?, ?, 3, 0, ?, ?)
     ON CONFLICT(key_hash) DO NOTHING`,
  )
    .bind(id, hash, now, now)
    .run();

  const created = await env.DB.prepare('SELECT id, revision FROM journals WHERE key_hash = ?')
    .bind(hash)
    .first<{ id: string; revision: number }>();
  return created ? { id: created.id, revision: created.revision } : null;
}

/* ── validation helpers ── */

function badRequest(error: string): Response {
  return json({ error }, 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The R2 signing configuration, or `null` when it has not been set up.
 *
 * Checked explicitly so a missing secret produces "file storage is not
 * configured" rather than a 500 from inside the signer.
 */
function r2Config(env: Env): { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string } | null {
  const config = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  };
  return isConfigured(config) ? config : null;
}

function storageNotConfigured(): Response {
  return json(
    { error: 'File storage is not configured on this server yet. Reading and syncing still work.' },
    503,
  );
}

/** Coerces an untrusted collection into sync records, dropping malformed ones. */
function pickRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => {
    if (!isRecord(item)) return false;
    if (typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 200) return false;
    if (typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt)) return false;
    return true;
  });
}

/* ── handlers ── */

async function handleHello(request: Request, env: Env): Promise<Response> {
  const journal = await resolveJournal(request, env, true);
  if (!journal) return unauthorised();
  return json({ journalId: journal.id, revision: journal.revision });
}

async function handleSync(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  // Reject on the declared length before reading the body: reading it first and
  // then checking would let a client make the Worker buffer megabytes it is about
  // to refuse, which is exactly the CPU/memory budget this endpoint must respect.
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_SYNC_BODY) {
    return badRequest(`Sync body is limited to ${Math.round(MAX_SYNC_BODY / 1024)} kB`);
  }

  const journal = await resolveJournal(request, env, false);
  if (!journal) return unauthorised();

  const text = await request.text();
  if (text.length > MAX_SYNC_BODY) {
    return badRequest(`Sync body is limited to ${Math.round(MAX_SYNC_BODY / 1024)} kB`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return badRequest('Body is not valid JSON');
  }
  if (!isRecord(body)) return badRequest('Body must be an object');

  const since = typeof body.since === 'number' && Number.isFinite(body.since) ? body.since : 0;
  const changes = isRecord(body.changes) ? body.changes : {};
  const incoming = {
    books: pickRecords(changes.books),
    quotes: pickRecords(changes.quotes),
    shelves: pickRecords(changes.shelves),
    positions: pickRecords(changes.positions),
  };

  const conflicts: Array<{ kind: string; id: string }> = [];

  // Read the stored rows the client might collide with, then decide.
  const stored = new Map<string, Syncable>();
  const statements: D1PreparedStatement[] = [];

  for (const kind of ['books', 'quotes', 'shelves', 'positions'] as const) {
    const records = incoming[kind];
    if (records.length === 0) continue;

    if (kind === 'positions') {
      const rows = await env.DB.prepare(
        'SELECT book_id, updated_at FROM positions WHERE journal_id = ?',
      )
        .bind(journal.id)
        .all<{ book_id: string; updated_at: number }>();
      for (const row of rows.results ?? []) {
        stored.set(`${kind}:${row.book_id}`, { id: row.book_id, updatedAt: row.updated_at });
      }
    } else {
      const table = kind;
      const rows = await env.DB.prepare(
        `SELECT id, updated_at, deleted_at FROM ${table} WHERE journal_id = ?`,
      )
        .bind(journal.id)
        .all<{ id: string; updated_at: number; deleted_at: number | null }>();
      for (const row of rows.results ?? []) {
        stored.set(`${kind}:${row.id}`, {
          id: row.id,
          updatedAt: row.updated_at,
          deletedAt: row.deleted_at ?? undefined,
        });
      }
    }

    const current = new Map<string, Syncable>();
    for (const record of records) {
      const key = `${kind}:${record.id}`;
      const existing = stored.get(key);
      if (existing) current.set(String(record.id), existing);
    }

    const outcome = mergeCollection(
      kind,
      current,
      records.map((r) => ({ ...r, id: String(r.id), updatedAt: Number(r.updatedAt) })),
    );
    conflicts.push(...outcome.conflicts);
    for (const record of outcome.writes) {
      const { sql, params } = toRow(kind, journal.id, record);
      statements.push(env.DB.prepare(sql).bind(...params));
    }
  }

  // One revision bump per sync, so `since` is a single number the client tracks.
  const revision = journal.revision + 1;
  statements.push(env.DB.prepare('UPDATE journals SET revision = ? WHERE id = ?').bind(revision, journal.id));

  if (statements.length > 0) {
    // A D1 batch is one transaction: either the whole sync lands or none of it.
    await env.DB.batch(statements);
  }

  // Everything changed since the client's last revision, tombstones included.
  //
  // The `since` filter is on `updated_at`, which is the field the client tracks.
  // It must be applied consistently: filtering books but not quotes meant a
  // client that had already seen a quote was handed it again on every sync.
  const out = {
    books: await env.DB.prepare(
      'SELECT data, deleted_at FROM books WHERE journal_id = ? AND updated_at > ?',
    ).bind(journal.id, since).all<{ data: string; deleted_at: number | null }>(),
    quotes: await env.DB.prepare(
      'SELECT data, deleted_at FROM quotes WHERE journal_id = ? AND updated_at > ?',
    ).bind(journal.id, since).all<{ data: string; deleted_at: number | null }>(),
    shelves: await env.DB.prepare(
      'SELECT id, name, sort_order, created_at, updated_at, deleted_at FROM shelves WHERE journal_id = ? AND updated_at > ?',
    ).bind(journal.id, since).all(),
    positions: await env.DB.prepare(
      'SELECT book_id, chapter, fraction, updated_at FROM positions WHERE journal_id = ? AND updated_at > ?',
    ).bind(journal.id, since).all(),
  };

  return json(
    {
      revision,
      changes: {
        books: (out.books.results ?? []).map((r) => ({
          ...JSON.parse(r.data),
          ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
        })),
        quotes: (out.quotes.results ?? []).map((r) => ({
          ...JSON.parse(r.data),
          ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
        })),
        shelves: (out.shelves.results ?? []).map((r: Record<string, unknown>) => ({
          id: r.id,
          name: r.name,
          sortOrder: r.sort_order,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          deletedAt: r.deleted_at ?? undefined,
        })),
        positions: (out.positions.results ?? []).map((r: Record<string, unknown>) => ({
          id: r.book_id,
          chapter: r.chapter,
          fraction: r.fraction,
          updatedAt: r.updated_at,
        })),
      },
      conflicts,
    },
    200,
    cors,
  );
}

async function handleUploadUrl(request: Request, env: Env): Promise<Response> {
  const journal = await resolveJournal(request, env, false);
  if (!journal) return unauthorised();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body is not valid JSON');
  }
  if (!isRecord(body)) return badRequest('Body must be an object');

  const bookId = typeof body.bookId === 'string' ? body.bookId : '';
  const sha256 = typeof body.sha256 === 'string' ? body.sha256 : '';
  const size = typeof body.size === 'number' ? body.size : 0;

  if (!bookId) return badRequest('bookId is required');
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return badRequest('sha256 must be 64 hex characters');
  if (!Number.isFinite(size) || size <= 0) return badRequest('size must be a positive number');

  const config = r2Config(env);
  if (!config) return storageNotConfigured();

  // ── keep this inside the free tier ──
  //
  // Two reads answer both questions: how much this journal uses, and how much the
  // deployment uses. `bytes_used` is a denormalised running total per journal so
  // the first is one row; the second is a SUM over journals, which is a handful
  // of rows for a personal deployment.
  const usage = await readUsage(env, journal.id);
  const quota = checkQuota({ size, journalBytes: usage.journalBytes, totalBytes: usage.totalBytes });
  if (!quota.allowed) {
    return json({ error: quota.reason, retryable: quota.retryable ?? false }, 413);
  }

  // A re-upload of the same book costs no new bytes: one object, keyed by hash.
  const existing = await env.DB.prepare(
    'SELECT size, sha256 FROM book_files WHERE journal_id = ? AND book_id = ?',
  )
    .bind(journal.id, bookId)
    .first<{ size: number; sha256: string }>();
  if (existing && existing.sha256 === sha256.toLowerCase()) {
    const key = objectKey(journal.id, bookId, sha256);
    const signed = await presign(config, key, 'PUT');
    return json({ url: signed.url, expiresIn: signed.expiresIn, deduplicated: true });
  }

  // Rate limit last, so a refused-by-quota request does not consume the budget.
  const rate = await readSigningRate(env, journal.id);
  const allowed = checkRate(rate);
  if (!allowed.allowed) {
    return json({ error: allowed.reason, retryable: allowed.retryable ?? true }, 429);
  }
  await recordSigning(env, journal.id, rate);

  const key = objectKey(journal.id, bookId, sha256);
  const signed = await presign(config, key, 'PUT');

  // Ledger the object now, before the bytes land. An interrupted PUT then leaves a
  // row pointing at a missing object, which the cleanup pass removes — the reverse
  // (bytes with no row) is the case that would strand storage forever.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO book_files (journal_id, book_id, sha256, size, created_at, delete_after)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(journal_id, book_id) DO UPDATE SET
         sha256 = excluded.sha256, size = excluded.size, created_at = excluded.created_at, delete_after = NULL`,
    ).bind(journal.id, bookId, sha256.toLowerCase(), size, Date.now()),
    env.DB.prepare(
      `UPDATE journals SET bytes_used = (
         SELECT COALESCE(SUM(size), 0) FROM book_files WHERE journal_id = ? AND delete_after IS NULL
       ) WHERE id = ?`,
    ).bind(journal.id, journal.id),
  ]);

  return json({ url: signed.url, expiresIn: signed.expiresIn });
}

/** How many bytes this journal and the whole deployment are storing. */
async function readUsage(env: Env, journalId: string): Promise<{ journalBytes: number; totalBytes: number }> {
  const journalRow = await env.DB.prepare('SELECT bytes_used FROM journals WHERE id = ?')
    .bind(journalId)
    .first<{ bytes_used: number }>();
  const totalRow = await env.DB.prepare(
    'SELECT COALESCE(SUM(bytes_used), 0) AS total FROM journals',
  ).first<{ total: number }>();
  return {
    journalBytes: journalRow?.bytes_used ?? 0,
    totalBytes: totalRow?.total ?? 0,
  };
}

/** Signing counts for the current hour, reset lazily on read. */
async function readSigningRate(env: Env, journalId: string): Promise<{
  signingsThisHour: number;
  windowStartedAt: number;
  now: number;
}> {
  const row = await env.DB.prepare(
    'SELECT upload_signings, upload_window_start FROM journals WHERE id = ?',
  )
    .bind(journalId)
    .first<{ upload_signings: number; upload_window_start: number }>();
  return {
    signingsThisHour: row?.upload_signings ?? 0,
    windowStartedAt: row?.upload_window_start ?? 0,
    now: Date.now(),
  };
}

async function recordSigning(
  env: Env,
  journalId: string,
  rate: { signingsThisHour: number; windowStartedAt: number; now: number },
): Promise<void> {
  const windowMs = 60 * 60 * 1000;
  const fresh = rate.now - rate.windowStartedAt >= windowMs;
  await env.DB.prepare('UPDATE journals SET upload_signings = ?, upload_window_start = ? WHERE id = ?')
    .bind(fresh ? 1 : rate.signingsThisHour + 1, fresh ? rate.now : rate.windowStartedAt, journalId)
    .run();
}

async function handleReadUrl(request: Request, env: Env): Promise<Response> {
  const journal = await resolveJournal(request, env, false);
  if (!journal) return unauthorised();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Body is not valid JSON');
  }
  if (!isRecord(body)) return badRequest('Body must be an object');

  const bookId = typeof body.bookId === 'string' ? body.bookId : '';
  const sha256 = typeof body.sha256 === 'string' ? body.sha256 : '';
  if (!bookId) return badRequest('bookId is required');
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return badRequest('sha256 must be 64 hex characters');

  const config = r2Config(env);
  if (!config) return storageNotConfigured();

  const key = objectKey(journal.id, bookId, sha256);
  const signed = await presign(config, key, 'GET');
  return json({ url: signed.url, expiresIn: signed.expiresIn });
}

/* ── entry point ── */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }

    try {
      switch (url.pathname) {
        case '/api/hello':
          return await handleHello(request, env);
        case '/api/sync':
          await env.BOOKS.head('__warm__').catch(() => null); // touch the binding early
          return await handleSync(request, env, cors);
        case '/api/files/upload-url':
          return await handleUploadUrl(request, env);
        case '/api/files/read-url':
          return await handleReadUrl(request, env);
        default:
          return json({ error: 'Not found' }, 404, cors);
      }
    } catch (err) {
      // Never leak an exception message: it can name tables and internals.
      console.error('request failed', err instanceof Error ? err.stack : err);
      return json({ error: 'Something went wrong' }, 500, cors);
    }
  },
};
