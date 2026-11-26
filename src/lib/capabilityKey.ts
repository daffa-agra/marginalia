/**
 * The capability key.
 *
 * There is no login by design: no accounts, no passwords, no email. Instead the
 * browser generates a 256-bit random key on first run and sends it with every
 * call to the backend. The server keeps only its SHA-256 hash, so a copy of the
 * database does not hand anyone a working key.
 *
 * The trade-off is explicit and worth stating plainly: whoever holds the key has
 * access. It behaves like a bookmark URL rather than a password. That is
 * acceptable because the journal is not sensitive, and because the export is the
 * real backup — but the UI says it out loud rather than implying security it
 * does not have.
 *
 * Cross-device linking is the whole onboarding: show the key, type it on the
 * other device, and both are the same journal.
 */

const KEY_STORAGE = 'marginalia.key.v1';
/** 32 bytes → 43 base64url characters. */
const KEY_BYTES = 32;

export interface CapabilityKey {
  /** base64url, 256 bits of entropy. */
  value: string;
  createdAt: number;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generates a fresh 256-bit key from the platform CSPRNG. */
export function generateKey(): CapabilityKey {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  return { value: base64url(bytes), createdAt: Date.now() };
}

/** The key this browser uses, creating one on first call. */
export function loadOrCreateKey(): CapabilityKey {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CapabilityKey>;
      if (typeof parsed.value === 'string' && isWellFormed(parsed.value)) {
        return { value: parsed.value, createdAt: parsed.createdAt ?? Date.now() };
      }
    }
  } catch {
    // A corrupt entry is replaced rather than trusted.
  }
  const created = generateKey();
  saveKey(created);
  return created;
}

export function saveKey(key: CapabilityKey): boolean {
  try {
    localStorage.setItem(KEY_STORAGE, JSON.stringify(key));
    return true;
  } catch {
    return false;
  }
}

/** Replaces the key, e.g. after linking a device or rotating. */
export function adoptKey(value: string): CapabilityKey | null {
  const trimmed = value.trim();
  if (!isWellFormed(trimmed)) return null;
  const key = { value: trimmed, createdAt: Date.now() };
  saveKey(key);
  return key;
}

/** Whether a string could be a key: 32 bytes of base64url. */
export function isWellFormed(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * The key as words, for reading aloud to another device.
 *
 * base64url is not something a person can retype reliably, so the display form
 * groups it in fours. The canonical value is still the base64url string; the
 * grouping is presentational and stripped on entry.
 */
export function formatKeyForDisplay(value: string): string {
  return value.replace(/(.{4})/g, '$1 ').trim();
}

/** Accepts a key typed with spaces, hyphens or line breaks. */
export function normaliseKeyInput(input: string): string {
  return input.replace(/[\s\-_]+/g, '').trim();
}

/**
 * A short fingerprint, so two devices can be compared without exposing the key
 * on screen while someone looks over a shoulder.
 */
export function keyFingerprint(value: string): string {
  // Six characters from the middle of the key: stable, but not the key.
  const middle = value.slice(14, 20);
  return middle.toUpperCase();
}

/** Forgets the key on this device. The journal itself is untouched. */
export function forgetKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Nothing to do; the next call creates a new key.
  }
}
