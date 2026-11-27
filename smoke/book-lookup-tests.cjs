/*
 * Book metadata lookup: the pure shaping of Open Library search hits, the
 * sanitiser's handling of the new book fields, and — when the network allows —
 * a live call.
 *
 * The shaping tests are deterministic and always run. The live call is skipped
 * silently when openlibrary.org is unreachable, so gates never depend on it.
 * Run: node smoke/book-lookup-tests.cjs
 */
const assert = require('assert');
const https = require('https');

const dist = require('path').join(__dirname, '..', 'dist-smoke');
const { metadataFromDoc, coverUrl } = require(require('path').join(dist, 'lib', 'bookLookup.js'));
const { sanitizeData } = require(require('path').join(dist, 'storage.js'));

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

/* ── shaping a search hit ── */

check('a full hit shapes every field', () => {
  const m = metadataFromDoc({
    title: 'A Wizard of Earthsea',
    author_name: ['Ursula K. Le Guin'],
    publisher: ['Penguin', 'Puffin'],
    first_publish_year: 1968,
    isbn: ['9780141354936', '0141354933', '9999999999999'],
    cover_i: 8225261,
  });
  assert.strictEqual(m.title, 'A Wizard of Earthsea');
  assert.strictEqual(m.author, 'Ursula K. Le Guin');
  assert.strictEqual(m.publisher, 'Penguin', 'the first publisher wins');
  assert.strictEqual(m.publishedYear, 1968);
  assert.strictEqual(m.isbn, '9780141354936', 'ISBN-13 is preferred over ISBN-10');
  assert.strictEqual(m.coverUrl, 'https://covers.openlibrary.org/b/id/8225261-M.jpg');
});

check('a hit without a cover or isbn omits them', () => {
  const m = metadataFromDoc({ title: 'Some Book', author_name: ['Someone'] });
  assert.strictEqual(m.coverUrl, undefined);
  assert.strictEqual(m.isbn, undefined);
  assert.strictEqual(m.publisher, undefined);
  assert.strictEqual(m.publishedYear, undefined);
});

check('wrongly typed fields are dropped, not crashed on', () => {
  const m = metadataFromDoc({
    title: 42,
    author_name: 'not-an-array',
    publisher: [7, null],
    first_publish_year: '1968',
    isbn: {},
    cover_i: 'big',
  });
  assert.strictEqual(m.title, undefined, 'a numeric title is not a title');
  assert.strictEqual(m.author, undefined, 'a bare string is not an author array');
  assert.strictEqual(m.publisher, undefined, 'non-string publishers are filtered');
  assert.strictEqual(m.publishedYear, undefined, 'a string year is not trusted');
  assert.strictEqual(m.isbn, undefined);
  assert.strictEqual(m.coverUrl, undefined);
});

check('an isbn list of junk yields no isbn', () => {
  assert.strictEqual(metadataFromDoc({ isbn: ['x', 'abc', '12'] }).isbn, undefined);
});

check('an isbn-10 with a check X is accepted and normalised', () => {
  assert.strictEqual(metadataFromDoc({ isbn: ['0441013597'] }).isbn, '0441013597');
  assert.strictEqual(
    metadataFromDoc({ isbn: ['0-441-01359-X'] }).isbn,
    '044101359X',
    'hyphens stripped, X upper-cased',
  );
});

check('a year of zero or negative is not a publication year', () => {
  assert.strictEqual(metadataFromDoc({ first_publish_year: 0 }).publishedYear, undefined);
  assert.strictEqual(metadataFromDoc({ first_publish_year: -44 }).publishedYear, undefined);
});

check('a blank title is dropped rather than kept as whitespace', () => {
  assert.strictEqual(metadataFromDoc({ title: '   ' }).title, undefined);
});

check('coverUrl builds large and medium variants', () => {
  assert.strictEqual(coverUrl(8225261), 'https://covers.openlibrary.org/b/id/8225261-L.jpg');
  assert.strictEqual(coverUrl(8225261, 'M'), 'https://covers.openlibrary.org/b/id/8225261-M.jpg');
});

/* ── the sanitiser's handling of the new fields ── */

function bookWith(fields) {
  const data = sanitizeData({
    version: 1,
    books: [{ id: 'b1', title: 'T', author: 'A', ...fields }],
    quotes: [],
  });
  return data.books[0];
}

check('valid metadata fields survive sanitisation', () => {
  const b = bookWith({
    publisher: 'Penguin',
    publishedYear: 1968,
    isbn: '978-0-14-135493-6',
    coverUrl: 'https://covers.openlibrary.org/b/id/8225261-L.jpg',
    metadataAt: 1700000000000,
  });
  assert.strictEqual(b.publisher, 'Penguin');
  assert.strictEqual(b.publishedYear, 1968);
  assert.strictEqual(b.isbn, '9780141354936', 'hyphens are stripped on load');
  assert.strictEqual(b.coverUrl, 'https://covers.openlibrary.org/b/id/8225261-L.jpg');
  assert.strictEqual(b.metadataAt, 1700000000000);
});

check('a future publication year is dropped, not clamped', () => {
  assert.strictEqual(bookWith({ publishedYear: 2999 }).publishedYear, undefined);
});

check('a pre-print year is dropped', () => {
  assert.strictEqual(bookWith({ publishedYear: 1440 }).publishedYear, undefined);
});

check('a garbage isbn is dropped', () => {
  assert.strictEqual(bookWith({ isbn: 'not-an-isbn' }).isbn, undefined);
  assert.strictEqual(bookWith({ isbn: '12345' }).isbn, undefined);
});

check('an http cover url is dropped: the app is https-only', () => {
  assert.strictEqual(
    bookWith({ coverUrl: 'http://covers.openlibrary.org/b/id/1-L.jpg' }).coverUrl,
    undefined,
  );
});

check('a cover url on a foreign host is dropped', () => {
  assert.strictEqual(bookWith({ coverUrl: 'https://evil.example/track.png' }).coverUrl, undefined);
  assert.strictEqual(
    bookWith({ coverUrl: 'https://openlibrary.org/admin/secret' }).coverUrl,
    undefined,
    'host allows, but the path must name a cover',
  );
});

check('an overlong cover url is dropped', () => {
  assert.strictEqual(bookWith({ coverUrl: `https://covers.openlibrary.org/b/id/${'9'.repeat(600)}` }).coverUrl, undefined);
});

/* ── live, only when reachable ── */

function get(url, headers = {}) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

(async () => {
  const probe = await get('https://openlibrary.org/search.json?q=earthsea&limit=1&fields=key');
  if (probe && probe.status === 200) {
    const live = await get(
      'https://openlibrary.org/search.json?q=a%20wizard%20of%20earthsea%20le%20guin&limit=1' +
        '&fields=title,author_name,publisher,first_publish_year,isbn,cover_i',
      // CORS headers are only sent when the request looks like it comes from
      // a browser origin, which is exactly how the app's fetch will ask.
      { Origin: 'https://books.daffagra.my.id' },
    );
    check('the live Open Library answers and shapes into metadata', () => {
      assert.ok(live && live.status === 200);
      const doc = JSON.parse(live.text).docs[0];
      const m = metadataFromDoc(doc);
      assert.ok(m.title, 'a title comes back');
      assert.ok(m.author, 'an author comes back');
      assert.match(String(m.coverUrl ?? ''), /^https:\/\/covers\.openlibrary\.org\//);
    });
    check('the search endpoint serves CORS to browsers', () => {
      assert.strictEqual(live.headers['access-control-allow-origin'], '*');
    });
  } else {
    console.log('  (openlibrary.org unreachable — live checks skipped)');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
