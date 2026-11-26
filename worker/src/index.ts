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

/** Bodies larger than this are refused before parsing. */
const MAX_SYNC_BODY = 2 * 1024 * 1024;
/** Per-book cap, matching the client's EPUB guard. */
const MAX_BOOK_BYTES = 100 * 1024 * 1024;

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
  const journal = await resolveJournal(request, env, false);
  if (!journal) return unauthorised();

  const text = await request.text();
  if (text.length > MAX_SYNC_BODY) return badRequest('Sync body is too large');

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
  const out = {
    books: await env.DB.prepare(
      "SELECT data, deleted_at FROM books WHERE journal_id = ? AND updated_at > ? AND updated_at <= ?",
    ).bind(journal.id, since, Date.now()).all<{ data: string; deleted_at: number | null }>(),
    quotes: await env.DB.prepare(
      "SELECT data, deleted_at FROM quotes WHERE journal_id = ? AND updated_at > ? AND updated_at <= ?",
    ).bind(journal.id, since, Date.now()).all<{ data: string; deleted_at: number | null }>(),
    shelves: await env.DB.prepare(
      "SELECT id, name, sort_order, created_at, updated_at, deleted_at FROM shelves WHERE journal_id = ? AND updated_at > ?",
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
  if (size > MAX_BOOK_BYTES) return badRequest(`Books are limited to ${MAX_BOOK_BYTES / 1024 / 1024} MB`);

  const key = objectKey(journal.id, bookId, sha256);
  const signed = await presign(
    {
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
    },
    key,
    'PUT',
  );
  return json({ url: signed.url, expiresIn: signed.expiresIn });
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

  const key = objectKey(journal.id, bookId, sha256);
  const signed = await presign(
    {
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
    },
    key,
    'GET',
  );
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
