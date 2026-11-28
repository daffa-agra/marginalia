/*
 * Unit tests for the book-upload queue.
 *
 * This is the piece that decides whether a book's bytes ever leave the device
 * they were added on. Before it existed, one failed upload — a closed tab, a
 * dead connection at add time — stranded the file on that machine forever.
 * Every branch is exercised here with fakes; nothing touches a network.
 */
const path = require('path');
const assert = require('assert');

/* A minimal localStorage, so the queue's persistence is exercised in node. */
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

const dist = path.join(__dirname, '..', 'dist-smoke');
const {
  pendingUploads,
  enqueueUpload,
  dequeueUpload,
  clearUploads,
  missingUploads,
  processUploadQueue,
} = require(path.join(dist, 'lib', 'bookUploadQueue.js'));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`\u2713 ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`\u2717 ${name} \u2014 ${e.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`\u2713 ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`\u2717 ${name} \u2014 ${e.message}`);
  }
}

const book = (id, file) => ({ id, updatedAt: 1, createdAt: 1, file });
const blobOf = () => new Blob(['epub-bytes']);

(async () => {
  /* ---- queue persistence ---- */

  check('enqueue records a book id, without duplicates', () => {
    enqueueUpload('b1');
    enqueueUpload('b1');
    assert.deepStrictEqual(pendingUploads(), ['b1']);
  });

  check('dequeue removes exactly the uploaded book', () => {
    enqueueUpload('b2');
    dequeueUpload('b2');
    assert.deepStrictEqual(pendingUploads(), ['b1']);
  });

  check('the queue survives a fresh module state (persistence)', () => {
    assert.ok(pendingUploads().includes('b1'), 'b1 written earlier must still be queued');
  });

  /* ---- the repair sweep ---- */

  check('missingUploads sweeps books with a file but no sha256', () => {
    const books = [
      book('a', { kind: 'epub', fileName: 'a.epub', size: 1, storage: 'local' }),
      book('b', { kind: 'epub', fileName: 'b.epub', size: 1, storage: 'local', sha256: 'ab'.repeat(32) }),
      book('c'),
    ];
    assert.deepStrictEqual(missingUploads(books), ['a']);
  });

  /* ---- draining the queue ---- */

  await checkAsync('a queued book uploads, records its hash, and leaves the queue', async () => {
    clearUploads();
    enqueueUpload('up1');
    const uploadedTo = [];
    const recorded = {};
    const run = await processUploadQueue(
      [book('up1', { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local' })],
      {
        loadBytes: () => Promise.resolve(blobOf()),
        upload: (id) => {
          uploadedTo.push(id);
          return Promise.resolve({ ok: true, data: { sha256: 'cd'.repeat(32) } });
        },
        onUploaded: (id, sha) => { recorded[id] = sha; },
      },
    );
    assert.deepStrictEqual(run.uploaded, ['up1']);
    assert.deepStrictEqual(run.failed, []);
    assert.deepStrictEqual(run.skipped, []);
    assert.deepStrictEqual(uploadedTo, ['up1']);
    assert.ok(!pendingUploads().includes('up1'), 'a completed upload must leave the queue');
  });

  await checkAsync('onUploaded receives the hash the record must carry', async () => {
    let recordedSha;
    await processUploadQueue(
      [book('up2', { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local' })],
      {
        loadBytes: () => Promise.resolve(blobOf()),
        upload: () => Promise.resolve({ ok: true, data: { sha256: 'ef'.repeat(32) } }),
        onUploaded: (_id, sha) => { recordedSha = sha; },
      },
      ['up2'],
    );
    assert.strictEqual(recordedSha, 'ef'.repeat(32));
  });

  await checkAsync('a failed upload stays queued for the next pass', async () => {
    clearUploads();
    enqueueUpload('fl1');
    const run = await processUploadQueue(
      [book('fl1', { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local' })],
      {
        loadBytes: () => Promise.resolve(blobOf()),
        upload: () => Promise.resolve({ ok: false, error: { status: 0, message: 'No connection', offline: true } }),
        onUploaded: () => assert.fail('a failed upload must not record a hash'),
      },
    );
    assert.deepStrictEqual(run.failed, ['fl1']);
    assert.ok(pendingUploads().includes('fl1'), 'a failed upload must remain queued');
  });

  await checkAsync('a thrown upload also stays queued', async () => {
    clearUploads();
    enqueueUpload('fl2');
    const run = await processUploadQueue(
      [book('fl2', { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local' })],
      {
        loadBytes: () => Promise.resolve(blobOf()),
        upload: () => Promise.reject(new Error('boom')),
        onUploaded: () => assert.fail('a thrown upload must not record a hash'),
      },
    );
    assert.deepStrictEqual(run.failed, ['fl2']);
    assert.ok(pendingUploads().includes('fl2'));
  });

  await checkAsync('a book deleted on any device is dropped, not retried', async () => {
    clearUploads();
    const run = await processUploadQueue(
      [{ ...book('dead', { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local' }), deletedAt: 2 }],
      {
        loadBytes: () => Promise.resolve(blobOf()),
        upload: () => assert.fail('a deleted book must not upload'),
        onUploaded: () => assert.fail('a deleted book must not record a hash'),
      },
      ['dead'],
    );
    assert.deepStrictEqual(run.skipped, ['dead']);
    assert.ok(!pendingUploads().includes('dead'));
  });

  await checkAsync('a book the journal no longer has is dropped', async () => {
    clearUploads();
    const run = await processUploadQueue([], { loadBytes: () => Promise.resolve(blobOf()), upload: () => {}, onUploaded: () => {} }, ['ghost']);
    assert.deepStrictEqual(run.skipped, ['ghost']);
    assert.ok(!pendingUploads().includes('ghost'));
  });

  await checkAsync('a book whose record already carries a hash is skipped', async () => {
    clearUploads();
    const run = await processUploadQueue(
      [book('done', { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local', sha256: 'ab'.repeat(32) })],
      {
        loadBytes: () => Promise.resolve(blobOf()),
        upload: () => assert.fail('an uploaded book must not upload again'),
        onUploaded: () => assert.fail('an uploaded book must not record a hash again'),
      },
      ['done'],
    );
    assert.deepStrictEqual(run.skipped, ['done']);
  });

  await checkAsync('a book with no local bytes is dropped rather than retried forever', async () => {
    clearUploads();
    const run = await processUploadQueue(
      [book('remote', { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local' })],
      {
        loadBytes: () => Promise.resolve(undefined),
        upload: () => assert.fail('nothing to upload'),
        onUploaded: () => assert.fail('nothing to record'),
      },
      ['remote'],
    );
    assert.deepStrictEqual(run.skipped, ['remote']);
    assert.ok(!pendingUploads().includes('remote'));
  });

  await checkAsync('unreadable bytes are dropped, not retried forever', async () => {
    clearUploads();
    const run = await processUploadQueue(
      [book('rot', { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local' })],
      {
        loadBytes: () => Promise.reject(new Error('corrupt store')),
        upload: () => assert.fail('nothing to upload'),
        onUploaded: () => assert.fail('nothing to record'),
      },
      ['rot'],
    );
    assert.deepStrictEqual(run.skipped, ['rot']);
  });

  await checkAsync('a mixed pass reports every outcome and drains only what succeeded', async () => {
    clearUploads();
    enqueueUpload('yes');
    enqueueUpload('no');
    enqueueUpload('gone');
    const f = { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local' };
    const run = await processUploadQueue(
      [book('yes', f), book('no', f), book('gone', f)],
      {
        loadBytes: (id) => Promise.resolve(id === 'gone' ? undefined : blobOf()),
        upload: (id) => (id === 'yes'
          ? Promise.resolve({ ok: true, data: { sha256: 'ab'.repeat(32) } })
          : Promise.resolve({ ok: false, error: { status: 503, message: 'quota', offline: false } })),
        onUploaded: () => {},
      },
    );
    assert.deepStrictEqual(run, { uploaded: ['yes'], failed: ['no'], skipped: ['gone'] });
    assert.deepStrictEqual(pendingUploads(), ['no']);
  });

  await checkAsync('a second pass after a recorded hash skips the book entirely', async () => {
    clearUploads();
    const f = { kind: 'epub', fileName: 'x.epub', size: 10, storage: 'local' };
    const sha = 'ab'.repeat(32);
    let recorded = book('again', f);
    const deps = {
      loadBytes: () => Promise.resolve(blobOf()),
      upload: () => Promise.resolve({ ok: true, data: { sha256: sha } }),
      onUploaded: () => { recorded = book('again', { ...f, sha256: sha }); },
    };
    const first = await processUploadQueue([recorded], deps, ['again']);
    assert.deepStrictEqual(first.uploaded, ['again']);
    const second = await processUploadQueue([recorded], deps, ['again']);
    assert.deepStrictEqual(second, { uploaded: [], failed: [], skipped: ['again'] });
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
