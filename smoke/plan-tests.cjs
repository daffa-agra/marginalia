/* Reading plan: queue ordering, pace measurement, forecast, and the UI. */
const path = require('path');
const assert = require('assert');

const dist = path.join(__dirname, '..', 'dist-smoke');
const { queueOf, reindexAfterRemoval, nextUp, measurePace, forecastQueue } = require(
  path.join(dist, 'lib', 'plan.js'),
);

function book(id, overrides = {}) {
  return {
    id,
    title: `Book ${id}`,
    author: 'A',
    status: 'want-to-read',
    currentPage: 0,
    genres: [],
    color: '#3f6f71',
    createdAt: 1,
    ...overrides,
  };
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/* --- ordering --- */
{
  const books = [
    book('a', { queuePosition: 2 }),
    book('b', { queuePosition: 0 }),
    book('c'),
    book('d', { queuePosition: 1 }),
  ];
  const queue = queueOf(books);
  assert.deepStrictEqual(queue.map((b) => b.id), ['b', 'd', 'a'], 'queue sorted by position');
  assert.strictEqual(nextUp(books).id, 'b', 'head of queue');
  assert.strictEqual(queueOf([]).length, 0, 'empty queue');
  assert.strictEqual(nextUp([book('x')]), undefined, 'no queue, no next');
  console.log('✓ queue ordering and head');
}

/* --- gap closing on removal --- */
{
  const queue = [book('a'), book('b'), book('c')];
  const after = reindexAfterRemoval(queue, 1);
  assert.deepStrictEqual(after, [
    { id: 'a', queuePosition: 0 },
    { id: 'c', queuePosition: 1 },
  ], 'positions close the gap');
  assert.deepStrictEqual(reindexAfterRemoval(queue, 0), [
    { id: 'b', queuePosition: 0 },
    { id: 'c', queuePosition: 1 },
  ], 'removing the head shifts the rest');
  console.log('✓ removal closes the gap');
}

/* --- pace: refuses to guess from thin history --- */
{
  const one = measurePace([book('a', { status: 'finished', finishedAt: daysAgo(2) })]);
  assert.strictEqual(one.confident, false, 'one book is not a pace');
  assert.strictEqual(one.sampleSize, 1);

  const three = measurePace([
    book('a', { status: 'finished', finishedAt: daysAgo(2) }),
    book('b', { status: 'finished', finishedAt: daysAgo(30) }),
    book('c', { status: 'finished', finishedAt: daysAgo(60) }),
  ]);
  assert.strictEqual(three.confident, true, 'three books is a pace');
  assert.ok(three.booksPerWeek > 0, 'pace is positive');

  // Books finished outside the 90-day window do not count.
  const old = measurePace([book('a', { status: 'finished', finishedAt: daysAgo(200) })]);
  assert.strictEqual(old.sampleSize, 0, 'old finishes excluded');

  // Unfinished books never count.
  const mixed = measurePace([
    book('a', { status: 'reading', finishedAt: daysAgo(1) }),
    book('b', { status: 'finished' }),
  ]);
  assert.strictEqual(mixed.sampleSize, 0, 'only dated finished books count');
  console.log('✓ pace measured from recent finished books only');
}

/* --- forecast --- */
{
  const pace = { booksPerWeek: 2, sampleSize: 6, confident: true };
  const f = forecastQueue([book('a', { queuePosition: 0 }), book('b', { queuePosition: 1 })], pace);
  assert.strictEqual(f.queued, 2);
  assert.strictEqual(f.weeksToClear, 1, '2 books at 2/week is one week');
  assert.ok(f.clearBy, 'a clear-by date is produced');
  assert.strictEqual(f.insufficientHistory, false);

  const empty = forecastQueue([book('x')], pace);
  assert.strictEqual(empty.queued, 0);
  assert.strictEqual(empty.clearBy, null);

  const unknown = forecastQueue([book('a', { queuePosition: 0 })], {
    booksPerWeek: 0,
    sampleSize: 1,
    confident: false,
  });
  assert.strictEqual(unknown.weeksToClear, null, 'no forecast without a pace');
  assert.strictEqual(unknown.insufficientHistory, true);
  console.log('✓ forecast, empty queue, and insufficient history');
}

/* --- sanitizer accepts queue positions --- */
{
  const { sanitizeData } = require(path.join(dist, 'storage.js'));
  const clean = sanitizeData({
    books: [
      { id: 'a', title: 'A', queuePosition: 3 },
      { id: 'b', title: 'B', queuePosition: -1 },
      { id: 'c', title: 'C', queuePosition: 'nope' },
      { id: 'd', title: 'D' },
    ],
    quotes: [],
    shelves: [],
  });
  assert.strictEqual(clean.books[0].queuePosition, 3, 'valid position kept');
  assert.strictEqual(clean.books[1].queuePosition, 0, 'negative clamped to 0');
  assert.strictEqual(clean.books[2].queuePosition, undefined, 'non-numeric dropped');
  assert.strictEqual(clean.books[3].queuePosition, undefined, 'absent stays absent');
  console.log('✓ queuePosition sanitised');
}

console.log('\nAll reading plan tests passed.');
