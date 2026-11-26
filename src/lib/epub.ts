import { ZipError, listEntries, readEntry, readTextEntry } from './zip';

/**
 * EPUB metadata extraction.
 *
 * Reads container.xml to find the OPF, then pulls title, author, language,
 * identifier and the cover image out of it. Everything here is best-effort:
 * a book with a broken OPF still imports, it just arrives with fewer fields.
 */

export interface EpubMetadata {
  title?: string;
  author?: string;
  language?: string;
  identifier?: string;
  publisher?: string;
  /** Raw bytes of the cover image, if the book declares one. */
  cover?: { bytes: Uint8Array; mime: string };
  /** Spine item count, a rough proxy for book size. */
  spineItems: number;
  /** True when the OPF was found and parsed. */
  parsed: boolean;
}

const MAX_COVER_BYTES = 4 * 1024 * 1024;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/** Strips namespaces so dc:title and title both match. */
function firstMatch(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<([a-zA-Z0-9]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${tagName}>`, 'i');
  const match = re.exec(xml);
  if (!match) return undefined;
  const value = decodeXmlEntities(match[2].replace(/<[^>]*>/g, '')).trim();
  return value || undefined;
}

/** Resolves a path relative to the OPF's own directory. */
function resolvePath(base: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0]);
  if (clean.startsWith('/')) return clean.slice(1);
  const parts = `${base}${clean}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Finds the cover image described by the OPF, in either of the two common forms. */
function findCoverHref(opf: string, opfDir: string): string | undefined {
  const metaCover = /<meta[^>]*name=["']cover["'][^>]*content=["']([^"']+)["'][^>]*>/i.exec(opf);
  const manifest = [...opf.matchAll(/<item\b([^>]*)\/?>/gi)].map((m) => m[1]);

  const attr = (attrs: string, name: string): string | undefined => {
    const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
    return m ? m[1] : undefined;
  };

  if (metaCover) {
    const id = metaCover[1];
    for (const item of manifest) {
      if (attr(item, 'id') === id) {
        const href = attr(item, 'href');
        if (href) return resolvePath(opfDir, href);
      }
    }
  }

  for (const item of manifest) {
    const properties = attr(item, 'properties') ?? '';
    if (properties.split(/\s+/).includes('cover-image')) {
      const href = attr(item, 'href');
      if (href) return resolvePath(opfDir, href);
    }
  }

  // Last resort: a manifest item whose id or href suggests a cover image.
  for (const item of manifest) {
    const id = (attr(item, 'id') ?? '').toLowerCase();
    const href = attr(item, 'href') ?? '';
    const type = attr(item, 'media-type') ?? '';
    if (type.startsWith('image/') && (id.includes('cover') || href.toLowerCase().includes('cover'))) {
      return resolvePath(opfDir, href);
    }
  }
  return undefined;
}

function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

/** Throws ZipError when the file is not a readable EPUB. */
export async function extractEpubMetadata(buffer: ArrayBuffer): Promise<EpubMetadata> {
  const container = await readTextEntry(buffer, 'META-INF/container.xml');
  if (!container) throw new ZipError('Not an EPUB: META-INF/container.xml is missing.');

  const opfPath =
    /<rootfile[^>]*full-path=["']([^"']+)["']/i.exec(container)?.[1] ??
    undefined;
  if (!opfPath) throw new ZipError('Not a readable EPUB: container.xml declares no rootfile.');

  const opf = await readTextEntry(buffer, opfPath);
  if (!opf) throw new ZipError(`Not a readable EPUB: the package document "${opfPath}" is missing.`);

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const title = firstMatch(opf, 'title');
  const creator = firstMatch(opf, 'creator');
  const language = firstMatch(opf, 'language');
  const identifier = firstMatch(opf, 'identifier');
  const publisher = firstMatch(opf, 'publisher');

  // EPUB 3 packs multiple creators into one <dc:creator> block; keep the first line.
  const author = creator?.split(/\s*[;|]\s*/)[0]?.trim();

  const spineItems = [...opf.matchAll(/<itemref\b/gi)].length;

  let cover: EpubMetadata['cover'];
  const coverHref = findCoverHref(opf, opfDir);
  if (coverHref) {
    try {
      const entries = listEntries(buffer);
      const entry = entries.find((e) => e.name === coverHref);
      if (entry && entry.uncompressedSize <= MAX_COVER_BYTES) {
        const bytes = await readEntry(buffer, entry);
        cover = { bytes, mime: mimeFromName(coverHref) };
      }
    } catch {
      // A missing or unreadable cover is not a reason to refuse the book.
      cover = undefined;
    }
  }

  return {
    title,
    author,
    language: language?.split(/\s*,\s*/)[0],
    identifier,
    publisher,
    cover,
    spineItems,
    parsed: true,
  };
}

/** Cheap check before doing any real work. */
export function looksLikeEpub(fileName: string, size: number): { ok: true } | { ok: false; reason: string } {
  if (!/\.epub$/i.test(fileName)) return { ok: false, reason: 'That file is not an EPUB.' };
  if (size === 0) return { ok: false, reason: 'That file is empty.' };
  if (size > 100 * 1024 * 1024) return { ok: false, reason: 'That book is larger than the 100 MB limit.' };
  return { ok: true };
}

export { ZipError };
