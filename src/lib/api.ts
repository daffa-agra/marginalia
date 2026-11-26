/**
 * Talking to the backend.
 *
 * The app is local-first: IndexedDB and localStorage are the read/write path,
 * and the server is a sync target. Nothing here is ever in the critical path of
 * turning a page. When the network is unavailable the app behaves exactly as it
 * does offline today, and the differences surface as a queued state rather than
 * an error.
 *
 * That constraint shapes the whole module:
 *
 *   - every request carries the capability key, never a session
 *   - a failed request is a *queued* change, not a lost one
 *   - the server only signs R2 URLs; book bytes never pass through it
 */

import { loadOrCreateKey } from './capabilityKey';

/**
 * Where the API lives.
 *
 * Kept as one constant because it is the only thing that changes between a local
 * Worker and the deployed one. It is read from a global rather than
 * `import.meta.env` so the module also loads under the CommonJS smoke build,
 * which is what the merge tests import.
 */
function resolveApiBase(): string {
  const configured = (globalThis as { __MARGINALIA_API_BASE__?: string }).__MARGINALIA_API_BASE__;
  return configured ?? 'https://api.books.daffagra.my.id';
}

export const API_BASE: string = resolveApiBase();

/** How long a request may take before it is treated as offline. */
const REQUEST_TIMEOUT_MS = 12_000;

export interface ApiError {
  status: number;
  message: string;
  /** True when the failure is connectivity, not a rejection. */
  offline: boolean;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

function offlineError(message = 'No connection'): ApiResult<never> {
  return { ok: false, error: { status: 0, message, offline: true } };
}

async function request<T>(
  path: string,
  body: unknown,
  options: { method?: string; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  const key = loadOrCreateKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Let the caller cancel as well as the timeout.
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Journal-Key': key.value,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      // A JSON error body is the API speaking; a non-JSON one is an edge proxy.
      let message = `Request failed (${response.status})`;
      try {
        const parsed = (await response.json()) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch {
        // Keep the status-based message.
      }
      return { ok: false, error: { status: response.status, message, offline: false } };
    }
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    // An aborted fetch is a timeout; anything else is a network failure. Both
    // mean "not now", never "this change is bad".
    const aborted = err instanceof Error && err.name === 'AbortError';
    return offlineError(aborted ? 'The server did not answer in time' : 'No connection');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/* ── endpoints ── */

export interface HelloResponse {
  journalId: string;
  revision: number;
}

/** Registers this key, or confirms it. Idempotent. */
export function hello(signal?: AbortSignal): Promise<ApiResult<HelloResponse>> {
  return request<HelloResponse>('/api/hello', {}, { signal });
}

/**
 * A record on the wire.
 *
 * Untyped by design: the server is the authority on what a record holds, and the
 * client validates on arrival (`sanitizeData`) rather than trusting a shape it
 * cannot check. `id` and `updatedAt` are the only fields the transport itself
 * needs, so they are the only ones promised here.
 */
export interface WireRecord {
  id: string;
  updatedAt: number;
  deletedAt?: number;
  [key: string]: unknown;
}

export interface SyncChanges {
  books: WireRecord[];
  quotes: WireRecord[];
  positions: WireRecord[];
  shelves: WireRecord[];
}

export interface SyncRequest {
  since: number;
  changes: SyncChanges;
  deviceId: string;
}

export interface SyncResponse {
  revision: number;
  changes: SyncChanges;
  /** Records edited on two devices within the same millisecond. */
  conflicts?: Array<{ kind: string; id: string }>;
}

export function sync(payload: SyncRequest, signal?: AbortSignal): Promise<ApiResult<SyncResponse>> {
  return request<SyncResponse>('/api/sync', payload, { signal });
}

export interface UploadUrlRequest {
  bookId: string;
  sha256: string;
  size: number;
}

export interface UploadUrlResponse {
  url: string;
  /** Seconds until the signed URL expires. */
  expiresIn: number;
}

export function uploadUrl(payload: UploadUrlRequest, signal?: AbortSignal): Promise<ApiResult<UploadUrlResponse>> {
  return request<UploadUrlResponse>('/api/files/upload-url', payload, { signal });
}

export interface ReadUrlResponse {
  url: string;
  expiresIn: number;
}

export function readUrl(
  payload: { bookId: string; sha256: string },
  signal?: AbortSignal,
): Promise<ApiResult<ReadUrlResponse>> {
  return request<ReadUrlResponse>('/api/files/read-url', payload, { signal });
}

/* ── book bytes ── */

/** SHA-256 of a file, hex. Identical files share one R2 object. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Uploads an EPUB straight to R2 through a presigned URL.
 *
 * The body goes to the bucket, not to the Worker, because the Worker's free tier
 * allows 10 ms of CPU per request and a 5 MB body is orders of magnitude more
 * than that. The Worker's only job here is to sign.
 */
export async function uploadBookBytes(
  bookId: string,
  bytes: ArrayBuffer,
  signal?: AbortSignal,
): Promise<ApiResult<{ sha256: string }>> {
  const sha256 = await sha256Hex(bytes);
  const signed = await uploadUrl({ bookId, sha256, size: bytes.byteLength }, signal);
  if (!signed.ok) return signed;

  try {
    const response = await fetch(signed.data.url, {
      method: 'PUT',
      body: bytes,
      headers: { 'Content-Type': 'application/epub+zip' },
      signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        error: { status: response.status, message: 'The book could not be uploaded', offline: false },
      };
    }
    return { ok: true, data: { sha256 } };
  } catch {
    return offlineError('The upload was interrupted');
  }
}

/** Fetches an EPUB via a short-lived presigned GET. */
export async function downloadBookBytes(
  bookId: string,
  sha256: string,
  signal?: AbortSignal,
): Promise<ApiResult<ArrayBuffer>> {
  const signed = await readUrl({ bookId, sha256 }, signal);
  if (!signed.ok) return signed;
  try {
    const response = await fetch(signed.data.url, { signal });
    if (!response.ok) {
      return { ok: false, error: { status: response.status, message: 'The book could not be downloaded', offline: false } };
    }
    return { ok: true, data: await response.arrayBuffer() };
  } catch {
    return offlineError('The download was interrupted');
  }
}

/** Whether the browser currently believes it is online. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}
