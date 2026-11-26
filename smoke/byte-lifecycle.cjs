/* Verify the delete → undo → permanent-delete lifecycle for book bytes. */
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');

const BASE = 'http://127.0.0.1:4173/';

async function keysIn(page) {
  return page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('marginalia', 1);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    return new Promise((res, rej) => {
      const t = db.transaction('files', 'readonly');
      const q = t.objectStore('files').getAllKeys();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  });
}

async function openBookDetail(page) {
  // The library list is the only place a book can be opened from.
  await page.getByRole('button', { name: /Library/ }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.book-card .book-link').first().click();
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // 1. Upload an EPUB.
  await page.locator('.header-actions').getByRole('button', { name: /Add book/ }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type=file]').setInputFiles('.review/fixtures/lighthouse.epub');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Add book/ }).last().click();
  await page.waitForTimeout(900);
  const before = await keysIn(page);

  // 2. Delete, then undo immediately.
  await openBookDetail(page);
  await page.getByRole('button', { name: /Delete book/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Delete book and quotes/ }).click();
  await page.waitForTimeout(600);
  const duringUndo = await keysIn(page);
  await page.locator('.toast-action').click();
  await page.waitForTimeout(800);
  const afterUndo = await keysIn(page);
  const restored = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return { books: raw.books.length, hasFile: !!raw.books[0]?.file };
  });

  // 3. Delete again and let the undo window expire.
  await openBookDetail(page);
  await page.getByRole('button', { name: /Delete book/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Delete book and quotes/ }).click();
  await page.waitForTimeout(11000);
  const afterExpiry = await keysIn(page);

  console.log(
    JSON.stringify({ before, duringUndo, afterUndo, restored, afterExpiry }, null, 1),
  );

  const ok =
    before.length === 1 &&
    duringUndo.length === 1 &&
    afterUndo.length === 1 &&
    restored.books === 1 &&
    restored.hasFile === true &&
    afterExpiry.length === 0;
  console.log(ok ? 'PASS  undo preserves the EPUB; expiry clears it' : 'FAIL  byte lifecycle wrong');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
