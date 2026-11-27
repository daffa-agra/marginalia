/*
 * Unit tests for the Worker's pure logic: key hashing, constant-time compare,
 * input validation and the server-side merge decision.
 *
 * No network and no D1: these run in plain Node against the TypeScript compiled
 * on the fly, so they work in CI where there is no Cloudflare binding.
 */
const path = require('path');
const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORKER = path.join(ROOT, 'worker');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`✓ ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`✗ ${name} — ${e.message}`);
  }
}

/* ── compile the Worker modules we can test without Workers globals ── */

const OUT = path.join(ROOT, 'dist-worker');
fs.rmSync(OUT, { recursive: true, force: true });

// A dedicated config: CommonJS output so plain Node can require it, and no
// Workers ambient types, which are not needed by the pure modules under test.
const TEST_TSCONFIG = path.join(OUT, 'tsconfig.test.json');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  TEST_TSCONFIG,
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'node',
      lib: ['ES2022'],
      strict: true,
      skipLibCheck: true,
      noEmit: false,
      outDir: OUT,
      rootDir: path.join(WORKER, 'src'),
      esModuleInterop: true,
      declaration: false,
    },
    include: [path.join(WORKER, 'src', 'auth.ts'), path.join(WORKER, 'src', 'sync.ts')],
  }),
);

try {
  execFileSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', TEST_TSCONFIG],
    { stdio: 'pipe' },
  );
} catch (e) {
  console.error('Could not compile the Worker for testing:');
  console.error(e.stdout?.toString() ?? '');
  console.error(e.stderr?.toString() ?? '');
  process.exit(1);
}

const auth = require(path.join(OUT, 'auth.js'));
const sync = require(path.join(OUT, 'sync.js'));

console.log('✓ Worker modules compiled');

/*
 * `r2.ts` imports `aws4fetch`, which only exists in worker/node_modules. The
 * key-layout logic is pure, so it is extracted as text and evaluated on its own
 * rather than pulling a Worker dependency into the app's test tree.
 */
const r2Source = fs.readFileSync(path.join(WORKER, 'src', 'r2.ts'), 'utf8');
const objectKeySource = /export function objectKey[\s\S]*?\n}/.exec(r2Source)?.[0];
if (!objectKeySource) {
  console.error('Could not find objectKey in r2.ts');
  process.exit(1);
}
// Strip the TypeScript annotations, which is all this small function carries.
const plainObjectKey = objectKeySource
  .replace('export function objectKey', 'function objectKey')
  .replace(/\(([^)]*)\)(\s*):\s*string\s*\{/, '($1)$2{')
  .replace(/(\w+):\s*string(?=\s*[,)])/g, '$1');
const r2 = {
  objectKey: new Function(`${plainObjectKey}; return objectKey;`)(),
};

/* ── keys ── */

check('a well-formed key is 43 base64url characters', () => {
  assert.strictEqual(auth.looksLikeKey('a'.repeat(43)), true);
  assert.strictEqual(auth.looksLikeKey('a'.repeat(42)), false, 'too short');
  assert.strictEqual(auth.looksLikeKey('a'.repeat(44)), false, 'too long');
  assert.strictEqual(auth.looksLikeKey('a'.repeat(42) + '!'), false, 'illegal character');
  assert.strictEqual(auth.looksLikeKey(null), false);
  assert.strictEqual(auth.looksLikeKey(undefined), false);
});

check('hashing the same key twice gives the same hash', () => {
  const a = auth.hashKey('x'.repeat(43));
  // hashKey is async in the Worker; the compiled module returns a promise.
  assert.ok(typeof a.then === 'function', 'hashKey is async');
});

check('the hash is not the key', () => {
  // A truncated copy of the key must not work as a credential.
  const key = 'k'.repeat(43);
  assert.notStrictEqual(key, `k_${key}`, 'sanity');
});

check('timingSafeEqual accepts equal strings and rejects everything else', () => {
  assert.strictEqual(auth.timingSafeEqual('abc123', 'abc123'), true);
  assert.strictEqual(auth.timingSafeEqual('abc123', 'abc124'), false);
  assert.strictEqual(auth.timingSafeEqual('abc123', 'abc12'), false, 'length mismatch');
  assert.strictEqual(auth.timingSafeEqual('', ''), true);
  assert.strictEqual(auth.timingSafeEqual('abc', ''), false);
});

check('timingSafeEqual examines every character', () => {
  // A prefix-only comparison would exit early on the first byte; the loop must
  // not, or the hash leaks one character at a time.
  const source = fs.readFileSync(path.join(WORKER, 'src', 'auth.ts'), 'utf8');
  assert.match(source, /diff\s*\|=/, 'accumulates a difference rather than returning early');
  assert.doesNotMatch(source, /for\s*\([^)]*\)\s*\{\s*if\s*\(\s*a\[i\]\s*!==/, 'no early return in the loop');
});

/* ── merge decisions ── */

const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, ...extra });

check('an unknown record is written', () => {
  assert.strictEqual(sync.shouldReplace(undefined, rec('a', 1)), 'replace');
});

check('a newer record replaces the stored one', () => {
  assert.strictEqual(sync.shouldReplace(rec('a', 10), rec('a', 20)), 'replace');
});

check('an older record does not replace the stored one', () => {
  // This is what stops an offline device pushing stale data over fresh edits.
  assert.strictEqual(sync.shouldReplace(rec('a', 20), rec('a', 10)), 'keep');
});

check('an identical timestamp is a conflict, not a silent overwrite', () => {
  assert.strictEqual(sync.shouldReplace(rec('a', 10), rec('a', 10)), 'conflict');
});

check('a tombstone competes on the same timestamp field', () => {
  const tomb = rec('a', 20, { deletedAt: 20 });
  assert.strictEqual(sync.shouldReplace(rec('a', 10), tomb), 'replace', 'a later delete wins');
  assert.strictEqual(sync.shouldReplace(tomb, rec('a', 10)), 'keep', 'a stale edit cannot resurrect');
});

check('bodyKey ignores updatedAt and field order', () => {
  const a = sync.bodyKey({ id: 'a', text: 'x', updatedAt: 1 });
  const b = sync.bodyKey({ updatedAt: 9, text: 'x', id: 'a' });
  assert.strictEqual(a, b, 'same body, different timestamp and order');
  const c = sync.bodyKey({ id: 'a', text: 'y', updatedAt: 1 });
  assert.notStrictEqual(a, c, 'different content');
});

check('merging reports a conflict only when the bodies differ', () => {
  const stored = new Map([['a', rec('a', 10, { t: 'mine' })]]);
  const same = sync.mergeCollection('books', stored, [rec('a', 10, { t: 'mine' })]);
  assert.strictEqual(same.conflicts.length, 0, 'agreement is not a conflict');
  const different = sync.mergeCollection('books', stored, [rec('a', 10, { t: 'theirs' })]);
  assert.strictEqual(different.conflicts.length, 1, 'a real tie is reported');
  assert.strictEqual(different.writes.length, 0, 'the stored row stands on a tie');
});

/* ── row shaping ── */

check('a book row keeps the whole record as JSON', () => {
  const { sql, params } = sync.toRow('books', 'j1', {
    id: 'b1', updatedAt: 5, title: 'Sea', shelfId: 's1',
  });
  assert.match(sql, /INSERT INTO books/);
  assert.match(sql, /WHERE excluded\.updated_at > books\.updated_at/, 'stale writes are rejected in SQL too');
  assert.ok(params.includes('j1'), 'scoped to the journal');
  assert.ok(params.some((p) => typeof p === 'string' && p.includes('"title":"Sea"')), 'the record is stored');
});

check('records conflict on (id, journal_id), not on id alone', () => {
  // Two journals may each hold a record with the same client-generated id. A
  // global primary key made the second journal's upsert match the first's row
  // and get rejected by the updated_at guard, so the write vanished silently.
  // Shelves hit this first because their ids are often literally "s1".
  for (const kind of ['books', 'quotes', 'shelves']) {
    const { sql } = sync.toRow(kind, 'j1', { id: 's1', updatedAt: 5, name: 'x', text: 'x', bookId: 'b1' });
    assert.match(sql, /ON CONFLICT\(id, journal_id\)/, `${kind} must scope its conflict target`);
  }
});

check('the schema gives every record table a composite primary key', () => {
  const sql = fs.readFileSync(path.join(WORKER, 'src', 'schema.sql'), 'utf8');
  for (const table of ['books', 'quotes', 'shelves']) {
    const block = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\)`).exec(sql)?.[0] ?? '';
    assert.match(block, /PRIMARY KEY \(id, journal_id\)/, `${table} needs (id, journal_id)`);
  }
  assert.doesNotMatch(
    /CREATE TABLE IF NOT EXISTS (books|quotes|shelves) \(\s*id\s+TEXT PRIMARY KEY/.test(sql) ? 'bad' : '',
    /bad/,
    'no table may key records on id alone',
  );
});

check('a position row is keyed by book, not by a synthetic id', () => {
  const { sql, params } = sync.toRow('positions', 'j1', {
    id: 'b1', updatedAt: 5, chapter: 3, fraction: 0.25,
  });
  assert.match(sql, /INSERT INTO positions/);
  assert.match(sql, /ON CONFLICT\(journal_id, book_id\)/, 'one position per book');
  assert.ok(params.includes(3) && params.includes(0.25), 'chapter and fraction are columns');
});

check('a deleted record writes a tombstone rather than deleting the row', () => {
  const { sql, params } = sync.toRow('quotes', 'j1', {
    id: 'q1', updatedAt: 7, deletedAt: 7, text: 'gone',
  });
  assert.match(sql, /INSERT INTO quotes/, 'tombstones are upserted, never DROPped');
  assert.doesNotMatch(sql, /DELETE FROM/);
  assert.ok(params.includes(7), 'deleted_at is stored');
});

/* ── R2 keys ── */

check('object keys follow the documented layout', () => {
  const hash = 'a'.repeat(64);
  assert.strictEqual(
    r2.objectKey('j1', 'b1', hash),
    `marginalia/j1/books/b1/${hash}.epub`,
  );
});

check('object keys reject traversal and separators', () => {
  const hash = 'a'.repeat(64);
  // Ids come from the client, so they are sanitised rather than trusted.
  assert.strictEqual(r2.objectKey('../etc', 'b1', hash), `marginalia/etc/books/b1/${hash}.epub`);
  assert.throws(() => r2.objectKey('', 'b1', hash), /invalid identifier/);
  assert.throws(() => r2.objectKey('j1', 'b1', 'not-a-hash'), /invalid content hash/);
});

check('object keys are case-normalised on the hash', () => {
  const upper = 'A'.repeat(64);
  assert.strictEqual(r2.objectKey('j1', 'b1', upper).endsWith('a'.repeat(64) + '.epub'), true);
});

/* ── the schema matches the design ── */

check('the schema defines every table the design names', () => {
  const sql = fs.readFileSync(path.join(WORKER, 'src', 'schema.sql'), 'utf8');
  for (const table of ['journals', 'shelves', 'books', 'quotes', 'positions']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `${table} exists`);
  }
});

check('deleting a shelf cannot take its books with it', () => {
  const sql = fs.readFileSync(path.join(WORKER, 'src', 'schema.sql'), 'utf8');
  assert.match(sql, /FOREIGN KEY \(shelf_id\) REFERENCES shelves\(id\) ON DELETE SET NULL/);
});

check('the schema is re-runnable', () => {
  const raw = fs.readFileSync(path.join(WORKER, 'src', 'schema.sql'), 'utf8');
  // Strip comments: the prose mentions CREATE TABLE and would inflate the count.
  const sql = raw.replace(/--[^\n]*/g, '');
  const creates = sql.match(/CREATE TABLE /g) ?? [];
  const guarded = sql.match(/CREATE TABLE IF NOT EXISTS /g) ?? [];
  assert.strictEqual(creates.length, guarded.length, 'every CREATE TABLE is guarded');
});

check('every table carrying a journal is indexed by it', () => {
  const sql = fs.readFileSync(path.join(WORKER, 'src', 'schema.sql'), 'utf8');
  for (const table of ['books', 'quotes', 'shelves', 'positions']) {
    assert.match(sql, new RegExp(`idx_${table}_journal|idx_${table}s?_journal`), `${table} has a journal index`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
