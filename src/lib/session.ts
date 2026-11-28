/**
 * The signed-in session.
 *
 * A session is what a Google sign-in leaves behind: an opaque token the server
 * minted, its expiry, and the account it belongs to. It lives in localStorage
 * next to the capability key, and every API call prefers it when present — the
 * account is the identity, the key the fallback.
 *
 * Only the token's SHA-256 hash is stored server-side, so this file holds the
 * only working copy of the credential, exactly as the capability key does.
 * The module is a tiny store so React can subscribe without prop-drilling the
 * account through every view.
 */

const SESSION_STORAGE = 'marginalia.session.v1';

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface Session {
  token: string;
  /** Epoch ms after which the server will refuse this token. */
  expiresAt: number;
  user: AuthUser;
  signedInAt: number;
}

/** A token is a 32-byte value, base64url — the same shape the Worker mints. */
function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isValidSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Session>;
  if (!isWellFormedToken(candidate.token)) return false;
  if (typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)) return false;
  if (typeof candidate.signedInAt !== 'number') return false;
  const user = candidate.user as Partial<AuthUser> | undefined;
  return typeof user?.id === 'string' && user.id.length > 0;
}

let snapshot: Session | null = readSession();

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidSession(parsed)) return null;
    // An expired session is removed rather than returned: the server would
    // refuse it, and the UI should show signed-out the moment it is true.
    if (parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(SESSION_STORAGE);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  snapshot = readSession();
  for (const listener of listeners) listener();
}

/** The current session, or null. Reactive-safe snapshot for useSyncExternalStore. */
export function currentSession(): Session | null {
  return snapshot;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stores or clears the session and tells the UI. */
export function writeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_STORAGE, JSON.stringify(session));
    else localStorage.removeItem(SESSION_STORAGE);
  } catch {
    // Storage full or blocked: the sign-in can still complete for this page.
  }
  emit();
}
