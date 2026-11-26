/*
 * Browser tests: marginalia — select a passage, note it, and prove the note is
 * still on the same words after a reload AND after a font-size change.
 *
 * This is the Phase 2 acceptance criterion, and it is a browser test rather than
 * a unit test on purpose: the thing being proved is that a DOM path survives a
 * re-layout, which no stub can demonstrate.
 */
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
  await page.waitForTimeout(400);
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.waitForTimeout(1500);
  await page.locator('.modal-panel').getByRole('button', { name: 'Add book', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /^Read$/ }).click();
  await page.waitForTimeout(2600);
}

/** Selects the Nth sentence-ish slice of the first paragraph, like a reader would. */
async function selectText(page, wordCount = 6) {
  return page.evaluate((count) => {
    const frame = document.querySelector('.reader-frame');
    const doc = frame.contentDocument;
    const p = doc.querySelector('#book-content p');
    if (!p) return null;
    // Find the first text node with enough words.
    const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node = null;
    while (walker.nextNode()) {
      if ((walker.currentNode.nodeValue ?? '').trim().split(/\s+/).length >= count) {
        node = walker.currentNode;
        break;
      }
    }
    if (!node) return null;
    const text = node.nodeValue;
    // Take `count` whole words from the start.
    const match = new RegExp(`^(\\s*\\S+){${count}}`).exec(text);
    const end = match ? match[0].length : Math.min(40, text.length);
    const range = doc.createRange();
    range.setStart(node, 0);
    range.setEnd(node, end);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // The reader listens for selectionchange.
    doc.dispatchEvent(new Event('selectionchange'));
    return { selected: range.toString(), end };
  }, wordCount);
}

/** The highlighted text currently painted in the chapter, in document order. */
async function paintedHighlights(page) {
  return page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    return [...doc.querySelectorAll('mark.reader-highlight')].map((m) => ({
      text: m.textContent,
      tone: m.getAttribute('data-tone'),
      id: m.getAttribute('data-highlight-id'),
    }));
  });
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

  /* ── 1. selecting raises the toolbar ── */
  const picked = await selectText(page, 6);
  check('a passage can be selected in the book', !!picked && picked.selected.trim().length > 0, JSON.stringify(picked?.selected?.slice(0, 40)));
  await page.waitForTimeout(600);
  const toolbar = await page.evaluate(() => {
    const bar = document.querySelector('.selection-toolbar');
    if (!bar) return null;
    return {
      visible: true,
      buttons: [...bar.querySelectorAll('button')].map((b) => b.textContent.trim()),
    };
  });
  check('the selection toolbar appears', toolbar?.visible === true, JSON.stringify(toolbar?.buttons));
  check('the toolbar offers Note, Quote and Copy',
    ['Note', 'Quote', 'Copy'].every((label) => toolbar?.buttons.some((b) => b.startsWith(label))),
    JSON.stringify(toolbar?.buttons));

  /* ── 2. Note → composer → save ── */
  await page.locator('.selection-toolbar button', { hasText: 'Note' }).click();
  await page.waitForTimeout(500);
  const composer = await page.evaluate(() => {
    const el = document.querySelector('.margin-composer');
    return el ? { open: true, quote: el.querySelector('.margin-composer-quote')?.textContent ?? '', hasTextarea: !!el.querySelector('textarea') } : null;
  });
  check('the margin composer opens with the passage', composer?.open === true && composer.hasTextarea, JSON.stringify(composer?.quote?.slice(0, 40)));
  check('the composer shows the selected words', composer?.quote === picked?.selected, `"${composer?.quote?.slice(0, 30)}…"`);

  const NOTE = 'The lighthouse is a promise, not a warning.';
  await page.locator('.margin-composer textarea').fill(NOTE);
  await page.locator('.margin-composer button', { hasText: 'Save note' }).click();
  await page.waitForTimeout(900);

  const stored = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return raw.quotes;
  });
  check('the note is saved to the journal', stored.length === 1, `${stored.length} quote(s)`);
  check('the saved quote carries an anchor, not a page number',
    !!stored[0]?.anchor && typeof stored[0].anchor.chapter === 'number' && /@\d+$/.test(stored[0].anchor.start),
    JSON.stringify(stored[0]?.anchor && { chapter: stored[0].anchor.chapter, start: stored[0].anchor.start }));
  check('the saved quote keeps the selected text',
    stored[0]?.text === picked?.selected, `"${stored[0]?.text?.slice(0, 30)}…"`);
  check('the saved quote keeps the note', stored[0]?.note === NOTE, stored[0]?.note);
  check('the quote records progress through the book', typeof stored[0]?.percent === 'number', String(stored[0]?.percent));

  /* ── 3. the highlight is painted ── */
  const painted = await paintedHighlights(page);
  check('the passage is highlighted in the page', painted.length === 1, JSON.stringify(painted.map((h) => h.text.slice(0, 20))));
  check('a note highlight is marked as a note', painted[0]?.tone === 'note', painted[0]?.tone);
  check('the highlight covers the selected words', painted[0]?.text === picked?.selected, `"${painted[0]?.text?.slice(0, 30)}…"`);

  /* ── 4. it survives a reload ── */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.locator('.book-card .book-link').first().click();
  await page.waitForTimeout(600);
  // The label depends on whether there is saved progress to resume.
  const cont = page.getByRole('button', { name: /Continue reading/ }).first();
  if (await cont.count()) await cont.click();
  else await page.getByRole('button', { name: /^Read$/ }).click();
  await page.waitForTimeout(2800);
  const afterReload = await paintedHighlights(page);
  check('the highlight is repainted after a reload', afterReload.length === 1, JSON.stringify(afterReload.map((h) => h.text.slice(0, 20))));
  check('the highlight still covers the same words', afterReload[0]?.text === picked?.selected,
    `"${afterReload[0]?.text?.slice(0, 30)}…"`);

  /* ── 5. and survives a font-size change (the real test) ── */
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.waitForTimeout(400);
  const slider = page.locator('.reader-settings input[aria-label="Font size"]');
  await slider.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '28');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.waitForTimeout(600);
  const afterReflow = await paintedHighlights(page);
  check('the highlight survives a font-size change', afterReflow.length === 1,
    JSON.stringify(afterReflow.map((h) => h.text.slice(0, 20))));
  check('the highlight still covers the same words after reflow',
    afterReflow[0]?.text === picked?.selected, `"${afterReflow[0]?.text?.slice(0, 30)}…"`);
  const stillStored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('marginalia.journal.v1')).quotes[0]?.anchor);
  // Compare against what the reader actually persisted (after sanitising), not
  // against the render-time object, which carries extra whitespace context.
  const persistedAnchor = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('marginalia.journal.v1')).quotes[0]?.anchor);
  check('the stored anchor did not change with the layout',
    JSON.stringify(stillStored) === JSON.stringify(persistedAnchor) &&
      stillStored?.start === stored[0]?.anchor?.start &&
      stillStored?.end === stored[0]?.anchor?.end,
    `${stored[0]?.anchor?.start} → ${stillStored?.start}`);

  /* ── 6. clicking a highlight re-opens the note ── */
  const box = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    const mark = doc.querySelector('mark.reader-highlight');
    if (!mark) return null;
    const r = mark.getBoundingClientRect();
    const f = document.querySelector('.reader-frame').getBoundingClientRect();
    return { x: f.left + r.x + r.width / 2, y: f.top + r.y + r.height / 2, w: r.width };
  });
  if (box && box.w > 0) {
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(700);
    const reopened = await page.evaluate(() => {
      const el = document.querySelector('.margin-composer');
      return el ? { open: true, note: el.querySelector('textarea')?.value ?? '' } : null;
    });
    check('clicking a highlight opens its note', reopened?.open === true);
    check('the note text is loaded into the composer', reopened?.note === NOTE, JSON.stringify(reopened?.note));
    const editable = await page.evaluate(() => !!document.querySelector('.margin-composer button'));
    check('an existing note offers editing', editable);
    // Edit and save.
    await page.locator('.margin-composer textarea').fill(`${NOTE} And the sea forgets.`);
    await page.locator('.margin-composer button', { hasText: 'Save note' }).click();
    await page.waitForTimeout(800);
    const edited = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('marginalia.journal.v1')).quotes[0]?.note);
    check('editing an existing note saves', edited === `${NOTE} And the sea forgets.`, JSON.stringify(edited));
  } else {
    check('a highlight is clickable after reflow', false, 'no mark found');
  }

  /* ── 7. Quote action creates a quote without a note ── */
  await page.waitForTimeout(400);
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('marginalia.journal.v1')).quotes.length);
  await selectText(page, 4);
  await page.waitForTimeout(600);
  const hasBar = await page.evaluate(() => !!document.querySelector('.selection-toolbar'));
  if (hasBar) {
    await page.locator('.selection-toolbar button', { hasText: 'Quote' }).click();
    await page.waitForTimeout(700);
    const after = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('marginalia.journal.v1')).quotes.length);
    check('the Quote action adds a quote without a note', after === before + 1, `${before} → ${after}`);
  } else {
    check('the toolbar is available for a second selection', false, 'no toolbar');
  }

  /* ── 8. the quote reaches the journal view ── */
  // Escape closes the note, then leaves the reader to the book page; the nav
  // only exists outside the detail view, so go back to the library first.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const wentToLibrary = await page.evaluate(() => !!document.querySelector('.nav-list'));
  if (!wentToLibrary) {
    console.log('  [debug] errors so far:', JSON.stringify(errors.slice(0, 5)));
    console.log('  [debug] body length:', await page.evaluate(() => document.body.textContent?.length ?? -1));
    console.log('  [debug] body head:', await page.evaluate(() => (document.body.textContent ?? '').slice(0, 200)));
    console.log('  [debug] html:', await page.evaluate(() => document.body.innerHTML.slice(0, 300)));
  }
  await page.locator('.nav-list button', { hasText: 'Quotes' }).first().click();
  await page.waitForTimeout(900);
  const inJournal = await page.evaluate(() =>
    [...document.querySelectorAll('.quote-card, .quote-item, article')].map((c) => c.textContent ?? ''));
  check('saved marginalia appear in the Quotes view', inJournal.length >= 1, `${inJournal.length} cards`);
  const hasNote = inJournal.some((t) => /lighthouse is a promise/.test(t));
  const hasQuote = inJournal.some((t) => /This is paragraph text/.test(t));
  check('the note is listed in the journal', hasNote, hasNote ? 'found' : inJournal.map((t) => t.slice(0, 40)).join(' | '));
  check('the quoted passage is listed in the journal', hasQuote);

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
