/**
 * Authentication.
 *
 * There are no accounts. A journal is identified by a 256-bit capability key
 * that the browser generates; the server stores only its SHA-256 hash and
 * compares in constant time. Whoever holds the key has access to that journal —
 * the same trade a bookmark URL makes — which is why the Worker also rate-limits
 * (see `rateLimit`) and why the key can be rotated.
 *
 * Nothing here trusts the client. The key names a journal; every other query is
 * scoped by the journal id resolved from that key, never by an id in the body.
 */

/** SHA-256 of the presented key, hex. This is the only key-derived value stored. */
export async function hashKey(key: string, pepper?: string): Promise<string> {
  const input = new TextEncoder().encode(pepper ? `${pepper}:${key}` : key);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string comparison.
 *
 * A plain `===` on a secret leaks its prefix through timing: the comparison
 * exits at the first differing byte. Over enough requests that is enough to
 * recover a hash, so the loop always runs the full length.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Rejects anything that cannot be a key before touching the database. */
export function looksLikeKey(value: string | null | undefined): value is string {
  // 32 bytes of base64url.
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * A 401 with the standard message.
 *
 * CORS headers ride on this too: a browser that cannot read the body shows a
 * generic network error, when the actual answer is "this key is not valid".
 */
export function unauthorised(extraHeaders: Record<string, string> = {}, message = 'Missing or invalid journal key'): Response {
  return json({ error: message }, 401, extraHeaders);
}

/** JSON response helper. Every response in this Worker goes through it. */
export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // The journal is private; nothing should cache it, ever.
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
