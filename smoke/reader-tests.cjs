/* Unit tests for the reader: opening a book, TOC, chapters, sanitising. */
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const dist = path.join(__dirname, '..', 'dist-smoke');
const { openBook, chapterHtml, resolvePath, closeBook } = require(path.join(dist, 'lib', 'epubBook.js'));
const { bookProgress, clampFraction, normalisePosition, chapterLabel } = require(
  path.join(dist, 'lib', 'readingPosition.js'),
);

const FIXTURE = path.join(__dirname, '..', '.review', 'fixtures', 'reader-test.epub');

if (!fs.existsSync(FIXTURE)) {
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'make-reader-fixture.cjs')], {
    stdio: 'ignore',
  });
}

function arrayBuffer(file) {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

(async () => {
  const buffer = arrayBuffer(FIXTURE);

  /* --- opening --- */
  const book = await openBook(buffer);
  assert.strictEqual(book.title, 'Six Chapters of Sea', 'title from OPF');
  assert.strictEqual(book.author, 'Marina Voss', 'author from OPF');
  assert.strictEqual(book.language, 'en', 'language');
  assert.strictEqual(book.chapters.length, 6, 'six spine chapters');
  assert.ok(book.chapters.every((c) => c.linear), 'all chapters linear');
  console.log(`✓ opened book (${book.chapters.length} chapters)`);

  /* --- table of contents --- */
  assert.strictEqual(book.toc.length, 6, 'six TOC entries from nav.xhtml');
  assert.match(book.toc[0].label, /Lighthouse/, 'first TOC label');
  assert.ok(book.toc.every((t) => t.path), 'every TOC entry resolves to a chapter');
  const resolved = book.toc.map((t) => book.chapters.findIndex((c) => c.path === t.path));
  assert.deepStrictEqual(resolved, [0, 1, 2, 3, 4, 5], 'TOC entries map to chapters in order');
  console.log('✓ table of contents from EPUB 3 nav');

  /* --- chapter rendering --- */
  const css = '.reader-test-marker { color: red; }';
  const html = await chapterHtml(book, book.chapters[0], buffer, css);
  assert.match(html, /<!doctype html>/i, 'produces a document');
  assert.match(html, /Chapter 1/, 'chapter body present');
  assert.match(html, /reader-test-marker/, 'reader CSS injected');
  assert.match(html, /font-family: Georgia/, 'book CSS inlined');
  assert.doesNotMatch(html, /<script/i, 'no script survives');
  console.log('✓ chapter rendered as a self-contained document');

  /* --- images become blob urls --- */
  const plateChapter = book.chapters[2];
  const plateHtml = await chapterHtml(book, plateChapter, buffer, css);
  assert.match(plateHtml, /<img[^>]+src="blob:/, 'image rewritten to a blob URL');
  assert.ok(book.blobUrls.length > 0, 'blob URLs tracked for cleanup');
  console.log(`✓ embedded image resolved to blob URL (${book.blobUrls.length} tracked)`);

  /* --- hostile markup --- */
  const hostile = { path: 'OEBPS/hostile.xhtml', mediaType: 'application/xhtml+xml', linear: false };
  const hostileHtml = await chapterHtml(book, hostile, buffer, css);
  assert.doesNotMatch(hostileHtml, /<script/i, 'script element removed');
  assert.doesNotMatch(hostileHtml, /onclick\s*=/i, 'inline handler removed');
  assert.doesNotMatch(hostileHtml, /onerror\s*=/i, 'onerror removed');
  assert.doesNotMatch(hostileHtml, /javascript:/i, 'javascript: URL neutralised');
  assert.match(hostileHtml, /Hostile/, 'content itself preserved');
  console.log('✓ hostile markup neutralised');

  /* --- cleanup releases blob URLs --- */
  const before = book.blobUrls.length;
  closeBook(book);
  assert.strictEqual(book.blobUrls.length, 0, 'blob URLs released');
  assert.strictEqual(book.resources.size, 0, 'resource map cleared');
  console.log(`✓ closeBook released ${before} blob URLs`);

  /* --- path resolution --- */
  assert.strictEqual(resolvePath('OEBPS/', 'ch1.xhtml'), 'OEBPS/ch1.xhtml');
  assert.strictEqual(resolvePath('OEBPS/', '../images/a.png'), 'images/a.png');
  assert.strictEqual(resolvePath('OEBPS/text/', '../styles/b.css'), 'OEBPS/styles/b.css');
  assert.strictEqual(resolvePath('', '/root.png'), 'root.png');
  assert.strictEqual(resolvePath('OEBPS/', 'ch1.xhtml#frag'), 'OEBPS/ch1.xhtml');
  console.log('✓ path resolution (relative, parent traversal, absolute, fragments)');

  /* --- position maths --- */
  assert.strictEqual(clampFraction(-1), 0);
  assert.strictEqual(clampFraction(2), 1);
  assert.strictEqual(clampFraction(NaN), 0);
  assert.strictEqual(bookProgress(null, 10), 0);
  assert.strictEqual(bookProgress({ chapter: 0, fraction: 0, updatedAt: 0 }, 10), 0);
  assert.strictEqual(bookProgress({ chapter: 9, fraction: 1, updatedAt: 0 }, 10), 100);
  assert.strictEqual(bookProgress({ chapter: 5, fraction: 0, updatedAt: 0 }, 10), 50);
  const norm = normalisePosition({ chapter: 99, fraction: 5 }, 6);
  assert.strictEqual(norm.chapter, 5, 'chapter clamped to last');
  assert.strictEqual(norm.fraction, 1, 'fraction clamped');
  assert.strictEqual(chapterLabel({ chapter: 2, fraction: 0, updatedAt: 0 }, 6), '3 of 6');
  console.log('✓ position clamping and progress');

  /* --- a non-EPUB is rejected --- */
  await assert.rejects(
    () => openBook(new TextEncoder().encode('not a zip').buffer),
    /ZIP|zip/i,
    'non-zip rejected',
  );
  console.log('✓ non-EPUB rejected with a named error');

  console.log('\nAll reader tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
