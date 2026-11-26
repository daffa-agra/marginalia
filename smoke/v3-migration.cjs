/*
 * Migration and durable-diff tests: v2 localStorage -> v3 records, tombstone
 * diffing, and outbox generation. Pure logic — no IDB required.
 * Run with: node smoke/v3-migration.cjs   (after tsc -p tsconfig.smoke.json)
 */
const path = require('path');
const assert = require('assert');

const dist = path.join(__dirname, '..', 'dist-smoke');
const { prepareMigration } = require(path.join(dist, 'lib/migrate'));
const { diffJournal, SCHEMA_VERSION } = require(path.join(dist, 'lib/journalStore'));
const { sanitizeData, emptyData } = require(path.join(dist, 'storage'));

// --- 1. A realistic v2 payload migrates byte-faithfully --------------------
const v2 = {
  version: 1,
  books: [
    { id: 'b-1', title: 'Piranesi', author: 'Susanna Clarke', status: 'reading', currentPage: 94,
      totalPages: 245, genres: ['Fantasy'], color: '#123', createdAt: 'not-a-number' },
    { id: 'b-broken', title: '' },
    null,
    'garbage',
    { id: 'b-2', title: 'The Overstory', author: 'Richard Powers', status: 'finished',
      shelfId: 's-1', createdAt: 1700000000000 },
  ],
  quotes: [
    { id: 'q-1', bookId: 'b-1', text: 'The Beauty of the House is immeasurable', position: '40%',
      createdAt: 1700000001000 },
    { id: 'q-orphan', bookId: 'b-missing', text: 'should be dropped' },
    { id: 'q-bad' },
  ],
  shelves: [
    { id: 's-1', name: 'Bedside', sortOrder: 0, createdAt: 1700000002000 },
    { id: 's-bad', name: '' },
  ],
};
const outcome = prepareMigration(JSON.stringify(v2));
assert.ok(outcome, 'v2 payload produces an outcome');
assert.equal(outcome.result.migratedFrom, 2);
const data = outcome.result.data;
assert.equal(data.books.length, 2, 'malformed books dropped, 2 kept');
assert.equal(data.entries.length, 0, 'v2 has no entries');
const piranesi = data.books.find((b) => b.id === 'b-1');
assert.ok(piranesi.updatedAt > 0, 'createdAt-less book gets a stamped updatedAt');
assert.equal(piranesi.createdAt > 0, true, 'bad createdAt replaced with a real timestamp');
const overstory = data.books.find((b) => b.id === 'b-2');
assert.equal(overstory.createdAt, 1700000000000, 'existing createdAt survives');
assert.ok(overstory.updatedAt >= overstory.createdAt, 'updatedAt stamped');
assert.equal(data.quotes.length, 1, 'orphan and malformed quotes dropped');
assert.equal(data.shelves.length, 1);
console.log('✓ v2 → v3 migration sanitizes and stamps');

// --- 2. Corrupt v2 data blocks the migration instead of losing it ----------
assert.throws(() => prepareMigration('{"books": [{'), /corrupt/i);
assert.equal(prepareMigration(null), null);
console.log('✓ corrupt legacy data throws, absence returns null');

// --- 3. Diffing: create, change, delete-as-tombstone ------------------------
const now = 1700000100000;
const base = sanitizeData({
  version: 3,
  books: [v2.books[0]],
  quotes: [v2.quotes[0]],
  shelves: [v2.shelves[0]],
  entries: [],
});

const next = {
  version: SCHEMA_VERSION,
  books: [
    { ...base.books[0], currentPage: 120 },
    { id: 'b-3', title: 'New book', author: '', status: 'want-to-read', currentPage: 0,
      genres: [], color: '#333', createdAt: now, updatedAt: now },
  ],
  quotes: [],
  shelves: base.shelves,
  entries: [],
};

const empty = emptyData();
const noDiff = diffJournal(next, next, now);
assert.deepEqual(
  [noDiff.books.length, noDiff.quotes.length, noDiff.shelves.length, noDiff.entries.length],
  [0, 0, 0, 0],
  'comparing a journal with itself produces no writes',
);

const first = diffJournal(null, base, now);
assert.equal(first.books.length, 1, 'first save writes every record');
assert.ok(first.outbox.length >= 2, 'first save queues outbox rows');

const diff = diffJournal(base, next, now);
const changedBook = diff.books.find((b) => b.id === 'b-1');
assert.equal(changedBook.currentPage, 120, 'changed record included');
assert.equal(changedBook.updatedAt, now, 'changed record restamped');
const newBook = diff.books.find((b) => b.id === 'b-3');
assert.ok(newBook, 'new record included');
const removed = diff.quotes[0];
assert.equal(removed.id, 'q-1', 'removed quote captured');
assert.equal(removed.deletedAt, now, 'removed quote kept as tombstone, never dropped');
assert.ok(diff.outbox.some((row) => row.store === 'quotes' && row.record.deletedAt === now),
  'outbox queues the tombstone');
assert.equal(diff.outbox.length, 3, 'one outbox row per write');
console.log('✓ record diff stamps changes and keeps tombstones');

// --- 4. Tombstones survive a later round trip through the sanitizer ---------
const restored = sanitizeData(JSON.parse(JSON.stringify({
  version: 3,
  books: [base.books[0]], quotes: [removed], shelves: [], entries: [],
})));
assert.equal(restored.quotes[0].deletedAt, now, 'tombstone deletedAt survives sanitization');
console.log('✓ tombstones survive the sanitizer');

console.log('\nAll migration tests passed.');
