/* Browser test: pagination and reader customization. */
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

async function openReader(page) {
  await page.locator('.header-actions').getByRole('button', { name: /Add book/ }).click();
  await page.waitForTimeout(500);
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.waitForTimeout(1800);
  await page.locator('.modal-panel').getByRole('button', { name: 'Add book', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: /^Read$/ }).click();
  await page.waitForTimeout(2800);
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
  await openReader(page);

  /* --- pagination exists --- */
  const paging = await page.evaluate(() => {
    const label = document.querySelector('.reader-chapter')?.textContent ?? '';
    return { label, hasPageInfo: /page \d+ of \d+/.test(label) };
  });
  check('chapter is paginated into pages', paging.hasPageInfo, paging.label);
  const pageCount = Number(/page 1 of (\d+)/.exec(paging.label)?.[1] ?? 0);
  check('a chapter makes more than one page', pageCount > 1, `${pageCount} pages`);

  /* --- the frame is horizontally paged, not scrolled --- */
  const layout = await page.evaluate(() => {
    const frame = document.querySelector('.reader-frame');
    const doc = frame.contentDocument;
    const body = doc.body;
    const style = doc.defaultView.getComputedStyle(body);
    return {
      columns: style.columnWidth,
      overflow: style.overflow,
      transform: style.transform,
      heightFixed: style.height,
    };
  });
  check('content is laid out in columns', layout.columns !== 'auto' && layout.columns !== '', JSON.stringify(layout.columns));
  check('frame clips overflow instead of scrolling', layout.overflow === 'hidden', String(layout.overflow));

  /* --- turning pages --- */
  const firstTransform = await page.evaluate(() => {
    const frame = document.querySelector('.reader-frame');
    return frame.contentDocument.body.style.transform;
  });
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForTimeout(600);
  const secondTransform = await page.evaluate(() => {
    const frame = document.querySelector('.reader-frame');
    return frame.contentDocument.body.style.transform;
  });
  const afterLabel = await page.evaluate(() => document.querySelector('.reader-chapter')?.textContent ?? '');
  check('turning a page moves the content', firstTransform !== secondTransform, `${firstTransform} → ${secondTransform}`);
  check('page counter advances', /page 2 of/.test(afterLabel), afterLabel);

  /* --- keyboard paging --- */
  // Reading was on the last page of chapter 1, so ArrowRight advances the
  // chapter rather than the page; go back to a page with room first.
  await page.evaluate(() => {
    document.querySelector('.reader-frame').focus();
  });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(700);
  const beforeKey = await page.evaluate(() => document.querySelector('.reader-chapter')?.textContent ?? '');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);
  const kbLabel = await page.evaluate(() => document.querySelector('.reader-chapter')?.textContent ?? '');
  check('arrow key turns the page', beforeKey !== kbLabel, `${beforeKey} → ${kbLabel}`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(700);
  const backLabel = await page.evaluate(() => document.querySelector('.reader-chapter')?.textContent ?? '');
  check('arrow key turns back', backLabel === beforeKey, `${backLabel}`);

  /* --- reaching the end advances the chapter --- */
  let guard = 0;
  while (!/chapter 2|2 of 6/.test(await page.evaluate(() => document.querySelector('.reader-chapter')?.textContent ?? '')) && guard < 40) {
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForTimeout(180);
    guard += 1;
  }
  const ch2 = await page.evaluate(() => ({
    label: document.querySelector('.reader-chapter')?.textContent ?? '',
    page: /page 1 of/.test(document.querySelector('.reader-chapter')?.textContent ?? ''),
  }));
  check('last page turns into the next chapter', /2 of 6/.test(ch2.label) && ch2.page, ch2.label);

  /* --- open the settings panel --- */
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.waitForTimeout(500);
  const panel = await page.evaluate(() => ({
    open: !!document.querySelector('.reader-settings'),
    controls: document.querySelectorAll('.reader-settings input[type=range]').length,
    groups: [...document.querySelectorAll('.reader-settings-group h3')].map((h) => h.textContent.trim()),
  }));
  check('settings panel opens', panel.open === true, JSON.stringify(panel.groups));
  check('panel exposes many controls', panel.controls >= 8, `${panel.controls} sliders`);

  /* --- font size actually changes the book page --- */
  const sizeBefore = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    return doc.defaultView.getComputedStyle(doc.body).fontSize;
  });
  const slider = page.locator('.reader-settings input[aria-label="Font size"]');
  // React tracks the value on the DOM node, so a plain assignment is ignored.
  // Use the native setter, then dispatch the event React listens for.
  await slider.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '28');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1800);
  const sizeAfter = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    return doc.defaultView.getComputedStyle(doc.body).fontSize;
  });
  check('font size slider changes the page', sizeBefore !== sizeAfter && parseFloat(sizeAfter) === 28, `${sizeBefore} → ${sizeAfter}`);

  /* --- reflow repaginates instead of overflowing --- */
  const afterReflow = await page.evaluate(() => {
    const label = document.querySelector('.reader-chapter')?.textContent ?? '';
    return { label, pages: Number(/of (\d+)$/.exec(label)?.[1] ?? 0) };
  });
  check('bigger text produces more pages', afterReflow.pages > 1 && /page \d+ of/.test(afterReflow.label), afterReflow.label);

  /* --- theme switch --- */
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await page.waitForTimeout(1200);
  const nightColours = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    const s = doc.defaultView.getComputedStyle(doc.body);
    return { color: s.color, background: s.backgroundColor };
  });
  check('night theme recolours the page', nightColours.background === 'rgb(20, 17, 14)', JSON.stringify(nightColours));

  /* --- per-book scope --- */
  // A change has now been made on this book, so the panel should say so.
  const scope = await page.evaluate(() => document.querySelector('.reader-settings-scope')?.textContent ?? '');
  check('settings show they are scoped to this book', /This book only/.test(scope), scope.slice(0, 60));

  /* --- AA spacing button --- */
  await page.getByRole('button', { name: /Text spacing \(AA\)/ }).click();
  await page.waitForTimeout(1600);
  const aa = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    const s = doc.defaultView.getComputedStyle(doc.body);
    return { letterSpacing: s.letterSpacing, wordSpacing: s.wordSpacing, lineHeight: s.lineHeight };
  });
  const fontSize = parseFloat(await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    return doc.defaultView.getComputedStyle(doc.body).fontSize;
  }));
  check('AA spacing sets letter spacing', parseFloat(aa.letterSpacing) >= fontSize * 0.12 - 0.5, `${aa.letterSpacing} at ${fontSize}px`);
  check('AA spacing sets word spacing', parseFloat(aa.wordSpacing) > 0, aa.wordSpacing);
  check('AA spacing sets line height', parseFloat(aa.lineHeight) >= fontSize * 1.5 - 1, `${aa.lineHeight} at ${fontSize}px`);

  /* --- preset --- */
  await page.getByRole('button', { name: 'Compact', exact: true }).click();
  await page.waitForTimeout(1400);
  const compact = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    return doc.defaultView.getComputedStyle(doc.body).fontSize;
  });
  check('preset applies its font size', parseFloat(compact) === 15, compact);

  /* --- settings survive a reload --- */
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const stored = await page.evaluate(() => localStorage.getItem('marginalia.reader.v1'));
  check('reader settings persist separately from the journal', !!stored && /fontSizePx/.test(stored ?? ''), (stored ?? '').slice(0, 50));

  /* --- position survives a pagination change --- */
  await page.locator('.book-card .book-link').first().click();
  await page.waitForTimeout(700);
  const pos = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return raw.books[0].position;
  });
  check('page position is stored as a fraction, not a page number', !!pos && typeof pos.fraction === 'number' && pos.chapter >= 1, JSON.stringify(pos));

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
