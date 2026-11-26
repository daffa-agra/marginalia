/*
 * Unit tests for the sync merge.
 *
 * This is the code that can silently eat a reader's writing, so every branch is
 * exercised here. The cases are named after the failure they prevent.
 */
const path = require('path');
const assert = require('assert');

const dist = path.join(__dirname, '..', 'dist-smoke');
const { mergeCollection, mergeJournals, pendingOf, gcTombstones } = require(path.join(dist, 'lib', 'merge.js'));

let pass = 0;
let fail = 0;
function ok(name) {
  pass += 1;
  console.log(`✓ ${name}`);
}
function bad(name, detail) {
  fail += 1;
  console.log(`✗ ${name} — ${detail}`);
}
function check(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    bad(name, e.message);
  }
}

const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, ...extra });
const tomb = (id, updatedAt) => ({ id, updatedAt, deletedAt: updatedAt });

(async () => {
  /* ── presence ── */

  check('a record only the remote side has is adopted', () => {
    const { merged, stats } = mergeCollection('books', [], [rec('a', 10)]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].id, 'a');
    assert.strictEqual(stats.added, 1);
  });

  check('a record only the local side has is kept', () => {
    const { merged } = mergeCollection('books', [rec('a', 10)], []);
    assert.strictEqual(merged.length, 1, 'local record survives an empty remote');
  });

  check('a remote tombstone for an unknown record is adopted, not ignored', () => {
    // Otherwise a book deleted on another device would come back on this one.
    const { merged } = mergeCollection('books', [], [tomb('a', 10)]);
    assert.strictEqual(merged.length, 1);
    assert.ok(merged[0].deletedAt, 'the tombstone is kept');
  });

  /* ── edits ── */

  check('the newer edit wins', () => {
    const { merged } = mergeCollection('books', [rec('a', 10, { title: 'old' })], [rec('a', 20, { title: 'new' })]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].title, 'new');
  });

  check('an older edit does not overwrite a newer one', () => {
    const { merged } = mergeCollection('books', [rec('a', 20, { title: 'new' })], [rec('a', 10, { title: 'old' })]);
    assert.strictEqual(merged[0].title, 'new', 'the newer local edit survives a stale push');
  });

  /* ── deletes ── */

  check('a delete propagates over an older edit', () => {
    const { merged } = mergeCollection('books', [rec('a', 10, { title: 'x' })], [tomb('a', 20)]);
    assert.ok(merged[0].deletedAt, 'the delete wins');
  });

  check('a delete does not resurrect from a stale copy', () => {
    // The classic bug: device B was offline and pushes its old copy.
    const { merged } = mergeCollection('books', [tomb('a', 20)], [rec('a', 10, { title: 'stale' })]);
    assert.ok(merged[0].deletedAt, 'the tombstone holds');
  });

  check('an edit after a delete brings the record back', () => {
    // Deliberate: the user wrote after deleting, so they mean it.
    const { merged } = mergeCollection('books', [tomb('a', 10)], [rec('a', 20, { title: 'back' })]);
    assert.ok(!merged[0].deletedAt, 'the newer edit wins');
    assert.strictEqual(merged[0].title, 'back');
  });

  /* ── conflicts ── */

  check('two edits in the same millisecond keep both and report a conflict', () => {
    const local = rec('a', 10, { title: 'mine' });
    const remote = rec('a', 10, { title: 'theirs' });
    const { merged, conflicts, stats } = mergeCollection('books', [local], [remote]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].title, 'mine', 'local is kept as the visible body');
    assert.strictEqual(conflicts.length, 1, 'the tie is reported');
    assert.strictEqual(conflicts[0].local.title, 'mine');
    assert.strictEqual(conflicts[0].remote.title, 'theirs', 'the losing body is not discarded');
    assert.strictEqual(stats.conflicts, 1);
  });

  check('a conflict names the collection and record', () => {
    const { conflicts } = mergeCollection(
      'quotes',
      [rec('q1', 5, { text: 'mine' })],
      [rec('q1', 5, { text: 'theirs' })],
    );
    assert.strictEqual(conflicts[0].kind, 'quotes');
    assert.strictEqual(conflicts[0].id, 'q1');
  });

  check('identical bodies in the same millisecond are agreement, not a conflict', () => {
    // Two devices that wrote the same thing have agreed; reporting it would
    // teach the reader to ignore the notice when it matters.
    const { merged, conflicts } = mergeCollection(
      'books',
      [rec('a', 10, { title: 'same' })],
      [rec('a', 10, { title: 'same' })],
    );
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(conflicts.length, 0, 'no conflict is raised for identical content');
  });

  /* ── idempotence, which is what makes a retry safe ── */

  check('merging the same data twice changes nothing', () => {
    const local = [rec('a', 20, { t: 'new' }), rec('b', 10, { t: 'b' })];
    const remote = [rec('a', 10, { t: 'old' }), rec('c', 15, { t: 'c' })];
    const once = mergeCollection('books', local, remote);
    const twice = mergeCollection('books', once.merged, remote);
    const key = (list) => JSON.stringify([...list].sort((x, y) => x.id.localeCompare(y.id)));
    assert.strictEqual(key(twice.merged), key(once.merged), 'a second merge is a no-op');
    assert.strictEqual(twice.conflicts.length, 0, 'a retry does not re-report settled conflicts');
  });

  check('order of arguments does not change the winner', () => {
    const a = rec('a', 20, { t: 'newer' });
    const b = rec('a', 10, { t: 'older' });
    const forward = mergeCollection('books', [b], [a]).merged[0].t;
    const backward = mergeCollection('books', [a], [b]).merged[0].t;
    assert.strictEqual(forward, 'newer');
    assert.strictEqual(backward, 'newer', 'the newer record wins in both directions');
  });

  /* ── whole-journal merge ── */

  check('mergeJournals merges every collection', () => {
    const result = mergeJournals(
      { books: [rec('b1', 10)], quotes: [rec('q1', 10)], shelves: [], positions: [] },
      { books: [], quotes: [], shelves: [rec('s1', 10)], positions: [rec('p1', 10)] },
    );
    assert.strictEqual(result.changes.books.length, 1);
    assert.strictEqual(result.changes.quotes.length, 1);
    assert.strictEqual(result.changes.shelves.length, 1);
    assert.strictEqual(result.changes.positions.length, 1);
    assert.strictEqual(result.stats.added, 2);
  });

  check('mergeJournals tolerates a missing collection', () => {
    // An older client may not send shelves at all.
    const result = mergeJournals(
      { books: [rec('b1', 1)], quotes: [], shelves: [], positions: [] },
      { books: [], quotes: [] },
    );
    assert.strictEqual(result.changes.books.length, 1);
    assert.ok(Array.isArray(result.changes.shelves));
  });

  /* ── pending and GC ── */

  check('pendingOf only reports records newer than the acknowledged revision', () => {
    const records = [rec('a', 5), rec('b', 15), rec('c', 25)];
    const pending = pendingOf(records, 10);
    assert.deepStrictEqual(pending.map((r) => r.id), ['b', 'c']);
  });

  check('gcTombstones keeps recent tombstones and drops old ones', () => {
    const now = 1_000_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    const records = [
      rec('live', now),
      tomb('recent', now - 10 * day),
      tomb('old', now - 200 * day),
    ];
    const kept = gcTombstones(records, now);
    assert.deepStrictEqual(kept.map((r) => r.id).sort(), ['live', 'recent']);
  });

  check('gcTombstones never removes a live record', () => {
    const now = Date.now();
    const kept = gcTombstones([rec('a', 0)], now);
    assert.strictEqual(kept.length, 1, 'an unedited live record is untouched by GC');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
