/**
 * Signing in with a Google account.
 *
 * The flow is the standard authorization-code exchange with PKCE, split so the
 * client secret never leaves the Worker:
 *
 *   1. `signInWithGoogle` asks the Worker for an authorize URL (the Worker
 *      mints and stores the state, verifier and nonce) and redirects to it.
 *   2. Google returns to this page with `?code=...&state=...`.
 *   3. `completeSignInFromRedirect`, called once at boot, posts them back; the
 *      Worker swaps the code for an id_token and returns the session.
 *
 * The app never sees Google's tokens at all — only the opaque session token —
 * and the redirect lands on the app's origin root, so no routing is needed.
 */

import { authCallback, authLogout, authStart } from './api';
import { currentSession, writeSession } from './session';
import type { Session } from './session';

export type { AuthUser, Session } from './session';
export { currentSession, subscribeSession } from './session';

/** Where Google sends the reader back to. The app's own root, exactly. */
function redirectUri(): string {
  return `${globalThis.location.origin}/`;
}

/**
 * Starts the sign-in and leaves this page.
 *
 * Resolves only on failure — on success the browser is on its way to Google.
 * A 503 means the server has no Google client configured, and the reader
 * should keep using the journal key.
 */
export async function signInWithGoogle(): Promise<{ ok: boolean; error?: string }> {
  const result = await authStart({ redirectUri: redirectUri() });
  if (!result.ok) return { ok: false, error: result.error.message };
  globalThis.location.href = result.data.authorizeUrl;
  return { ok: true };
}

/**
 * Completes a sign-in that Google redirected back to, if this is one.
 *
 * Returns the session on success, null when the URL holds no sign-in (the
 * normal boot of a page nobody redirected), and the failure otherwise. The
 * `code` and `state` are stripped from the address either way: a refresh must
 * never replay an authorization code, and the URL was never meant to be shared.
 */
export async function completeSignInFromRedirect(): Promise<
  { ok: true; session: Session } | { ok: false; error: string } | null
> {
  const url = new URL(globalThis.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return null;

  const clean = () => {
    try {
      globalThis.history.replaceState(null, '', globalThis.location.pathname);
    } catch {
      // Sandboxed contexts refuse history writes; the params are harmless there.
    }
  };

  const result = await authCallback({ code, state, redirectUri: redirectUri() });
  clean();
  if (!result.ok) return { ok: false, error: result.error.message };

  const session: Session = {
    token: result.data.token,
    expiresAt: result.data.expiresAt,
    user: result.data.user,
    signedInAt: Date.now(),
  };
  writeSession(session);
  return { ok: true, session };
}

/**
 * Signs out: forgets the token here and tells the server to drop it.
 *
 * The server call is best-effort — being offline must not trap the reader in
 * a session this browser no longer wants. The local journal and its local
 * books are untouched, so the app keeps working exactly as it does signed out.
 */
export async function signOut(): Promise<void> {
  const token = currentSession()?.token;
  writeSession(null);
  if (token) await authLogout(token);
}
