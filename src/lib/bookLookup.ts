/**
 * Book metadata lookup against the Open Library.
 *
 * Free, keyless, and — the property the whole design rests on — it answers
 * browsers directly: both search and covers serve `Access-Control-Allow-Origin:
 * *`, so the client talks to it itself and no Worker proxy is needed. The
 * Worker's 10 ms CPU budget stays reserved for sync and signing.
 *
 * Every value is optional in the result, because a search hit often knows the
 * author and nothing else; the caller fills only what it can.
 */

/** https://openlibrary.org/developers/api */
const SEARCH_URL = 'https://openlibrary.org/search.json';

export interface BookMetadata {
  title?: string;
  author?: string;
  publisher?: string;
  publishedYear?: number;
  isbn?: string;
  /** Cover image URL on covers.openlibrary.org, when a cover exists. */
  coverUrl?: string;
}

/** The result fields worth asking for; keeps responses small. */
const FIELDS = [
  'key',
  'title',
  'author_name',
  'publisher',
  'first_publish_year',
  'isbn',
  'cover_i',
  'number_of_pages_median',
].join(',');

interface SearchDoc {
  title?: unknown;
  author_name?: unknown;
  publisher?: unknown;
  first_publish_year?: unknown;
  isbn?: unknown;
  cover_i?: unknown;
  number_of_pages_median?: unknown;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function preferIsbn13(values: string[]): string | undefined {
  // Hyphens and spaces are presentation, not identity: strip before matching,
  // so "0-441-01359-X" and "044101359X" are the same book.
  const clean = values.filter((v): v is string => typeof v === 'string').map((v) => v.replace(/[-\s]/g, ''));
  const isbn13 = clean.find((v) => /^97[89]\d{10}$/.test(v));
  if (isbn13) return isbn13;
  const isbn10 = clean.find((v) => /^\d{9}[\dXx]$/i.test(v));
  return isbn10 ? isbn10.toUpperCase() : undefined;
}

/**
 * Shapes one search hit into the fields this app keeps.
 *
 * Exported because it is pure and every branch is worth a test: search hits
 * arrive as loosely-typed arrays where any field may be absent, wrongly typed,
 * or a list when a single value was expected.
 */
export function metadataFromDoc(doc: SearchDoc): BookMetadata {
  const publishers = asStringArray(doc.publisher);
  const isbns = asStringArray(doc.isbn);
  const coverId = typeof doc.cover_i === 'number' ? doc.cover_i : undefined;
  const year = typeof doc.first_publish_year === 'number' ? doc.first_publish_year : undefined;
  return {
    title: typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : undefined,
    author: asStringArray(doc.author_name)[0],
    publisher: publishers[0],
    publishedYear: year != null && year > 0 ? Math.round(year) : undefined,
    isbn: preferIsbn13(isbns),
    coverUrl: coverId != null ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined,
  };
}

export interface LookupOutcome {
  /** True when the network call itself succeeded (0 hits is still ok). */
  ok: boolean;
  /** Why it failed, phrased for the reader, when ok is false. */
  message?: string;
  matches: BookMetadata[];
}

const LOOKUP_TIMEOUT_MS = 12_000;

/**
 * Searches by title and optional author.
 *
 * A query with a title only is accepted; the Open Library ranks it. `limit`
 * stays small because the UI offers a pick-list, not a wall of results.
 */
export async function lookupMetadata(
  title: string,
  author = '',
  signal?: AbortSignal,
): Promise<LookupOutcome> {
  const t = title.trim();
  if (!t) return { ok: true, matches: [] };

  const params = new URLSearchParams({
    q: author.trim() ? `${t} ${author.trim()}` : t,
    fields: FIELDS,
    limit: '8',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(`${SEARCH_URL}?${params}`, {
      signal: controller.signal,
      // The Open Library (like most APIs) rejects requests without a
      // User-Agent; browsers always send one, and an explicit identity is
      // the polite thing to do for a keyless free service.
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return { ok: false, message: `The book service answered ${response.status}`, matches: [] };
    }
    const body = (await response.json()) as { docs?: SearchDoc[] };
    return { ok: true, matches: (body.docs ?? []).map(metadataFromDoc) };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      message: aborted ? 'The book service did not answer in time' : 'The book service could not be reached',
      matches: [],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The largest of Open Library's standard cover sizes.
 *
 * `-L` is 640 wide, which is enough for the detail page's hero; `-M` is the
 * card-sized fallback when a large cover was never scanned.
 */
export function coverUrl(coverId: number | string, size: 'M' | 'L' = 'L'): string {
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}
