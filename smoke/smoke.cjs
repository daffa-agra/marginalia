/* Headless smoke test: renders the whole app and exercises core logic.
 * Run with the bundled Node: node smoke/smoke.cjs
 */
const path = require('path');
const assert = require('assert');

// --- Browser stubs (renderToString runs useState initializers) ---
const store = new Map();
global.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
  scrollTo: () => {},
};
global.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  body: { style: {} },
  activeElement: null,
  createElement: () => ({ click: () => {}, remove: () => {}, set href(v) {}, set download(v) {} }),
};
global.navigator = { clipboard: { writeText: () => {} } };

const { renderToString } = require('react-dom/server');
const React = require('react');

const dist = path.join(__dirname, '..', 'dist-smoke');

// --- 1. App renders the sample library ---
const App = require(path.join(dist, 'App')).default;
const html = renderToString(React.createElement(App));
const checks = [
  ['brand', 'Marginalia'],
  ['library heading', 'Library'],
  ['add button', 'Add book'],
  ['sample book', 'Piranesi'],
  ['sample book 2', 'Tomorrow, and Tomorrow, and Tomorrow'],
  ['status chip', 'Reading'],
  ['rating stars', '★'],
  ['import button', 'Import notes'],
  ['demo banner', 'sample shelf'],
];
for (const [name, needle] of checks) {
  assert.ok(html.includes(needle), `render missing ${name}: "${needle}"`);
}
console.log(`✓ App server-renders (${html.length} chars, ${checks.length} content checks)`);

// --- 2. Play Books parser ---
const { parseAnnotationFile } = require(path.join(dist, 'lib', 'playbooks.js'));
const playDoc = [
  '<html><body>',
  '<h1>Piranesi</h1>',
  '<p>by Susanna Clarke</p>',
  '<p>1. Highlight (12%) The Beauty of the House is immeasurable.</p>',
  '<p>Note (13%): The house as a kind character.</p>',
  '<p>2. Highlight (58%) "I realize that I have been walking in circles."</p>',
  '<p>3. Highlight (p. 210) Third quote without a note.</p>',
  '</body></html>',
].join('\n');
const parsed = parseAnnotationFile('notes.html', playDoc);
assert.strictEqual(parsed.docs.length, 1, 'one doc');
assert.strictEqual(parsed.docs[0].bookTitle, 'Piranesi', 'title from heading');
assert.strictEqual(parsed.docs[0].author, 'Susanna Clarke', 'author line');
assert.strictEqual(parsed.docs[0].highlights.length, 3, 'three highlights');
assert.strictEqual(parsed.docs[0].highlights[0].note, 'The house as a kind character.', 'note attached');
assert.strictEqual(parsed.docs[0].highlights[0].position, '12%', 'percent position');
assert.strictEqual(parsed.docs[0].highlights[1].text, 'I realize that I have been walking in circles.', 'quotes stripped');
assert.strictEqual(parsed.docs[0].highlights[2].position, 'p. 210', 'page position');

const mdDoc = '# The Sirens\n\nHighlight (44%): The sea does not forgive.\nNote: sea as memory.\n';
const parsedMd = parseAnnotationFile('notes.md', mdDoc);
assert.strictEqual(parsedMd.docs[0].bookTitle, 'The Sirens');
assert.strictEqual(parsedMd.docs[0].highlights.length, 1);
assert.strictEqual(parsedMd.docs[0].highlights[0].note, 'sea as memory.');
console.log('✓ Play Books parser (html + md, notes, positions)');

// --- 3. Storage sanitize + merge ---
const { sanitizeData, mergeData } = require(path.join(dist, 'storage.js'));
const dirty = {
  version: 1,
  books: [
    { id: 'b1', title: '  Circe ', author: '', status: 'bogus', currentPage: -5, rating: 99, genres: ['Myth', 42], extra: 'drop' },
    { title: 'no id' },
    'garbage',
  ],
  quotes: [
    { id: 'q1', bookId: 'b1', text: 'Witchery.', position: '9%' },
    { id: 'q2', bookId: 'missing', text: 'orphan' },
    null,
  ],
};
const clean = sanitizeData(dirty);
assert.strictEqual(clean.books.length, 1);
const b1 = clean.books[0];
assert.strictEqual(b1.title, 'Circe');
assert.strictEqual(b1.author, 'Unknown author');
assert.strictEqual(b1.status, 'want-to-read');
assert.strictEqual(b1.currentPage, 0);
assert.strictEqual(b1.rating, undefined, 'rating 99 clamps out');
assert.deepStrictEqual(b1.genres, ['Myth']);
assert.strictEqual(clean.quotes.length, 1, 'orphan quote dropped');
assert.strictEqual(clean.quotes[0].text, 'Witchery.');

const merged = mergeData({ version: 1, books: [b1], quotes: [] }, clean);
assert.strictEqual(merged.books.length, 1, 'merge dedupes by id');
console.log('✓ Storage sanitize + merge (drops malformed, clamps, dedupes)');

// --- 4. Exporters ---
const { exportJson, exportCsv, exportMarkdown } = require(path.join(dist, 'lib', 'exporters.js'));
const data = sanitizeData({
  version: 1,
  books: [{ id: 'b1', title: 'Piranesi', author: 'Susanna Clarke', status: 'finished', rating: 5, totalPages: 245, currentPage: 245, genres: ['Fantasy'], finishedAt: '2026-10-11' }],
  quotes: [{ id: 'q1', bookId: 'b1', text: 'The Beauty of the House is immeasurable.', position: '38%' }],
});
const json = JSON.parse(exportJson(data).content);
assert.strictEqual(json.books[0].title, 'Piranesi');
const csv = exportCsv(data).content;
assert.ok(csv.includes('"Piranesi"'), 'csv has title');
assert.ok(csv.split('\r\n').length === 2, 'csv header + row');
const md = exportMarkdown(data).content;
assert.ok(md.includes('## Piranesi'), 'md heading');
assert.ok(md.includes('★★★★★'), 'md stars');
assert.ok(md.includes('> The Beauty of the House'), 'md quote');
console.log('✓ Exporters (JSON / CSV / Markdown)');

// --- 5. Utils ---
const { daysBetween, formatDate } = require(path.join(dist, 'lib', 'utils.js'));
const { progressPercent } = require(path.join(dist, 'types.js'));
assert.strictEqual(daysBetween('2026-10-02', '2026-10-11'), 9);
assert.ok(formatDate('2026-10-11').length > 6);
const fakeBook = { totalPages: 242, currentPage: 121, status: 'reading' };
assert.strictEqual(progressPercent(fakeBook), 50);
console.log('✓ Utils (dates, progress)');

console.log('\nAll smoke tests passed.');
