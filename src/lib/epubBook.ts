/**
 * Reading a whole EPUB, not just its metadata.
 *
 * An EPUB is a ZIP containing an OPF package document that lists every
 * resource (the manifest) and the reading order (the spine). This module turns
 * that structure into something a renderer can use: chapters in order, a table
 * of contents, and each chapter's HTML rewritten so its images, stylesheets
 * and fonts resolve to local blob URLs.
 *
 * Everything here treats the archive as untrusted input.
 */
import { ZipError, listEntries, readEntry, readTextEntry } from './zip';

export interface Chapter {
  /** Path inside the archive, e.g. "OEBPS/chapter1.xhtml". */
  path: string;
  /** Media type from the manifest. */
  mediaType: string;
  /** Linear items are part of the reading order; non-linear are extras. */
  linear: boolean;
}

export interface TocEntry {
  label: string;
  /** Chapter path this entry points at, without the fragment. */
  path?: string;
  /** Depth, 0-based. */
  depth: number;
}

export interface ParsedBook {
  title: string;
  author?: string;
  language?: string;
  chapters: Chapter[];
  toc: TocEntry[];
  /** Spent once per resource, released when the reader closes. */
  resources: Map<string, string>;
  /** Blob URLs created for embedded resources. */
  blobUrls: string[];
}

const MAX_RESOURCE_BYTES = 32 * 1024 * 1024;
const MAX_CHAPTER_BYTES = 8 * 1024 * 1024;

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c: string) => String.fromCodePoint(Number(c)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c: string) => String.fromCodePoint(Number.parseInt(c, 16)))
    .replace(/&amp;/g, '&');
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
  return m ? decodeEntities(m[1]) : undefined;
}

/** Resolves a relative href against a base directory. */
export function resolvePath(baseDir: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0]);
  if (clean.startsWith('/')) return clean.slice(1);
  const parts = `${baseDir}${clean}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    // ".." at the archive root stays at the root rather than escaping it.
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    css: 'text/css',
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    xhtml: 'application/xhtml+xml',
    html: 'text/html',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** Parses the TOC from EPUB 3 nav.xhtml, falling back to EPUB 2 toc.ncx. */
async function parseToc(
  buffer: ArrayBuffer,
  opf: string,
  opfDir: string,
  spinePaths: string[],
): Promise<TocEntry[]> {
  // EPUB 3: a manifest item with properties="nav".
  const navItem = [...opf.matchAll(/<item\b([^>]*)\/?>/gi)]
    .map((m) => m[1])
    .find((a) => (attr(a, 'properties') ?? '').split(/\s+/).includes('nav'));

  if (navItem) {
    const href = attr(navItem, 'href');
    if (href) {
      const navPath = resolvePath(opfDir, href);
      const nav = await readTextEntry(buffer, navPath);
      if (nav) {
        const toc: TocEntry[] = [];
        for (const m of nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
          const link = attr(m[1], 'href');
          if (!link) continue;
          const label = decodeEntities(m[2].replace(/<[^>]*>/g, '')).trim();
          if (!label) continue;
          toc.push({ label, path: resolvePath(dirOf(navPath), link), depth: 0 });
        }
        if (toc.length) return simplifyToc(toc);
      }
    }
  }

  // EPUB 2: toc.ncx with navPoints.
  const ncxItem = [...opf.matchAll(/<item\b([^>]*)\/?>/gi)]
    .map((m) => m[1])
    .find((a) => attr(a, 'media-type') === 'application/x-dtbncx+xml');
  const ncxHref = ncxItem ? attr(ncxItem, 'href') : undefined;
  if (ncxHref) {
    const ncxPath = resolvePath(opfDir, ncxHref);
    const ncx = await readTextEntry(buffer, ncxPath);
    if (ncx) {
      const toc: TocEntry[] = [];
      let depth = 0;
      for (const m of ncx.matchAll(/<navPoint\b|<\/navPoint>|<text>([\s\S]*?)<\/text>|<content\b([^>]*)\/?>/gi)) {
        if (m[0].startsWith('<navPoint')) depth += 1;
        else if (m[0].startsWith('</navPoint')) depth = Math.max(0, depth - 1);
        else if (m[1] !== undefined) {
          const label = decodeEntities(m[1].replace(/<[^>]*>/g, '')).trim();
          if (label) toc.push({ label, depth: Math.max(0, depth - 1) });
        } else if (m[2] !== undefined) {
          const src = attr(m[2], 'src');
          const last = toc[toc.length - 1];
          if (src && last && !last.path) last.path = resolvePath(dirOf(ncxPath), src);
        }
      }
      if (toc.length) return simplifyToc(toc);
    }
  }

  // Last resort: use the chapters themselves as the contents list.
  return spinePaths.map((p) => ({ label: p.split('/').pop() ?? p, path: p, depth: 0 }));
}

/** Collapses pointlessly nested toc entries and drops empties. */
function simplifyToc(toc: TocEntry[]): TocEntry[] {
  const minDepth = Math.min(...toc.map((t) => t.depth));
  return toc
    .filter((t) => t.label)
    .map((t) => ({ ...t, depth: Math.max(0, t.depth - minDepth) }))
    .slice(0, 500);
}

/** Opens an EPUB and prepares everything the reader needs. */
export async function openBook(buffer: ArrayBuffer): Promise<ParsedBook> {
  const container = await readTextEntry(buffer, 'META-INF/container.xml');
  if (!container) throw new ZipError('Not an EPUB: META-INF/container.xml is missing.');

  const opfPath = /<rootfile[^>]*full-path=["']([^"']+)["']/i.exec(container)?.[1];
  if (!opfPath) throw new ZipError('Not a readable EPUB: container.xml declares no rootfile.');

  const opf = await readTextEntry(buffer, opfPath);
  if (!opf) throw new ZipError(`Not a readable EPUB: the package document "${opfPath}" is missing.`);

  const opfDir = dirOf(opfPath);

  // Manifest: id -> {href, mediaType}
  const manifest = new Map<string, { path: string; mediaType: string }>();
  for (const m of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
    const attrs = m[1];
    const id = attr(attrs, 'id');
    const href = attr(attrs, 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      path: resolvePath(opfDir, href),
      mediaType: attr(attrs, 'media-type') ?? mimeFromName(href),
    });
  }

  // Spine: the reading order.
  const chapters: Chapter[] = [];
  for (const m of opf.matchAll(/<itemref\b([^>]*)\/?>/gi)) {
    const idref = attr(m[1], 'idref');
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item) continue;
    chapters.push({
      path: item.path,
      mediaType: item.mediaType,
      linear: attr(m[1], 'linear') !== 'no',
    });
  }
  if (chapters.length === 0) throw new ZipError('This EPUB has no readable chapters.');

  const title = decodeEntities(
    /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.replace(/<[^>]*>/g, '').trim() ?? '',
  );
  const creator = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1]?.replace(/<[^>]*>/g, '').trim();
  const language = /<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i.exec(opf)?.[1]?.trim();

  const linearPaths = chapters.filter((c) => c.linear).map((c) => c.path);
  const toc = await parseToc(buffer, opf, opfDir, linearPaths);

  return {
    title: title || 'Untitled',
    author: creator ? decodeEntities(creator) : undefined,
    language,
    chapters,
    toc,
    resources: new Map(),
    blobUrls: [],
  };
}

/** Hostile markup is removed rather than trusted. */
function sanitizeChapterHtml(html: string): string {
  return html
    // Scripts and embedded objects can never run in the reader anyway, but
    // removing them keeps them out of the DOM entirely.
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<(iframe|object|embed|applet)\b[\s\S]*?(?:<\/\1>|\/?>)/gi, '')
    .replace(/<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi, '')
    // Inline event handlers.
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    // javascript: URLs.
    .replace(/(href|src)\s*=\s*["']javascript:[^"']*["']/gi, '$1="#"');
}

/**
 * Produces a self-contained HTML document for one chapter.
 *
 * Relative references are rewritten to blob URLs so images, fonts and the
 * book's own stylesheets work without any network access. The result is meant
 * for a sandboxed iframe with scripts disabled.
 */
export async function chapterHtml(
  book: ParsedBook,
  chapter: Chapter,
  buffer: ArrayBuffer,
  readerCss: string,
): Promise<string> {
  const entries = listEntries(buffer);
  const entryByName = new Map(entries.map((e) => [e.name, e]));
  const raw = entryByName.get(chapter.path);
  if (!raw) throw new ZipError(`Chapter "${chapter.path}" is missing from the archive.`);
  if (raw.uncompressedSize > MAX_CHAPTER_BYTES) throw new ZipError('This chapter is too large to display.');

  let html = new TextDecoder('utf-8').decode(await readEntry(buffer, raw));

  // Extract <body> content; we supply our own document shell.
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  let body = bodyMatch ? bodyMatch[1] : html;
  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const head = headMatch ? headMatch[1] : '';

  const baseDir = dirOf(chapter.path);

  /** Ensures a resource has a blob URL and returns it. */
  const urlFor = async (target: string): Promise<string | null> => {
    const path = resolvePath(baseDir, target);
    const cached = book.resources.get(path);
    if (cached) return cached;
    const entry = entryByName.get(path);
    if (!entry || entry.uncompressedSize > MAX_RESOURCE_BYTES) return null;
    try {
      const bytes = await readEntry(buffer, entry);
      const blob = new Blob([bytes as BlobPart], { type: mimeFromName(path) });
      const url = URL.createObjectURL(blob);
      book.resources.set(path, url);
      book.blobUrls.push(url);
      return url;
    } catch {
      return null;
    }
  };

  // Rewrite src / href / poster attributes that point inside the archive.
  const attrRe = /\b(src|href|poster|xlink:href)\s*=\s*(["'])([^"']+)\2/gi;
  const rewrites: Array<{ from: string; to: string }> = [];
  for (const m of body.matchAll(attrRe)) {
    const target = m[3];
    if (!target || /^(https?:|data:|blob:|mailto:|#|javascript:)/i.test(target)) continue;
    // Links between chapters are handled by the reader, not resolved to blobs.
    const isLink = m[1].toLowerCase() === 'href';
    const resolved = resolvePath(baseDir, target);
    if (isLink && !/\.(css|png|jpe?g|gif|svg|webp|woff2?|ttf|otf)$/i.test(resolved)) continue;
    rewrites.push({ from: m[0], to: m[1] });
  }
  for (const { from } of rewrites) {
    const m = /\b(src|href|poster|xlink:href)\s*=\s*(["'])([^"']+)\2/i.exec(from);
    if (!m) continue;
    const url = await urlFor(m[3]);
    if (url) body = body.split(from).join(`${m[1]}="${url}"`);
  }

  // The book's own stylesheets, inlined and their images resolved.
  let bookCss = '';
  for (const m of head.matchAll(/<link\b([^>]*)\/?>/gi)) {
    if (!/stylesheet/i.test(attr(m[1], 'rel') ?? '')) continue;
    const href = attr(m[1], 'href');
    if (!href) continue;
    const cssPath = resolvePath(baseDir, href);
    const cssEntry = entryByName.get(cssPath);
    if (!cssEntry || cssEntry.uncompressedSize > MAX_RESOURCE_BYTES) continue;
    try {
      let css = new TextDecoder('utf-8').decode(await readEntry(buffer, cssEntry));
      const cssDir = dirOf(cssPath);
      for (const urlRef of [...css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)]) {
        const target = urlRef[2];
        if (/^(https?:|data:|blob:)/i.test(target)) continue;
        const resolved = resolvePath(cssDir, target);
        const entry = entryByName.get(resolved);
        if (!entry || entry.uncompressedSize > MAX_RESOURCE_BYTES) continue;
        try {
          const bytes = await readEntry(buffer, entry);
          const blob = new Blob([bytes as BlobPart], { type: mimeFromName(resolved) });
          const url = URL.createObjectURL(blob);
          book.blobUrls.push(url);
          css = css.split(urlRef[0]).join(`url("${url}")`);
        } catch {
          // A missing font or image is not fatal.
        }
      }
      bookCss += `\n${css}`;
    } catch {
      // Skip an unreadable stylesheet.
    }
  }

  body = sanitizeChapterHtml(body);

  return `<!doctype html>
<html lang="${book.language ?? 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
/* The book's own styles first, then ours: page geometry must win. */
${bookCss}
${readerCss}
</style>
</head>
<body><div id="book-content">${body}</div></body>
</html>`;
}

/** Releases every blob URL a book created. */
export function closeBook(book: ParsedBook): void {
  for (const url of book.blobUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Already released.
    }
  }
  book.blobUrls.length = 0;
  book.resources.clear();
}



