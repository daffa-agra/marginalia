/**
 * Signing R2 URLs.
 *
 * The Worker never touches book bytes. Its free tier allows 10 ms of CPU per
 * invocation, and a 5 MB body is three orders of magnitude past that; streaming
 * an EPUB through here would either fail the limit or cost real money. So the
 * Worker's entire job is to sign a short-lived URL and get out of the way.
 *
 * The bucket stays private. A URL is the only way in, it expires in five
 * minutes, and it is scoped to exactly one object — so a leaked URL cannot list
 * the bucket or read a different book.
 */

import { AwsClient } from 'aws4fetch';

/** Five minutes: long enough for a slow connection, short enough to be useless later. */
const EXPIRES_SECONDS = 300;

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Whether signing is configured at all.
 *
 * Without this check a missing secret surfaces as an opaque 500 from deep inside
 * the signer. The endpoint can then say plainly that file storage is not set up,
 * which is actionable, instead of "something went wrong", which is not.
 */
export function isConfigured(config: Partial<R2Config>): config is R2Config {
  return Boolean(config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket);
}

/** The key layout from the design: content hash makes uploads idempotent. */
export function objectKey(journalId: string, bookId: string, sha256: string): string {
  // Both ids come from the client, so they are sanitised rather than trusted:
  // no separators, no traversal, a conservative alphabet.
  const safe = (value: string) => {
    const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '');
    if (!cleaned) throw new Error('invalid identifier');
    return cleaned;
  };
  const hash = sha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid content hash');
  return `marginalia/${safe(journalId)}/books/${safe(bookId)}/${hash}.epub`;
}

function endpoint(config: R2Config, key: string): string {
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
}

/**
 * A presigned URL for one object.
 *
 * `aws4fetch` computes the SigV4 signature locally, which is a few microseconds —
 * well inside the CPU budget, and it needs no Node APIs, which the Workers
 * runtime does not have.
 *
 * DELETE is signed as a plain DELETE: the method is part of the signature, and
 * the cleanup pass calls it directly rather than through the API surface.
 */
export async function presign(
  config: R2Config,
  key: string,
  method: 'PUT' | 'GET' | 'DELETE' | 'HEAD',
): Promise<{ url: string; expiresIn: number }> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  const target = new URL(endpoint(config, key));
  target.searchParams.set('X-Amz-Expires', String(EXPIRES_SECONDS));

  const signed = await client.sign(target.toString(), {
    method,
    // SigV4 requires the signed query to include the expiry rather than a Date
    // header for presigned requests.
    aws: { signQuery: true },
  });

  return { url: signed.url, expiresIn: EXPIRES_SECONDS };
}
