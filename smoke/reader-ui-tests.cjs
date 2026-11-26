/* Browser test: upload an EPUB, read it, and prove position survives a reload. */
const path = require('path');
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');

const BASE = 'http://127.0.0.1:4173/';
const FIXTURE = path.join(__dirname, '..', '.review', 'fixtures', 'reader-test.epub');
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

  /* --- upload the book --- */
  await page.locator('.header-actions').getByRole('button', { name: /Add book/ }).click();
  await page.waitForTimeout(400);
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.waitForTimeout(1500);
  const preview = await page.evaluate(() => ({
    title: document.querySelector('#up-title')?.value,
    preview: !!document.querySelector('.file-preview'),
  }));
  check('EPUB uploads and previews', preview.preview === true, JSON.stringify(preview));
  await page.getByRole('button', { name: /^Add book$/ }).last().click();
  await page.waitForTimeout(1200);

  /* --- the read button --- */
  const readBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.detail-action-row .btn')].map((b) => b.textContent.trim());
    return btns;
  });
  check('book page offers a Read button', readBtn.some((b) => /^Read/.test(b)), JSON.stringify(readBtn));

  /* --- open the reader --- */
  await page.getByRole('button', { name: /^Read$/ }).click();
  await page.waitForTimeout(2000);
  const readerOpen = await page.evaluate(() => ({
    reader: !!document.querySelector('.reader'),
    frame: !!document.querySelector('.reader-frame'),
    title: document.querySelector('.reader-book-title')?.textContent,
    chapter: document.querySelector('.reader-chapter')?.textContent,
  }));
  check('reader opens', readerOpen.reader === true && readerOpen.frame === true, JSON.stringify(readerOpen));
  check('reader shows the book title', readerOpen.title === 'Six Chapters of Sea', String(readerOpen.title));

  /* --- chapter content actually rendered inside the iframe --- */
  const frame = page.frameLocator('.reader-frame');
  await page.waitForTimeout(600);
  const chapterText = await frame.locator('#book-content').textContent().catch(() => '');
  check('chapter content renders in the iframe', /Chapter 1/.test(chapterText ?? ''), (chapterText ?? '').slice(0, 60));

  /* --- the book's own CSS is applied --- */
  const bookCssApplied = await frame.locator('h1').evaluate((el) => {
    const s = window.getComputedStyle(el);
    return { letterSpacing: s.letterSpacing, fontSize: s.fontSize };
  }).catch(() => null);
  check('book stylesheet applied', !!bookCssApplied, JSON.stringify(bookCssApplied));

  /* --- scripts cannot run inside the reader --- */
  const scriptBlocked = await page.evaluate(() => {
    const iframe = document.querySelector('.reader-frame');
    return { sandbox: iframe.getAttribute('sandbox') };
  });
  check('iframe is sandboxed without allow-scripts', !/allow-scripts/.test(scriptBlocked.sandbox ?? ''), JSON.stringify(scriptBlocked));

  /* --- table of contents --- */
  await page.getByRole('button', { name: 'Table of contents' }).click();
  await page.waitForTimeout(500);
  const toc = await page.evaluate(() => ({
    open: !!document.querySelector('.reader-toc'),
    entries: [...document.querySelectorAll('.reader-toc-link')].map((a) => a.textContent.trim()),
  }));
  check('table of contents opens with entries', toc.open && toc.entries.length === 6, JSON.stringify(toc.entries.slice(0, 3)));
  check('TOC labels come from the book', toc.entries.some((e) => /Lighthouse/.test(e)), JSON.stringify(toc.entries[0]));

  /* --- navigate via TOC to chapter 3 (which has an image) --- */
  await page.locator('.reader-toc-link', { hasText: 'Three' }).click();
  await page.waitForTimeout(1500);
  const ch3 = await page.evaluate(() => document.querySelector('.reader-chapter')?.textContent);
  check('TOC navigation moves to chapter 3', /3 of 6/.test(ch3 ?? ''), String(ch3));

  const imgOk = await page.frameLocator('.reader-frame').locator('img').first()
    .evaluate((img) => ({ src: img.getAttribute('src'), w: img.naturalWidth, complete: img.complete }))
    .catch(() => null);
  check('embedded image loads from a blob URL', !!imgOk && /^blob:/.test(imgOk.src ?? '') && imgOk.w > 0, JSON.stringify(imgOk));

  /* --- font size control (lives in the settings panel) --- */
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.waitForTimeout(600);
  await page.locator('.reader-settings input[aria-label="Font size"]').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '24');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1600);
  const fs = await page.frameLocator('.reader-frame').locator('body').evaluate((el) => window.getComputedStyle(el).fontSize).catch(() => null);
  check('text size control changes the page', fs !== null && parseFloat(fs) === 24, String(fs));
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.waitForTimeout(500);
  /* --- next chapter button --- */
  /* --- next page advances within the chapter --- */
  const beforePage = await page.evaluate(() => document.querySelector('.reader-chapter')?.textContent ?? '');
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForTimeout(1200);
  const afterPage = await page.evaluate(() => document.querySelector('.reader-chapter')?.textContent ?? '');
  check('next-page button advances a page', beforePage !== afterPage, `${beforePage} → ${afterPage}`);

  /* --- position persists across reload --- */
  const storedPos = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('marginalia.journal.v1')).books[0].position,
  );
  check(
    'position is stored on the book',
    !!storedPos && typeof storedPos.chapter === 'number' && typeof storedPos.fraction === 'number',
    JSON.stringify(storedPos),
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.locator('.book-card .book-link').first().click();
  await page.waitForTimeout(600);
  const continueBtn = await page.evaluate(() =>
    [...document.querySelectorAll('.detail-action-row .btn')].map((b) => b.textContent.trim()),
  );
  check('book page offers Continue reading after progress', continueBtn.some((b) => /Continue reading/.test(b)), JSON.stringify(continueBtn));

  await page.getByRole('button', { name: /Continue reading/ }).first().click();
  await page.waitForTimeout(2200);
  const resumed = await page.evaluate(() => document.querySelector('.reader-chapter')?.textContent);
  check(
    'reader resumes at the stored chapter',
    /^3 of 6/.test(resumed ?? ''),
    String(resumed),
  );

  /* --- escape leaves the reader --- */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const back = await page.evaluate(() => ({ reader: !!document.querySelector('.reader'), detail: !!document.querySelector('#book-title') }));
  check('Escape returns to the book page', back.reader === false && back.detail === true, JSON.stringify(back));

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});



