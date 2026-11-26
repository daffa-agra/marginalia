/**
 * QA GATES — the quality bar for this project, as executable checks.
 *
 * Each gate is a hard pass/fail. Run with `npm run qa` (or `node smoke/qa-gates.cjs`).
 * `--verbose` prints passing details; by default only summaries and failures.
 *
 * The gates are deliberately strict about things that have actually broken here
 * before, and about classes of bug that a green test suite would hide.
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');

const results = [];
let currentGate = null;

function gate(id, title, description) {
  currentGate = { id, title, description, checks: [] };
  results.push(currentGate);
}

function check(name, fn) {
  let status = 'pass';
  let detail = '';
  try {
    const outcome = fn();
    if (outcome === false) {
      status = 'fail';
      detail = 'returned false';
    } else if (typeof outcome === 'string') {
      detail = outcome;
    }
  } catch (err) {
    status = 'fail';
    detail = err.message;
  }
  currentGate.checks.push({ name, status, detail });
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
    ...opts,
  });
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

let scriptSeq = 0;
/**
 * Runs a Node snippet. Multi-line code cannot go through `node -e` when the
 * shell is cmd.exe (it splits on newlines), so write it to a temp file.
 */
function runScript(code) {
  const file = path.join(ROOT, `.qa-script-${process.pid}-${scriptSeq++}.cjs`);
  fs.writeFileSync(file, code);
  try {
    return run('node', [path.basename(file)]);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function walk(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(rel, ext));
    } else if (!ext || entry.name.endsWith(ext)) {
      out.push(rel);
    }
  }
  return out;
}

const SRC = walk('src', '.tsx').concat(walk('src', '.ts'));

/* ────────────────────────────────────────────────────────────────────
   G1 · Types compile
   ──────────────────────────────────────────────────────────────────── */
gate('G1', 'Types compile', 'No TypeScript errors, app and tests.');
check('tsc --noEmit', () => {
  run('npx', ['tsc', '--noEmit']);
  return 'clean';
});
check('smoke build compiles', () => {
  run('npx', ['tsc', '-p', 'tsconfig.smoke.json']);
  return 'clean';
});

/* ────────────────────────────────────────────────────────────────────
   G2 · Production build
   ──────────────────────────────────────────────────────────────────── */
gate('G2', 'Production build', 'The documented build command produces a loadable bundle.');
check('build succeeds', () => {
  run('npm', ['run', 'build']);
  return 'built';
});
check('dist/index.html references hashed assets', () => {
  const html = read('dist/index.html');
  if (!/assets\/index-[\w-]+\.js/.test(html)) throw new Error('no hashed JS asset in index.html');
  if (!/assets\/index-[\w-]+\.css/.test(html)) throw new Error('no hashed CSS asset in index.html');
  return 'hashed assets referenced';
});
check('dist has exactly one JS and one CSS bundle', () => {
  const assets = fs.readdirSync(path.join(ROOT, 'dist', 'assets'));
  const js = assets.filter((f) => f.endsWith('.js'));
  const css = assets.filter((f) => f.endsWith('.css'));
  if (js.length !== 1 || css.length !== 1) {
    throw new Error(`expected 1 js + 1 css, found ${js.length} js, ${css.length} css`);
  }
  return `${js[0]} · ${css[0]}`;
});
check('bundle stays under 400 kB gzipped', () => {
  const assets = fs.readdirSync(path.join(ROOT, 'dist', 'assets'));
  const js = assets.find((f) => f.endsWith('.js'));
  const size = fs.statSync(path.join(ROOT, 'dist', 'assets', js)).size;
  const gzip = require('zlib').gzipSync(fs.readFileSync(path.join(ROOT, 'dist', 'assets', js))).length;
  if (gzip > 400 * 1024) throw new Error(`${Math.round(gzip / 1024)} kB gzipped exceeds 400 kB`);
  return `${Math.round(size / 1024)} kB raw · ${Math.round(gzip / 1024)} kB gzip`;
});

/* ────────────────────────────────────────────────────────────────────
   G3 · Unit and integration suites
   ──────────────────────────────────────────────────────────────────── */
gate('G3', 'Test suites', 'Every node-level suite passes.');
for (const [name, file] of [
  ['render, parser, storage, exporters', 'smoke/smoke.cjs'],
  ['ZIP, EPUB metadata, shelves', 'smoke/epub-tests.cjs'],
  ['reading plan queue, pace, forecast', 'smoke/plan-tests.cjs'],
  ['reader: opening, TOC, chapters, sanitising', 'smoke/reader-tests.cjs'],
  ['pagination and typography', 'smoke/reader-typography-tests.cjs'],
]) {
  check(name, () => {
    const out = run('node', [file]);
    if (!/passed/i.test(out)) throw new Error('suite did not report success');
    return 'passed';
  });
}

/* ────────────────────────────────────────────────────────────────────
   G4 · Data integrity
   ──────────────────────────────────────────────────────────────────── */
gate('G4', 'Data integrity', 'The storage contract holds under hostile input.');
check('sanitize survives non-JSON shapes without throwing', () => {
  const script = `
    const { sanitizeData } = require('./dist-smoke/storage.js');
    const inputs = [null, undefined, 42, 'str', [], {}, { books: 'x', quotes: 5, shelves: null },
                    { books: [null, 1, 'x'], quotes: [{}], shelves: [{}] }];
    for (const i of inputs) {
      const out = sanitizeData(i);
      if (!Array.isArray(out.books) || !Array.isArray(out.quotes) || !Array.isArray(out.shelves))
        throw new Error('sanitize returned a malformed shape for ' + JSON.stringify(i));
    }
    console.log('ok');
  `;
  runScript(script);
  return 'resilient';
});
check('a book can never reference a missing shelf', () => {
  const script = `
    const { sanitizeData } = require('./dist-smoke/storage.js');
    const out = sanitizeData({ books: [{ id: 'b', title: 'T', shelfId: 'gone' }], shelves: [] });
    if (out.books[0].shelfId !== undefined) throw new Error('dangling shelfId survived');
    console.log('ok');
  `;
  runScript(script);
  return 'dangling refs cleared';
});
check('merge tolerates data that predates shelves', () => {
  const script = `
    const { mergeData } = require('./dist-smoke/storage.js');
    const legacy = { version: 1, books: [], quotes: [] };
    const out = mergeData(legacy, legacy);
    if (!Array.isArray(out.shelves)) throw new Error('merge produced no shelves array');
    console.log('ok');
  `;
  runScript(script);
  return 'backwards compatible';
});
check('export round-trips through sanitize unchanged', () => {
  const script = `
    const { sanitizeData } = require('./dist-smoke/storage.js');
    const { exportJson } = require('./dist-smoke/lib/exporters.js');
    const data = sanitizeData({
      books: [{ id: 'b1', title: 'T', author: 'A', status: 'reading', currentPage: 3, genres: ['G'] }],
      quotes: [{ id: 'q1', bookId: 'b1', text: 'hello' }],
      shelves: [{ id: 's1', name: 'Shelf', sortOrder: 0 }],
    });
    const round = sanitizeData(JSON.parse(exportJson(data).content));
    if (JSON.stringify(round) !== JSON.stringify(data)) throw new Error('export/import drifted');
    console.log('ok');
  `;
  runScript(script);
  return 'stable';
});
check('reading plan positions stay contiguous', () => {
  const script = `
    const { queueOf, reindexAfterRemoval } = require('./dist-smoke/lib/plan.js');
    const mk = (id, pos) => ({ id, title: id, author: 'A', status: 'want-to-read', currentPage: 0, genres: [], color: '#000000', createdAt: 1, queuePosition: pos });
    const books = [mk('a', 0), mk('b', 1), mk('c', 2)];
    const after = reindexAfterRemoval(queueOf(books), 1);
    const positions = after.map((x) => x.queuePosition);
    if (JSON.stringify(positions) !== JSON.stringify([0, 1])) throw new Error('gap left: ' + positions);
    console.log('ok');
  `;
  runScript(script);
  return 'no gaps after removal';
});
check('the forecast refuses to guess without history', () => {
  const script = `
    const { measurePace, forecastQueue } = require('./dist-smoke/lib/plan.js');
    const pace = measurePace([{ id: 'a', status: 'finished', finishedAt: new Date().toISOString().slice(0, 10) }]);
    if (pace.confident) throw new Error('called one book a pace');
    const f = forecastQueue([{ id: 'q', queuePosition: 0 }], pace);
    if (f.weeksToClear !== null) throw new Error('forecasted from no history');
    console.log('ok');
  `;
  runScript(script);
  return 'declines to guess';
});
check('reading position survives a storage round trip', () => {
  const script = `
    const { sanitizeData } = require('./dist-smoke/storage.js');
    const pos = { chapter: 3, fraction: 0.5, updatedAt: 123 };
    const out = sanitizeData({ books: [{ id: 'b', title: 'T', position: pos }], quotes: [], shelves: [] });
    if (!out.books[0].position) throw new Error('position dropped by sanitize');
    if (out.books[0].position.chapter !== 3) throw new Error('chapter lost');
    const bad = sanitizeData({ books: [{ id: 'b', title: 'T', position: { chapter: 'x' } }], quotes: [], shelves: [] });
    if (bad.books[0].position !== undefined) throw new Error('malformed position kept');
    console.log('ok');
  `;
  runScript(script);
  return 'position persisted, malformed dropped';
});

/* ────────────────────────────────────────────────────────────────────
   G5 · Hostile book content
   ──────────────────────────────────────────────────────────────────── */
gate('G5', 'Untrusted content', 'Malformed and hostile EPUBs fail safely.');
check('parser rejects non-EPUB input with a named error', () => {
  const script = `
    const { extractEpubMetadata, ZipError } = require('./dist-smoke/lib/epub.js');
    extractEpubMetadata(new TextEncoder().encode('not a zip').buffer)
      .then(() => { console.error('accepted junk'); process.exit(1); })
      .catch((e) => {
        if (e.name !== 'ZipError') { console.error('wrong error: ' + e.name); process.exit(1); }
        console.log('ok');
      });
  `;
  runScript(script);
  return 'named error';
});
check('no eval, Function constructor or innerHTML with dynamic content', () => {
  const offenders = [];
  for (const file of SRC) {
    const text = read(file);
    if (/\beval\s*\(/.test(text)) offenders.push(`${file}: eval`);
    if (/new\s+Function\s*\(/.test(text)) offenders.push(`${file}: new Function`);
    if (/dangerouslySetInnerHTML/.test(text)) offenders.push(`${file}: dangerouslySetInnerHTML`);
    if (/\.innerHTML\s*=/.test(text)) offenders.push(`${file}: innerHTML assignment`);
  }
  if (offenders.length) throw new Error(offenders.join(', '));
  return 'none found';
});
check('book files are size-capped before parsing', () => {
  const text = read('src/lib/epub.ts');
  if (!/100 \* 1024 \* 1024/.test(text)) throw new Error('no size cap in looksLikeEpub');
  if (!/MAX_COVER_BYTES/.test(text)) throw new Error('no cover size cap');
  const reader = read('src/lib/epubBook.ts');
  if (!/MAX_RESOURCE_BYTES/.test(reader)) throw new Error('no per-resource size cap');
  if (!/MAX_CHAPTER_BYTES/.test(reader)) throw new Error('no chapter size cap');
  return '100 MB book, 4 MB cover, 32 MB resource, 8 MB chapter';
});
check('reader renders book content in a sandboxed frame without scripts', () => {
  const reader = read('src/views/ReaderView.tsx');
  if (!/sandbox="allow-same-origin"/.test(reader)) throw new Error('iframe is not sandboxed');
  if (/allow-scripts/.test(reader)) throw new Error('iframe allows scripts');
  return 'sandboxed, scripts disabled';
});
check('reader strips active content from chapters', () => {
  const text = read('src/lib/epubBook.ts');
  // These are literal source patterns, not regexes: check them as strings.
  const required = [
    ['<script', 'script tags removed'],
    ['\\son[a-z]+', 'event handler removal'],
    ['javascript:', 'javascript URL neutralisation'],
  ];
  for (const [needle, label] of required) {
    if (!text.includes(needle)) throw new Error(`missing ${label} (${needle})`);
  }
  return 'scripts, handlers and javascript: URLs removed';
});
check('reading position is chapter plus fraction, not a page number', () => {
  const pos = read('src/lib/readingPosition.ts');
  const types = read('src/types.ts');
  const combined = pos + types;
  if (!/chapter:\s*number/.test(combined) || !/fraction:\s*number/.test(combined)) {
    throw new Error('position is not (chapter, fraction)');
  }
  return 'survives reflow by design';
});

/* ────────────────────────────────────────────────────────────────────
   G6 · Durability and safety
   ──────────────────────────────────────────────────────────────────── */
gate('G6', 'Durability', 'Work is never lost silently.');
check('every write failure is published, never swallowed', () => {
  const text = read('src/storage.ts');
  if (!/publish\(\{ writable: false/.test(text)) throw new Error('saveData does not publish failure');
  if (!/failedAt/.test(text)) throw new Error('no failure timestamp recorded');
  return 'failures surface in UI state';
});
check('storage probe runs at boot', () => {
  const text = read('src/useJournal.ts');
  if (!/probeStorage\(\)/.test(text)) throw new Error('no boot probe');
  return 'probe present';
});
check('book bytes outlive the undo window', () => {
  const text = read('src/components/BookDetail.tsx');
  if (!/UNDO_WINDOW_MS/.test(text)) throw new Error('no undo window constant');
  if (!/setTimeout/.test(text)) throw new Error('bytes are not deferred');
  if (!/undone/.test(text)) throw new Error('undo does not cancel byte deletion');
  return 'bytes deferred until undo expires';
});
check('destructive book delete requires confirmation', () => {
  const text = read('src/components/BookDetail.tsx');
  if (!/confirmDelete/.test(text)) throw new Error('no confirm state');
  if (!/Delete book and quotes/.test(text)) throw new Error('no explicit destructive action');
  return 'confirmed';
});

/* ────────────────────────────────────────────────────────────────────
   G7 · Accessibility
   ──────────────────────────────────────────────────────────────────── */
gate('G7', 'Accessibility', 'Structural a11y holds in source and in the DOM.');
check('no emoji used as interface icons', () => {
  // The gate targets UI surfaces. Star glyphs written into an exported
  // Markdown file are file content, not interface, so they are excluded.
  const isExportWriter = (file) => file.replace(/\\/g, '/').includes('lib/exporters');
  const offenders = [];
  for (const file of SRC) {
    if (isExportWriter(file)) continue;
    const text = read(file);
    const matches = text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
    if (matches) offenders.push(`${file}: ${[...new Set(matches)].join(' ')}`);
  }
  if (offenders.length) throw new Error(offenders.join(', '));
  return 'none in interface code';
});
check('every icon component is hidden from assistive tech', () => {
  const text = read('src/components/icons.tsx');
  const icons = (text.match(/<svg/g) || []).length;
  const hidden = (text.match(/aria-hidden="true"/g) || []).length;
  if (hidden < icons) throw new Error(`${icons} svg but only ${hidden} aria-hidden`);
  return `${hidden}/${icons} svg hidden`;
});
check('modals trap focus and are labelled', () => {
  const text = read('src/components/Modal.tsx');
  for (const needle of ['role="dialog"', 'aria-modal="true"', 'aria-label', 'inert', "'Tab'"]) {
    if (!text.includes(needle)) throw new Error(`Modal missing ${needle}`);
  }
  return 'dialog semantics, trap, inert';
});
check('live region exists for transient feedback', () => {
  const text = read('src/lib/toasts.tsx');
  if (!/aria-live="polite"/.test(text)) throw new Error('toast region is not a live region');
  return 'aria-live polite';
});
check('interactive elements have accessible names', () => {
  const offenders = [];
  for (const file of SRC) {
    const text = read(file);
    const buttons = text.match(/<button[^>]*>\s*<Icon[^>]*\/>\s*<\/button>/g) || [];
    for (const b of buttons) {
      if (!/aria-label|title=/.test(b)) offenders.push(file);
    }
  }
  if (offenders.length) throw new Error(`icon-only button without a name: ${[...new Set(offenders)].join(', ')}`);
  return 'all named';
});

/* ────────────────────────────────────────────────────────────────────
   G8 · Design system discipline
   ──────────────────────────────────────────────────────────────────── */
gate('G8', 'Design system', 'Tokens are used instead of hardcoded values.');
check('no inline hex colours in TSX', () => {
  const offenders = [];
  for (const file of SRC) {
    if (file.endsWith('.ts')) continue;
    const text = read(file);
    // A hex value is only a problem when it styles something. Values passed as
    // fallbacks to getPropertyValue() are token lookups, which is exactly the
    // pattern we want, so strip those before scanning.
    const withoutTokenFallbacks = text.replace(
      /get\('--[\w-]+',\s*'#[0-9a-fA-F]{3,8}'\)/g,
      '',
    );
    const matches = withoutTokenFallbacks.match(/#[0-9a-fA-F]{6}\b/g) || [];
    // Book spine swatches and sample data are content, not styling.
    const allowed = /BookFormModal|ImportModal|sampleData|lib\/colors/.test(file);
    if (matches.length && !allowed) offenders.push(`${file}: ${[...new Set(matches)].join(' ')}`);
  }
  if (offenders.length) throw new Error(offenders.join(', '));
  return 'colours come from tokens';
});
check('no transition-all, hover scale, or infinite animation', () => {
  const css = read('src/styles.css');
  for (const [pattern, label] of [
    [/transition-all/, 'transition-all'],
    [/hover:scale|scale\(1\.0[2-9]\)/, 'hover scale'],
    [/animation:\s*[^;]*infinite/, 'infinite animation'],
  ]) {
    if (pattern.test(css)) throw new Error(`styles.css contains ${label}`);
  }
  return 'clean';
});
check('reduced motion is honoured', () => {
  const css = read('src/styles.css');
  if (!/prefers-reduced-motion/.test(css)) throw new Error('no reduced-motion block');
  return 'present';
});
check('one easing curve is defined and reused', () => {
  const css = read('src/styles.css');
  const decl = (css.match(/cubic-bezier\([^)]*\)/g) || []).length;
  const viaVar = /--ease:\s*cubic-bezier/.test(css);
  if (!viaVar) throw new Error('no --ease token');
  if (decl > 3) throw new Error(`${decl} literal cubic-bezier values; expected mostly var(--ease)`);
  return `${decl} literal, rest via token`;
});

/* ────────────────────────────────────────────────────────────────────
   G9 · Repo hygiene
   ──────────────────────────────────────────────────────────────────── */
gate('G9', 'Repo hygiene', 'Nothing sensitive or generated is tracked.');
check('no secrets or private identifiers tracked', () => {
  const tracked = run('git', ['ls-files']).split('\n').filter(Boolean);
  const offenders = [];
  for (const file of tracked) {
    if (!/\.(ts|tsx|js|cjs|md|json|html|css|yml|yaml)$/.test(file)) continue;
    // The gate's own detector patterns would match themselves.
    if (file.replace(/\\/g, '/') === 'smoke/qa-gates.cjs') continue;
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (/eyJ[A-Za-z0-9_-]{10,}/.test(text)) offenders.push(`${file}: JWT`);
    if (/g[h]p_[A-Za-z0-9]{20,}|github_p[a]t_/.test(text)) offenders.push(`${file}: GitHub token`);
    if (/[0-9a-f]{32}/.test(text) && /account/i.test(text)) offenders.push(`${file}: possible account id`);
    if (/[\w.+-]+@(gmail|outlook|yahoo)\.com/.test(text)) offenders.push(`${file}: personal email`);
  }
  if (offenders.length) throw new Error(offenders.join(', '));
  return `${tracked.length} files scanned`;
});
check('design notes and build output are ignored', () => {
  const ignore = read('.gitignore');
  for (const entry of ['docs/', 'dist', 'node_modules', '.review']) {
    if (!ignore.includes(entry)) throw new Error(`.gitignore missing ${entry}`);
  }
  return 'ignored';
});
check('no tracked build artefacts or dependencies', () => {
  const tracked = run('git', ['ls-files']).split('\n');
  const offenders = tracked.filter((f) => /^(node_modules|dist|dist-smoke|docs)\//.test(f));
  if (offenders.length) throw new Error(offenders.slice(0, 5).join(', '));
  return 'clean';
});
check('every source file is reachable from the entry point', () => {
  // Catches modules that were written and then orphaned. Stylesheets are
  // imported for their side effects, and .d.ts files declare types, so
  // neither appears in an `import ... from` statement.
  const modules = walk('src')
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !f.endsWith('.d.ts'))
    .map((f) => ({ file: f, name: path.basename(f, path.extname(f)) }))
    .filter((m) => m.name !== 'main');
  const corpus = walk('src')
    .filter((f) => /\.(ts|tsx|css)$/.test(f))
    .map((f) => read(f))
    .join('\n');
  const orphans = modules.filter(
    (m) => !new RegExp(`from\\s+['"][^'"]*${m.name}['"]`).test(corpus),
  );
  if (orphans.length) throw new Error(`unimported: ${orphans.map((o) => o.file).join(', ')}`);
  return `${modules.length} modules reachable`;
});

/* ────────────────────────────────────────────────────────────────────
   G10 · Honesty of claims
   ──────────────────────────────────────────────────────────────────── */
gate('G10', 'Honest claims', 'Docs do not promise what the code does not do.');
check('README states the reader does not exist yet', () => {
  const readme = read('README.md');
  if (!/not built|does not do yet|not readable/i.test(readme)) {
    throw new Error('README does not disclose the missing reader');
  }
  return 'disclosed';
});
check('README does not claim offline reading works', () => {
  const readme = read('README.md');
  const section = readme.slice(readme.indexOf('## What it does today'), readme.indexOf('## Running it'));
  if (/\boffline reading\b|\bread your books\b/i.test(section)) {
    throw new Error('capability section overclaims');
  }
  return 'accurate';
});

/* ────────────────────────────────────────────────────────────────────
   Report
   ──────────────────────────────────────────────────────────────────── */
let totalChecks = 0;
let failedChecks = 0;
let failedGates = 0;

console.log('');
for (const g of results) {
  const failed = g.checks.filter((c) => c.status === 'fail');
  totalChecks += g.checks.length;
  failedChecks += failed.length;
  if (failed.length) failedGates += 1;
  const mark = failed.length ? 'FAIL' : 'PASS';
  console.log(`${mark}  ${g.id} ${g.title}  (${g.checks.length - failed.length}/${g.checks.length})`);
  if (failed.length) {
    console.log(`      ${g.description}`);
    for (const c of failed) console.log(`      ✗ ${c.name}\n        ${c.detail}`);
  } else if (VERBOSE) {
    for (const c of g.checks) console.log(`      ✓ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
}

console.log('');
console.log(`${results.length - failedGates}/${results.length} gates passed · ${totalChecks - failedChecks}/${totalChecks} checks`);
process.exit(failedGates > 0 ? 1 : 0);
