/* Unit tests for the EPUB/ZIP parser, run against real fixtures.
 * Compiled from src/ via tsconfig.smoke.json into dist-smoke.
 */
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const dist = path.join(__dirname, '..', 'dist-smoke');
const { extractEpubMetadata, looksLikeEpub, ZipError } = require(path.join(dist, 'lib', 'epub.js'));
const { listEntries, readTextEntry } = require(path.join(dist, 'lib', 'zip.js'));

const fixture = path.join(__dirname, '..', '.review', 'fixtures', 'lighthouse.epub');
const broken = path.join(__dirname, '..', '.review', 'fixtures', 'lighthouse-broken.epub');

// The fixtures are generated, not committed, so a fresh checkout has none.
// Build them on demand rather than failing with a confusing ENOENT.
if (!fs.existsSync(fixture) || !fs.existsSync(broken)) {
  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, [path.join(__dirname, 'make-epub-fixture.cjs')], { stdio: 'ignore' });
}

if (!fs.existsSync(fixture)) {
  console.error('Could not generate the EPUB fixtures. Run node smoke/make-epub-fixture.cjs first.');
  process.exit(1);
}

async function toArrayBuffer(file) {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

(async () => {
  // --- ZIP reading ---
  const buffer = await toArrayBuffer(fixture);
  const entries = listEntries(buffer);
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('mimetype'), 'mimetype entry present');
  assert.ok(names.includes('META-INF/container.xml'), 'container present');
  assert.ok(names.includes('OEBPS/content.opf'), 'opf present');
  assert.strictEqual(entries.length, 8, 'eight entries');

  const mimetype = await readTextEntry(buffer, 'mimetype');
  assert.strictEqual(mimetype, 'application/epub+zip', 'mimetype content');
  console.log(`✓ ZIP reader (${entries.length} entries, deflate + stored)`);

  // --- EPUB metadata ---
  const meta = await extractEpubMetadata(buffer);
  assert.strictEqual(meta.title, "The Lighthouse Keeper's Daughter", 'title from dc:title');
  assert.strictEqual(meta.author, 'Eleanor Voss', 'author from dc:creator');
  assert.strictEqual(meta.language, 'en', 'language');
  assert.strictEqual(meta.identifier, 'urn:uuid:test-1234', 'identifier');
  assert.strictEqual(meta.publisher, 'Salt & Signal Press', 'xml entity decoded in publisher');
  assert.strictEqual(meta.spineItems, 3, 'three spine items');
  assert.ok(meta.cover, 'cover image found via properties="cover-image"');
  assert.strictEqual(meta.cover.mime, 'image/svg+xml', 'cover mime from extension');
  assert.ok(meta.cover.bytes.length > 0, 'cover bytes non-empty');
  console.log(`✓ EPUB metadata (title, author, language, publisher, cover, ${meta.spineItems} chapters)`);

  // --- Failure path ---
  const brokenBuffer = await toArrayBuffer(broken);
  await assert.rejects(
    () => extractEpubMetadata(brokenBuffer),
    (err) => err instanceof ZipError && /container\.xml is missing/.test(err.message),
    'missing container.xml is a named error',
  );
  console.log('✓ Broken EPUB produces a named error, not a crash');

  // --- Guard rails ---
  assert.strictEqual(looksLikeEpub('book.epub', 1000).ok, true);
  assert.strictEqual(looksLikeEpub('book.pdf', 1000).ok, false);
  assert.strictEqual(looksLikeEpub('book.epub', 0).ok, false);
  assert.strictEqual(looksLikeEpub('book.epub', 101 * 1024 * 1024).ok, false);
  console.log('✓ File guard rails (extension, empty, size cap)');

  // --- Not a zip at all ---
  // listEntries is synchronous, so the throw is caught directly.
  const junk = new TextEncoder().encode('this is definitely not a zip file').buffer;
  assert.throws(
    () => listEntries(junk),
    (err) => err.name === 'ZipError',
    'non-zip input rejected with a named error',
  );
  console.log('✓ Non-ZIP input rejected with a named error');

  // --- Storage sanitisation of shelves ---
  const { sanitizeData, makeShelf, mergeData } = require(path.join(dist, 'storage.js'));
  const dirty = {
    version: 1,
    books: [
      { id: 'b1', title: 'Shelved', status: 'reading', currentPage: 1, shelfId: 's1' },
      { id: 'b2', title: 'Orphaned shelf', status: 'reading', currentPage: 1, shelfId: 'gone' },
      { id: 'b3', title: 'No shelf', status: 'reading', currentPage: 1 },
    ],
    quotes: [],
    shelves: [
      { id: 's1', name: 'Bedside', sortOrder: 0, createdAt: 1 },
      { id: '', name: 'Invalid' },
      { id: 's2', name: '   ' },
      null,
    ],
  };
  const clean = sanitizeData(dirty);
  assert.strictEqual(clean.shelves.length, 1, 'invalid shelves dropped');
  assert.strictEqual(clean.books[0].shelfId, 's1', 'valid shelf kept');
  assert.strictEqual(clean.books[1].shelfId, undefined, 'dangling shelfId cleared to Unshelved');
  assert.strictEqual(clean.books[2].shelfId, undefined, 'missing shelfId stays undefined');
  console.log('✓ Shelves sanitise (invalid dropped, dangling refs fall back to Unshelved)');

  // --- Partition invariant: every book sits in at most one place ---
  const shelfIds = new Set(clean.shelves.map((s) => s.id));
  for (const book of clean.books) {
    assert.ok(!book.shelfId || shelfIds.has(book.shelfId), 'no book points at a missing shelf');
  }
  const counts = new Map();
  for (const b of clean.books) {
    const key = b.shelfId ?? 'unshelved';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sum = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, clean.books.length, 'shelf counts partition the library');
  console.log(`✓ One-book-one-shelf partition (${[...counts.entries()].map(([k, v]) => `${k}:${v}`).join(' ')})`);

  // --- Shelf merge by id ---
  const shelfA = { id: 's-a', name: 'A', sortOrder: 0, createdAt: 1 };
  const shelfB = { id: 's-b', name: 'B', sortOrder: 1, createdAt: 2 };
  const merged = mergeData(
    { version: 1, books: [], quotes: [], shelves: [shelfA] },
    { version: 1, books: [], quotes: [], shelves: [shelfA, shelfB] },
  );
  assert.strictEqual(merged.shelves.length, 2, 'shelf merge keeps distinct ids');
  assert.strictEqual(merged.shelves[0].id, 's-a', 'existing shelf preserved');

  // makeShelf always mints a new id, so two calls can never collide.
  const generated = [makeShelf('A', 0), makeShelf('A', 1)];
  assert.notStrictEqual(generated[0].id, generated[1].id, 'same name, distinct ids');
  assert.strictEqual(generated[0].name, 'A', 'name trimmed and kept');
  console.log('✓ Shelf merge dedupes by id; same name yields distinct ids');

  // --- File metadata guard ---
  const withFile = sanitizeData({
    version: 1,
    books: [
      { id: 'b1', title: 'Has file', status: 'reading', currentPage: 0, file: { fileName: 'a.epub', size: 1234 } },
      { id: 'b2', title: 'Bad file', status: 'reading', currentPage: 0, file: { fileName: 'b.epub' } },
    ],
    quotes: [],
    shelves: [],
  });
  assert.ok(withFile.books[0].file, 'valid file ref kept');
  assert.strictEqual(withFile.books[1].file, undefined, 'file ref without size dropped');
  console.log('✓ EPUB file references sanitise');

  console.log('\nAll EPUB, shelf and file tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
