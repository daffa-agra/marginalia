import { AwsClient } from '../vendor/aws4fetch.esm.js';
import type { SyncRecord } from './merge';

/**
 * The Marginalia Worker (READER-DESIGN §3, §7, §8).
 *
 * Three routes only — one sync endpoint beats twelve CRUD routes — and the
 * Worker never touches book bytes: it signs, it merges rows, it answers.
 * No accounts; a capability key guards writes (§7): requests carry
 * `X-Journal-Key`, this Worker stores only its SHA-256.
 */

export interface Env {
  DB: D1Database;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
}

const LIMIT_SYNC_PER_MINUTE = 120;
const LIMIT_FILES_PER_MINUTE = 30;
const MAX_EPUB_BYTES = 100 * 1024 * 1024;
const READ_URL_TTL_SECONDS = 300;

interface Rows {
  books: SyncRecord[];
  entries: SyncRecord[];
  quotes: SyncRecord[];
  shelves: SyncRecord[];
  positions: SyncRecord[];
}

const EMPTY_ROWS: Rows = { books: [], entries: [], quotes: [], shelves: [], positions: [] };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function httpError(status: number, message: string): Response {
  return json({ error: message }, status);
}

const rateBuckets = new Map<string, { windowStart: number; count: number }>();

/** Per-key, per-IP counters over the isolate's lifetime: good enough to stop casual abuse. */
function rateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart > 60_000) {
    rateBuckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

async function readKeyHash(request: Request, db: D1Database, journalId: string): Promise<string | null> {
  const key = request.headers.get('x-journal-key');
  if (!key) return null;
  const journal = await db
    .prepare('SELECT key_hash FROM journals WHERE id = ?')
    .bind(journalId)
    .first<{ key_hash: string }>();
  if (!journal) return null;
  return (await sha256Hex(key)) === journal.key_hash ? journal.key_hash : null;
}

function asRecord(value: unknown, index: number): SyncRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null;
  void index;
  return {
    id: raw.id,
    updatedAt: raw.updatedAt,
    deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : null,
    ...raw,
  };
}

function parseRows(body: unknown): Rows {
  const rows = EMPTY_ROWS;
  if (!body || typeof body !== 'object') return rows;
  const raw = body as Record<string, unknown>;
  const changes = (raw.changes && typeof raw.changes === 'object' ? raw.changes : raw) as Record<string, unknown>;
  for (const table of ['books', 'entries', 'quotes', 'shelves', 'positions'] as const) {
    const list = changes[table];
    if (!Array.isArray(list)) continue;
    rows[table] = list.map(asRecord).filter((r): r is SyncRecord => r !== null);
  }
  return rows;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST') return httpError(405, 'Use POST');
    const journalId = url.searchParams.get('journal') ?? '';

    if (url.pathname === '/sync') {
      if (!rateLimit(`sync:${journalId}:${clientIp(request)}`, LIMIT_SYNC_PER_MINUTE)) {
        return httpError(429, 'Too many syncs; try again in a minute');
      }
      return handleSync(request, env, journalId);
    }

    if (url.pathname === '/files/upload-url' || url.pathname === '/files/read-url') {
      if (!rateLimit(`files:${journalId}:${clientIp(request)}`, LIMIT_FILES_PER_MINUTE)) {
        return httpError(429, 'Too many requests; try again in a minute');
      }
      return handleFileUrl(request, env, journalId, url.pathname.endsWith('upload-url'));
    }

    return httpError(404, 'Not found');
  },
};

async function handleSync(request: Request, env: Env, journalId: string): Promise<Response> {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(journalId)) return httpError(400, 'Bad journal id');
  const keyHash = await readKeyHash(request, env.DB, journalId);
  if (!keyHash) return httpError(401, 'Unknown journal or wrong key');

  let body: { since?: number; changes?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return httpError(400, 'Body must be JSON');
  }
  const since = typeof body.since === 'number' ? body.since : 0;
  const rows = parseRows(body.changes);

  const statements: D1PreparedStatement[] = [];
  const now = Date.now();

  // Books, quotes, shelves: JSON payload rows.
  for (const table of ['books', 'quotes', 'shelves'] as const) {
    for (const record of rows[table]) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO ${table} (id, journal_id, shelf_id, book_id, data, updated_at, deleted_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(id) DO UPDATE SET
             data = excluded.data, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
           WHERE excluded.updated_at > ${table}.updated_at`,
        ).bind(
          record.id,
          journalId,
          (record as Record<string, unknown>).shelfId ?? null,
          (record as Record<string, unknown>).bookId ?? null,
          JSON.stringify(record),
          record.updatedAt,
          record.deletedAt ?? null,
        ),
      );
    }
  }

  // Entries: columnar.
  for (const record of rows.entries) {
    const raw = record as Record<string, unknown>;
    statements.push(
      env.DB.prepare(
        `INSERT INTO entries (id, journal_id, book_id, text, on_date, page, cfi, percent, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text, on_date = excluded.on_date, page = excluded.page,
           cfi = excluded.cfi, percent = excluded.percent, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at
         WHERE excluded.updated_at > entries.updated_at`,
      ).bind(
        record.id,
        journalId,
        raw.bookId ?? null,
        String(raw.text ?? ''),
        raw.onDate ?? null,
        typeof raw.page === 'number' ? raw.page : null,
        raw.cfi ?? null,
        typeof raw.percent === 'number' ? raw.percent : null,
        typeof raw.createdAt === 'number' ? raw.createdAt : record.updatedAt,
        record.updatedAt,
        record.deletedAt ?? null,
      ),
    );
  }

  // Positions: primary key (journal_id, book_id); newest write wins.
  for (const record of rows.positions) {
    const raw = record as Record<string, unknown>;
    statements.push(
      env.DB.prepare(
        `INSERT INTO positions (journal_id, book_id, cfi, percent, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(journal_id, book_id) DO UPDATE SET
           cfi = excluded.cfi, percent = excluded.percent, updated_at = excluded.updated_at
         WHERE excluded.updated_at > positions.updated_at`,
      ).bind(journalId, record.id, String(raw.cfi ?? ''), Number(raw.percent ?? 0), record.updatedAt),
    );
  }

  statements.push(
    env.DB.prepare('UPDATE journals SET last_seen_at = ?2, revision = revision + 1 WHERE id = ?1').bind(journalId, now),
  );

  await env.DB.batch(statements);

  // Everything the device has not seen, tombstones included.
  const changes = await readChangesSince(env, journalId, since);
  const revisionRow = await env.DB.prepare('SELECT revision FROM journals WHERE id = ?1').bind(journalId).first<{ revision: number }>();
  return json({ serverTime: now, revision: revisionRow?.revision ?? 0, changes });
}

async function readChangesSince(env: Env, journalId: string, since: number): Promise<Rows> {
  const changes: Rows = EMPTY_ROWS;
  for (const table of ['books', 'quotes', 'shelves'] as const) {
    const result = await env.DB
      .prepare(`SELECT data FROM ${table} WHERE journal_id = ?1 AND updated_at > ?2`)
      .bind(journalId, since)
      .all<{ data: string }>();
    changes[table] = result.results.map((row) => JSON.parse(row.data) as SyncRecord);
  }
  const entries = await env.DB
    .prepare(
      `SELECT id, book_id, text, on_date, page, cfi, percent, created_at, updated_at, deleted_at
       FROM entries WHERE journal_id = ?1 AND updated_at > ?2`,
    )
    .bind(journalId, since)
    .allRecord();
  changes.entries = entries.results.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      bookId: (r.book_id as string) ?? undefined,
      text: r.text as string,
      onDate: (r.on_date as string) ?? undefined,
      page: (r.page as number) ?? undefined,
      cfi: (r.cfi as string) ?? undefined,
      percent: (r.percent as number) ?? undefined,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
      deletedAt: (r.deleted_at as number) ?? undefined,
    };
  });
  const positions = await env.DB
    .prepare('SELECT book_id, cfi, percent, updated_at FROM positions WHERE journal_id = ?1 AND updated_at > ?2')
    .bind(journalId, since)
    .allRecord();
  changes.positions = positions.results.map((row) => {
    const r = row as Record<string, unknown>;
    return { id: r.book_id as string, cfi: r.cfi as string, percent: r.percent as number, updatedAt: r.updated_at as number };
  });
  return changes;
}

async function handleFileUrl(request: Request, env: Env, journalId: string, isUpload: boolean): Promise<Response> {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(journalId)) return httpError(400, 'Bad journal id');
  const keyHash = await readKeyHash(request, env.DB, journalId);
  if (!keyHash) return httpError(401, 'Unknown journal or wrong key');

  let body: { bookId?: string; sha256?: string; size?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return httpError(400, 'Body must be JSON');
  }
  const bookId = body.bookId ?? '';
  const sha256 = body.sha256 ?? '';
  if (!/^[a-zA-Z0-9-]{4,64}$/.test(bookId)) return httpError(400, 'Bad book id');
  if (!/^[a-f0-9]{64}$/.test(sha256)) return httpError(400, 'sha256 must be 64 hex characters');
  if (isUpload && typeof body.size === 'number' && body.size > MAX_EPUB_BYTES) {
    return httpError(413, 'Book is over the 100 MB limit');
  }

  // Content hash in the key keeps uploads idempotent (§4.2).
  const objectKey = `${journalId}/books/${bookId}/${sha256}.epub`;
  const client = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  });
  const endpoint = new URL(
    `https://${env.R2_BUCKET}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${objectKey}`,
  );
  const method = isUpload ? 'PUT' : 'GET';
  const signed = await client.sign(new Request(endpoint, { method }), {
    aws: { signQuery: true },
  });
  if (isUpload) {
    signed.headers.set('content-type', 'application/epub+zip');
  }
  const expiresIn = isUpload ? 900 : READ_URL_TTL_SECONDS;
  const params = new URL(signed.url);
  params.searchParams.set('X-Amz-Expires', String(expiresIn));
  return json({
    url: params.toString(),
    method,
    expiresIn,
    key: objectKey,
  });
}
