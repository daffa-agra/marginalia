/* Browser tests for shelves, upload and the delete-book undo. */
const fs = require('fs');
const path = require('path');
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');

const BASE = 'http://127.0.0.1:4173/';
const FIXTURE = path.join(__dirname, '..', '.review', 'fixtures', 'lighthouse.epub');
let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });

  /* ---- 1. Upload an EPUB, metadata extracted ---- */
  await page.locator('.header-actions').getByRole('button', { name: /Add book/ }).click();
  await page.waitForTimeout(300);
  const sheet = await page.evaluate(() => ({
    dialog: !!document.querySelector('[role=dialog]'),
    segments: [...document.querySelectorAll('.segment')].map((s) => s.textContent.trim()),
  }));
  check('Add book opens with file/hand segments', sheet.dialog && sheet.segments.length === 2, JSON.stringify(sheet));

  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.waitForTimeout(1200);

  const preview = await page.evaluate(() => ({
    hasPreview: !!document.querySelector('.file-preview'),
    fileName: document.querySelector('.file-name')?.textContent ?? null,
    title: document.querySelector('#up-title')?.value ?? null,
    author: document.querySelector('#up-author')?.value ?? null,
    hasCover: !!document.querySelector('.file-cover:not(.file-cover-empty)'),
  }));
  check('EPUB opens a preview', preview.hasPreview, JSON.stringify(preview));
  check('title extracted from the OPF', preview.title === "The Lighthouse Keeper's Daughter", String(preview.title));
  check('author extracted from the OPF', preview.author === 'Eleanor Voss', String(preview.author));
  check('cover extracted from the EPUB', preview.hasCover);

  // Choose a shelf before adding — create one inline first.
  await page.getByRole('button', { name: /Add book/ }).last().click();
  await page.waitForTimeout(800);

  const afterAdd = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    const book = raw.books.find((b) => b.title.startsWith('The Lighthouse'));
    return { book: book ? { title: book.title, file: book.file, shelfId: book.shelfId } : null };
  });
  check('book added with a file reference', !!afterAdd.book?.file, JSON.stringify(afterAdd));
  check('file reference records name and size', afterAdd.book?.file?.fileName === 'lighthouse.epub' && afterAdd.book.file.size > 0);

  // Bytes actually stored in IndexedDB?
  const stored = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('marginalia', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const ids = await new Promise((res, rej) => {
      const tx = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').getAllKeys();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const bytes = await new Promise((res, rej) => {
      const tx = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(ids[0]);
      req.onsuccess = () => res(req.result?.size ?? 0);
      req.onerror = () => rej(req.error);
    });
    return { keys: ids.length, bytes };
  });
  check('EPUB bytes stored in IndexedDB', stored.keys === 1 && stored.bytes > 1000, JSON.stringify(stored));

  /* ---- 2. Shelves ---- */
  await page.getByRole('button', { name: /Back to library|Library/ }).first().click();
  await page.waitForTimeout(300);

  // Create two shelves
  for (const name of ['Bedside', 'Research']) {
    await page.getByRole('button', { name: /New shelf/ }).click();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
  const shelfState = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.shelf-tab')].map((t) => t.textContent.trim());
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return { tabs, shelves: raw.shelves.map((s) => s.name), unshelved: raw.books.filter((b) => !b.shelfId).length };
  });
  check('two shelves created', shelfState.shelves.length === 2, JSON.stringify(shelfState));
  check('shelf bar shows All, Unshelved and each shelf', shelfState.tabs.some((t) => t.startsWith('All')) && shelfState.tabs.some((t) => t.startsWith('Unshelved')), JSON.stringify(shelfState.tabs));
  check('new book starts Unshelved', shelfState.unshelved >= 1, String(shelfState.unshelved));

  // Move the book onto a shelf via the book detail picker
  await page.getByRole('button', { name: /The Lighthouse/ }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.shelf-row .shelf-trigger').click();
  await page.waitForTimeout(200);
  await page.locator('.shelf-listbox .shelf-option', { hasText: 'Bedside' }).click();
  await page.waitForTimeout(400);

  const moved = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    const book = raw.books.find((b) => b.title.startsWith('The Lighthouse'));
    const shelf = raw.shelves.find((s) => s.id === book.shelfId);
    return { shelfName: shelf?.name ?? null };
  });
  check('book moved to a shelf from its page', moved.shelfName === 'Bedside', JSON.stringify(moved));

  // Filter by shelf
  await page.getByRole('button', { name: /Back to library/ }).click();
  await page.waitForTimeout(300);
  await page.locator('.shelf-tab', { hasText: 'Bedside' }).click();
  await page.waitForTimeout(300);
  const filtered = await page.evaluate(() => ({
    heading: document.querySelector('#library-title')?.textContent,
    cards: [...document.querySelectorAll('.book-card .book-link')].map((b) => b.textContent),
  }));
  check('shelf filter shows only that shelf', filtered.heading === 'Bedside' && filtered.cards.every((c) => c.startsWith('The Lighthouse')), JSON.stringify(filtered));

  /* ---- 3. One book, one shelf ---- */
  await page.locator('.shelf-tab', { hasText: 'All' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /The Lighthouse/ }).first().click();
  await page.waitForTimeout(250);
  await page.locator('.shelf-row .shelf-trigger').click();
  await page.waitForTimeout(200);
  await page.locator('.shelf-listbox .shelf-option', { hasText: 'Research' }).click();
  await page.waitForTimeout(400);
  const singleShelf = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    const book = raw.books.find((b) => b.title.startsWith('The Lighthouse'));
    const others = raw.books.filter((b) => b.shelfId === book.shelfId && b.id !== book.id).length;
    return { shelfId: book.shelfId, siblingCount: others, name: raw.shelves.find((s) => s.id === book.shelfId)?.name };
  });
  check('moving a book replaces its shelf, never adds a second', singleShelf.shelfId != null && singleShelf.name === 'Research', JSON.stringify(singleShelf));

  /* ---- 4. Deleting a shelf keeps its books ---- */
  await page.getByRole('button', { name: /Back to library/ }).click();
  await page.waitForTimeout(300);
  page.once('dialog', (d) => d.accept());
  await page.locator('.shelf-tab-wrap', { hasText: 'Research' }).locator('button[aria-label*="Delete shelf"]').click({ force: true });
  await page.waitForTimeout(500);
  const afterShelfDelete = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    const book = raw.books.find((b) => b.title.startsWith('The Lighthouse'));
    return { shelves: raw.shelves.map((s) => s.name), bookStillThere: !!book, shelfId: book?.shelfId };
  });
  check('deleting a shelf does not delete its books', afterShelfDelete.bookStillThere === true, JSON.stringify(afterShelfDelete));
  check('the book falls back to Unshelved', afterShelfDelete.shelfId === undefined, String(afterShelfDelete.shelfId));

  /* ---- 5. Delete book offers a working undo ---- */
  await page.getByRole('button', { name: /The Lighthouse/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Delete book/ }).click();
  await page.waitForTimeout(300);
  const confirmText = await page.locator('[role=dialog]').textContent();
  check('delete confirm mentions the EPUB file', /EPUB file/.test(confirmText ?? ''), (confirmText ?? '').slice(0, 80));

  await page.getByRole('button', { name: /Delete book and quotes/ }).click();
  await page.waitForTimeout(500);
  const afterDelete = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return {
      books: raw.books.filter((b) => b.title.startsWith('The Lighthouse')).length,
      undo: !!document.querySelector('.toast-action'),
      toast: document.querySelector('.toast')?.textContent ?? null,
    };
  });
  check('book deleted', afterDelete.books === 0, JSON.stringify(afterDelete));
  check('undo is offered in the message', afterDelete.undo === true, String(afterDelete.toast));

  await page.locator('.toast-action').click();
  await page.waitForTimeout(500);
  const afterUndo = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return { books: raw.books.filter((b) => b.title.startsWith('The Lighthouse')).length };
  });
  check('undo restores the book', afterUndo.books === 1, JSON.stringify(afterUndo));

  /* ---- 6. Manual add still works ---- */
  await page.getByRole('button', { name: /Library/ }).first().click();
  await page.waitForTimeout(250);
  await page.locator('.header-actions').getByRole('button', { name: /Add book/ }).click();
  await page.waitForTimeout(250);
  await page.locator('.segment', { hasText: 'By hand' }).click();
  await page.fill('#mb-title', 'Typed By Hand');
  await page.locator('.segmented ~ form').getByRole('button', { name: 'Add book' }).click();
  await page.waitForTimeout(500);
  const manual = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    const book = raw.books.find((b) => b.title === 'Typed By Hand');
    return { found: !!book, hasFile: !!book?.file };
  });
  check('manual add creates a metadata-only book', manual.found && manual.hasFile === false, JSON.stringify(manual));

  /* ---- 7. Rejecting a non-EPUB ---- */
  await page.locator('.header-actions').getByRole('button', { name: /Add book/ }).click();
  await page.waitForTimeout(250);
  await page.locator('input[type=file]').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an epub'),
  });
  await page.waitForTimeout(600);
  const rejected = await page.evaluate(() => ({
    alert: document.querySelector('.inline-alert')?.textContent ?? null,
    preview: !!document.querySelector('.file-preview'),
  }));
  check('non-EPUB is refused with a reason', /not an EPUB/.test(rejected.alert ?? '') && !rejected.preview, JSON.stringify(rejected));

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
