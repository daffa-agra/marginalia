/**
 * Google sign-in, the way Google Play Books knows whose library it is.
 *
 * The flow is the standard authorization-code exchange with PKCE, and it stays
 * inside two JSON posts so it fits the rest of this Worker:
 *
 *   1. `POST /api/auth/start` — the Worker mints a `state`, a PKCE verifier and
 *      a nonce, stores them in D1, and returns the full Google authorize URL.
 *      The browser redirects to it.
 *   2. Google returns to the app (`?code=...&state=...`). The app posts both to
 *      `POST /api/auth/callback`, where the Worker swaps the code for tokens
 *      using the stored verifier and the client secret, which never leaves the
 *      server.
 *
 * The id_token arrives over TLS directly from Google's token endpoint, so per
 * the OIDC core spec it is not signature-checked here; what *is* checked is
 * everything that could be wrong about a direct response: issuer, audience,
 * expiry and that the nonce matches the one bound to this exact sign-in.
 */

/** A verifier has 43-128 base64url characters (RFC 7636 §4.1). */
export function looksLikeCodeVerifier(value: string): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

/** base64url without padding, the encoding every OAuth field here uses. */
export function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `n` random bytes, base64url-encoded. 32 bytes covers state, nonce, tokens. */
export function randomToken(bytes = 32): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return base64urlEncode(raw);
}

/** The S256 code challenge: BASE64URL(SHA-256(verifier)). RFC 7636 §4.2. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64urlEncode(new Uint8Array(digest));
}

export interface AuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

/** Builds the consent-screen URL. `select_account` so a second Google account can be chosen. */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Whether the app may complete a sign-in back at this redirect.
 *
 * It must be exactly the origin plus one slash for an origin on the allow-list:
 * the same list that gates CORS. Anything else is either a misconfiguration or
 * an attempt to launder a code somewhere it was not asked for.
 */
export function isAllowedRedirect(redirectUri: string, allowedOrigins: string[]): boolean {
  try {
    const url = new URL(redirectUri);
    if (url.search || url.hash) return false;
    if (url.pathname !== '/' && url.pathname !== '') return false;
    return allowedOrigins.includes(`${url.protocol}//${url.host}`);
  } catch {
    return false;
  }
}

export interface IdTokenClaims {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nonce?: string;
}

/** Decodes a JWT payload without verifying it. Claims are checked separately. */
export function decodeIdToken(idToken: string): IdTokenClaims | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const claims = JSON.parse(json) as IdTokenClaims;
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
    return claims;
  } catch {
    return null;
  }
}

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/**
 * Whether a decoded id_token can be believed as "this user, from this sign-in".
 *
 * The nonce check is what binds the token to the authorization request this
 * Worker started: a token minted for someone else's flow is worthless here.
 */
export function validateClaims(
  claims: IdTokenClaims,
  expected: { clientId: string; nonce: string; now: number },
): boolean {
  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) return false;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expected.clientId)) return false;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= expected.now) return false;
  if (claims.nonce !== expected.nonce) return false;
  return true;
}

/** Trims profile fields to sane lengths before they reach the database. */
export function profileOf(claims: IdTokenClaims): { id: string; email?: string; name?: string; picture?: string } {
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.slice(0, 320) : undefined,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 200) : undefined,
    picture: typeof claims.picture === 'string' ? claims.picture.slice(0, 2048) : undefined,
  };
}

/** One hour: longer than any sign-in needs, short enough that stale rows are junk. */
export const OAUTH_STATE_TTL_MS = 60 * 60 * 1000;

/** How long a login stays valid. Sliding: active readers are never signed out. */
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
