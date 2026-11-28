/**
 * Authentication.
 *
 * Two credentials name a journal, and both are compared the same way: the
 * server stores only a SHA-256 hash and compares in constant time.
 *
 *  - **Session token.** A signed-in Google account (see `oauth.ts`), the way
 *    Google Play Books ties a library to a reader rather than to a device.
 *    The token is minted at sign-in, expires, and names the journal through
 *    the account's user id.
 *  - **Capability key.** The original model: a key the browser generates, and
 *    whoever holds it has access — the same trade a bookmark URL makes. It
 *    remains valid so existing devices keep syncing unchanged.
 *
 * Nothing here trusts the client. Either credential names the journal; every other query is
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
  // 22 chars of base64url (128-bit, the current generation) or 43 (the
  // legacy 256-bit generation). Both hash to a journal; old keys never break.
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value)
    || typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * The bearer token of a signed-in session, from the Authorization header.
 *
 * A session token is a 32-byte random value (43 base64url characters), the
 * same shape as the legacy 256-bit key. Like the key, only its hash is stored;
 * unlike the key it is minted by the server at sign-in and expires.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9_-]{43})$/.exec(header.trim());
  return match ? match[1] : null;
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
