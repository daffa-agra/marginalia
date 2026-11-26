/**
 * The capability key (READER-DESIGN §7): no accounts, no login.
 *
 * An identity is a random code — eight Crockford base32 blocks plus a
 * checksum block — shown once and stored locally. The key sent to the
 * Worker is SHA-256 of the canonical code, so the server stores only a
 * hash, and a code entered on another device derives the same identity.
 * 240 bits of code entropy: guessing a journal is not a plan.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Ambiguous letters fold: O→0, I/L→1, U→V (Crockford exclusions). */
const FOLD: Record<string, string> = { O: '0', I: '1', L: '1', U: 'V' };

const CODE_BLOCKS = 8;
const CHARS_PER_BLOCK = 6;

export interface JournalIdentity {
  /** The shareable code: XXXXXX-XXXXXX-…; the only cross-device secret. */
  code: string;
  /** SHA-256 of the canonical code, base64url — what the API calls carry. */
  key: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

export function canonicalizeCode(input: string): string {
  const upper = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  let out = '';
  for (const char of upper) out += FOLD[char] ?? char;
  return out;
}

/** The last block carries a checksum over the data characters. */
export function codeChecksum(chars: string): string {
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    const value = CROCKFORD.indexOf(chars[i]);
    if (value < 0) return '';
    sum = (sum * 2 + value) % 37;
  }
  return CROCKFORD[sum % 32];
}

export function formatCode(chars: string): string {
  const data = chars.slice(0, CODE_BLOCKS * CHARS_PER_BLOCK);
  const blocks: string[] = [];
  for (let i = 0; i < CODE_BLOCKS; i++) blocks.push(data.slice(i * CHARS_PER_BLOCK, (i + 1) * CHARS_PER_BLOCK));
  return `${blocks.join('-')}-${codeChecksum(data)}`;
}

export function isCodeWellFormed(input: string): boolean {
  const canonical = canonicalizeCode(input);
  if (canonical.length !== CODE_BLOCKS * CHARS_PER_BLOCK + 1) return false;
  const data = canonical.slice(0, CODE_BLOCKS * CHARS_PER_BLOCK);
  return codeChecksum(data) === canonical.slice(-1);
}

async function identityFromCode(code: string): Promise<JournalIdentity> {
  const canonical = canonicalizeCode(code);
  if (!isCodeWellFormed(canonical)) throw new Error('That link code is mistyped — check the last block');
  return { code: formatCode(canonical), key: await sha256Base64url(canonical) };
}

export async function createIdentity(): Promise<JournalIdentity> {
  const needed = CODE_BLOCKS * CHARS_PER_BLOCK;
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  let chars = '';
  while (chars.length < needed) {
    while (bits < 5) {
      buffer = (buffer << 8) | bytes[index++];
      bits += 8;
    }
    bits -= 5;
    chars += CROCKFORD[(buffer >>> bits) & 31];
  }
  return identityFromCode(formatCode(chars));
}

export { identityFromCode };
