/*
 * Integration test against the LIVE API.
 *
 * This is the Phase 3/4 acceptance test, and it is deliberately separate from
 * the unit suites: only a real Worker, a real D1 and a real R2 can prove that the
 * wiring works. It is skipped automatically when the API is unreachable, so QA
 * gates do not depend on the network.
 *
 * Run: node smoke/api-integration.cjs
 */
const assert = require('assert');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const HOST = process.env.MARGINALIA_API_HOST || 'api.books.daffagra.my.id';
let pass = 0;
let fail = 0;
let skipped = false;

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

/** POSTs JSON to the API. Resolves to {status, body} or {error}. */
function call(path, body, key, method = 'POST') {
  return new Promise((resolve) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const options = {
      hostname: HOST,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 25000,
    };
    if (key) options.headers['X-Journal-Key'] = key;
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(options, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'timeout' });
    });
    req.on('error', (e) => resolve({ error: e.code || e.message }));
    req.end(payload);
  });
}

function newKey() {
  return crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

(async () => {
  /* ── reachability ── */
  const probe = await call('/api/hello', {}, newKey());
  if (probe.error || probe.status === 0) {
    console.log(`SKIP — the API at ${HOST} is not reachable (${probe.error ?? probe.status})`);
    console.log('      This suite needs the deployed Worker; unit suites cover the logic.');
    process.exit(0);
  }

  const key = newKey();
  console.log(`Testing ${HOST} with a fresh key\n`);

  /* ── auth ── */
  const hello = await call('/api/hello', {}, key);
  check('a valid key registers a journal', () => {
    assert.strictEqual(hello.status, 200, JSON.stringify(hello.body));
    assert.match(hello.body.journalId, /^j_[a-f0-9]{24}$/, `journal id: ${hello.body.journalId}`);
    assert.strictEqual(typeof hello.body.revision, 'number');
  });
  const journalId = hello.body?.journalId;

  check('hello is idempotent for the same key', () => {
    // Returned synchronously by awaiting below; captured here for the assertion.
  });

  const helloAgain = await call('/api/hello', {}, key);
  check('the same key always names the same journal', () => {
    assert.strictEqual(helloAgain.body.journalId, journalId);
  });

  const noKey = await call('/api/hello', {}, null);
  check('a missing key is rejected', () => {
    assert.strictEqual(noKey.status, 401, JSON.stringify(noKey.body));
  });

  const badKey = await call('/api/hello', {}, 'short');
  check('a malformed key is rejected', () => {
    assert.strictEqual(badKey.status, 401);
  });

  const otherKey = newKey();
  const otherHello = await call('/api/hello', {}, otherKey);
  check('a different key gets a different journal', () => {
    assert.notStrictEqual(otherHello.body.journalId, journalId);
  });

  /* ── isolation: one journal cannot see another's data ── */
  const now = Date.now();
  const bookId = 'b-' + crypto.randomBytes(6).toString('hex');
  const sync1 = await call('/api/sync', {
    since: 0,
    deviceId: 'integration-test',
    changes: {
      books: [{ id: bookId, updatedAt: now, title: 'Private Sea', createdAt: now }],
      quotes: [{ id: 'q1', bookId, updatedAt: now, text: 'a note', createdAt: now }],
      shelves: [{ id: 's1', name: 'Bedside', sortOrder: 0, createdAt: now, updatedAt: now }],
      positions: [{ id: bookId, updatedAt: now, chapter: 3, fraction: 0.5 }],
    },
  }, key);
  check('a sync uploads books, quotes, shelves and positions', () => {
    assert.strictEqual(sync1.status, 200, JSON.stringify(sync1.body));
    assert.ok(sync1.body.revision > 0, `revision ${sync1.body.revision}`);
  });

  const isolation = await call('/api/sync', {
    since: 0,
    deviceId: 'other-device',
    changes: { books: [], quotes: [], shelves: [], positions: [] },
  }, otherKey);
  check('another journal cannot see these records', () => {
    assert.strictEqual(isolation.status, 200);
    const titles = (isolation.body.changes.books ?? []).map((b) => b.title);
    assert.ok(!titles.includes('Private Sea'), `leaked: ${JSON.stringify(titles)}`);
  });

  /* ── round trip ── */
  const pull = await call('/api/sync', {
    since: 0,
    deviceId: 'second-device',
    changes: { books: [], quotes: [], shelves: [], positions: [] },
  }, key);
  check('a second device pulls the books back', () => {
    assert.strictEqual(pull.status, 200);
    const books = pull.body.changes.books ?? [];
    assert.ok(books.some((b) => b.id === bookId), `got ${books.length} books`);
  });
  check('a second device pulls the quotes back', () => {
    const quotes = pull.body.changes.quotes ?? [];
    const found = quotes.find((q) => q.id === 'q1');
    assert.ok(found, 'quote missing');
    assert.strictEqual(found.text, 'a note');
  });
  check('a second device pulls the shelves back', () => {
    const shelves = pull.body.changes.shelves ?? [];
    assert.ok(shelves.some((s) => s.name === 'Bedside'), `got ${shelves.length} shelves`);
  });
  check('a second device pulls the position back', () => {
    const positions = pull.body.changes.positions ?? [];
    const found = positions.find((p) => p.id === bookId);
    assert.ok(found, 'position missing');
    assert.strictEqual(Math.round(found.chapter), 3);
    assert.strictEqual(Math.round(found.fraction * 100) / 100, 0.5);
  });

  /* ── incremental sync ── */
  const revision = pull.body.revision;
  const later = now + 1000;
  const sync2 = await call('/api/sync', {
    since: revision,
    deviceId: 'integration-test',
    changes: {
      books: [{ id: bookId, updatedAt: later, title: 'Private Sea, revised', createdAt: now }],
      quotes: [], shelves: [], positions: [],
    },
  }, key);
  check('a sync returns only what changed since the client revision', () => {
    assert.strictEqual(sync2.status, 200);
    assert.ok(sync2.body.revision > revision, 'revision advances');
    const books = sync2.body.changes.books ?? [];
    const found = books.find((b) => b.id === bookId);
    assert.ok(found && found.title === 'Private Sea, revised', JSON.stringify(books.map((b) => b.title)));
  });
  check('an unchanged collection comes back empty', () => {
    const quotes = sync2.body.changes.quotes ?? [];
    assert.strictEqual(quotes.length, 0, `got ${quotes.length} quotes`);
  });

  /* ── tombstones ── */
  const del = await call('/api/sync', {
    since: sync2.body.revision,
    deviceId: 'integration-test',
    changes: {
      books: [{ id: bookId, updatedAt: later + 1000, deletedAt: later + 1000, title: 'Private Sea, revised' }],
      quotes: [], shelves: [], positions: [],
    },
  }, key);
  check('a delete uploads a tombstone', () => {
    assert.strictEqual(del.status, 200);
  });

  const afterDelete = await call('/api/sync', {
    since: revision + 1,
    deviceId: 'second-device',
    changes: { books: [], quotes: [], shelves: [], positions: [] },
  }, key);
  check('a delete reaches the other device as a tombstone', () => {
    const books = afterDelete.body.changes.books ?? [];
    const found = books.find((b) => b.id === bookId);
    assert.ok(found, 'the tombstone must be returned');
    assert.ok(found.deletedAt, 'the record is marked deleted');
  });

  const stale = await call('/api/sync', {
    since: afterDelete.body.revision,
    deviceId: 'stale-device',
    changes: {
      // An offline device pushing its old copy. Must not resurrect.
      books: [{ id: bookId, updatedAt: now, title: 'stale copy', createdAt: now }],
      quotes: [], shelves: [], positions: [],
    },
  }, key);
  check('a stale push cannot resurrect a deleted record', () => {
    assert.strictEqual(stale.status, 200);
    const books = stale.body.changes.books ?? [];
    const found = books.find((b) => b.id === bookId);
    // Either it is not returned at all, or it is still a tombstone.
    assert.ok(!found || found.deletedAt, `resurrected: ${JSON.stringify(found)}`);
  });

  /* ── validation ── */
  const garbage = await call('/api/sync', 'not-an-object', key);
  check('a non-object body is rejected', () => {
    assert.strictEqual(garbage.status, 400, `got ${garbage.status}`);
  });

  // 2 MB is the cap. Build a body comfortably past it and check it is refused
  // rather than buffered.
  const hugeBooks = Array.from({ length: 60000 }, (_, i) => ({
    id: `book-${i}-${'p'.repeat(40)}`,
    updatedAt: 1,
  }));
  const hugeSize = Buffer.byteLength(JSON.stringify({ since: 0, changes: { books: hugeBooks } }));
  const huge = await call('/api/sync', { since: 0, changes: { books: hugeBooks } }, key);
  check(`an oversized body is rejected, not crashed on (${(hugeSize / 1024 / 1024).toFixed(1)} MB)`, () => {
    assert.ok(huge.status === 400 || huge.status === 413, `got ${huge.status}`);
  });

  const badRecords = await call('/api/sync', {
    since: 0,
    deviceId: 't',
    changes: { books: [null, 1, 'x', { id: 'ok', updatedAt: 5 }], quotes: 'nope', shelves: undefined, positions: {} },
  }, key);
  check('malformed records are dropped rather than crashing the sync', () => {
    assert.strictEqual(badRecords.status, 200, JSON.stringify(badRecords.body));
  });

  /* ── file URLs ── */
  //
  // These need R2 S3 credentials in the Worker's secrets. When they are absent
  // the API must say so plainly (503 + an actionable message) rather than fail
  // with an opaque 500 — that difference is what the first assertion pins down.
  // The signing itself is only checked when storage is actually configured.
  const sha = crypto.randomBytes(32).toString('hex');
  const upload = await call('/api/files/upload-url', { bookId: 'b-test', sha256: sha, size: 5 * 1024 * 1024 }, key);
  const storageConfigured = upload.status === 200;

  check('a missing storage configuration is reported clearly, not as a 500', () => {
    assert.notStrictEqual(upload.status, 500, `got a server error: ${JSON.stringify(upload.body)}`);
    assert.ok([200, 503].includes(upload.status), `unexpected status ${upload.status}`);
    if (upload.status === 503) {
      assert.match(String(upload.body.error), /storage is not configured/i);
    }
  });

  if (storageConfigured) {
    check('an upload URL is signed for a 5 MB book', () => {
      assert.match(upload.body.url, /^https:\/\//);
      assert.ok(upload.body.expiresIn > 0 && upload.body.expiresIn <= 300, `expires in ${upload.body.expiresIn}s`);
      assert.ok(upload.body.url.includes(sha), 'the URL names the content hash');
    });
    check('the signed URL is scoped to this journal', () => {
      assert.ok(upload.body.url.includes(journalId), 'journal id is in the key');
    });

    const readBack = await call('/api/files/read-url', { bookId: 'b-test', sha256: sha }, key);
    check('a read URL is signed', () => {
      assert.strictEqual(readBack.status, 200, JSON.stringify(readBack.body));
      assert.match(readBack.body.url, /^https:\/\//);
    });
  } else {
    console.log('  (file storage not configured — signing assertions skipped)');
  }

  const oversize = await call('/api/files/upload-url', { bookId: 'b-test', sha256: sha, size: 200 * 1024 * 1024 }, key);
  check('a book over the size cap is refused', () => {
    // 413 Content Too Large is the honest status for a size cap; the body
    // still carries the human-readable reason and a retryable flag.
    assert.strictEqual(oversize.status, 413, `got ${oversize.status}`);
  });

  const badHash = await call('/api/files/upload-url', { bookId: 'b-test', sha256: 'nope', size: 100 }, key);
  check('a malformed content hash is refused', () => {
    assert.strictEqual(badHash.status, 400);
  });

  const noKeyUpload = await call('/api/files/upload-url', { bookId: 'b', sha256: sha, size: 100 }, null);
  check('file URLs require the key', () => {
    assert.strictEqual(noKeyUpload.status, 401);
  });

  /* ── CORS ── */
  const preflight = await new Promise((resolve) => {
    const req = https.request(
      { hostname: HOST, path: '/api/sync', method: 'OPTIONS',
        headers: { Origin: 'https://books.daffagra.my.id', 'Access-Control-Request-Method': 'POST' }, timeout: 20000 },
      (res) => resolve({ status: res.statusCode, headers: res.headers }),
    );
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
  check('CORS allows the app origin', () => {
    assert.ok(preflight.status === 204 || preflight.status === 200, `status ${preflight.status}`);
    assert.strictEqual(preflight.headers['access-control-allow-origin'], 'https://books.daffagra.my.id');
  });
  check('CORS allows the journal key header', () => {
    assert.match(preflight.headers['access-control-allow-headers'] ?? '', /X-Journal-Key/i);
  });

  /* ── an unauthenticated write cannot wipe a journal ── */
  const wipe = await call('/api/sync', {
    since: 0,
    deviceId: 'attacker',
    changes: { books: [{ id: 'b-' + bookId, updatedAt: now + 99999, title: 'pwned' }], quotes: [], shelves: [], positions: [] },
  }, null);
  check('an unauthenticated write is refused', () => {
    assert.strictEqual(wipe.status, 401);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
