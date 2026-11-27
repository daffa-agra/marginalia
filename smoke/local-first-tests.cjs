/*
 * The local-first guarantee, proven with the cloud deliberately dead:
 * a book whose R2 copy does not exist (and whose upload failed) must keep
 * everything the reader does in it — position, notes, highlights, quotes —
 * across a full reload.
 *
 * Every request to the API host and the R2 host is aborted at the browser
 * level, so nothing can lean on the network even by accident.
 *
 * Needs the built app served on http://127.0.0.1:4173 (see README):
 *   node smoke/serve-dist.cjs
 *   node smoke/local-first-tests.cjs
 */
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    // The author's machine resolves it from a global npx cache; keep working
    // there, as qa-exploratory does.
    return require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');
  }
}
const playwright = loadPlaywright();

const BASE = 'http://127.0.0.1:4173/';
const FIXTURE = require('path').join(__dirname, '..', '.review', 'fixtures', 'lighthouse.epub');

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome' }).catch(() => playwright.chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // The cloud does not exist in this scenario: abort everything aimed at it.
  await ctx.route('**/api.books.daffagra.my.id/**', (route) => route.abort('internetdisconnected'));
  await ctx.route('**/r2.cloudflarestorage.com/**', (route) => route.abort('internetdisconnected'));

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });

  /* ── 1. add an EPUB with the cloud dead ── */
  await page.locator('.header-actions').getByRole('button', { name: /Add book/ }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.waitForTimeout(900);
  if (!(await page.$('.file-preview'))) {
    console.log('✗ preview never appeared; aborting');
    await browser.close();
    process.exit(1);
  }
  await page.getByRole('button', { name: /Add book/ }).last().click();
  await page.waitForTimeout(2500); // includes the (failed) background upload attempt

  const afterAdd = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    const b = raw.books.find((x) => x.title.startsWith('The Lighthouse'));
    return b ? { id: b.id, hasFile: !!b.file, sha: b.file?.sha256 ?? null } : null;
  });
  check('book added with the cloud unreachable', !!afterAdd, JSON.stringify(afterAdd));
  check('no sha256 was stamped (upload never succeeded)', afterAdd?.sha === null);

  /* ── 2. read it, turn pages, annotate ── */
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /The Lighthouse/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.waitForSelector('.reader-frame', { timeout: 15000 });
  await page.waitForTimeout(1200); // layout + font settle

  const frame = page.frameLocator('.reader-frame');
  const bodyText = await frame.locator('body').innerText();
  check('chapter renders from local bytes', bodyText.length > 100, `${bodyText.length} chars`);

  // Turn two pages (arrow keys), then take a note on page 3.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);

  // Select some real text inside the book frame.
  const selected = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    const content = doc.getElementById('book-content');
    const walker = doc.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim().length > 60) {
        const sel = doc.getSelection();
        const range = doc.createRange();
        range.setStart(node, 5);
        range.setEnd(node, Math.min(node.textContent.length, 45));
        sel.removeAllRanges();
        sel.addRange(range);
        return node.textContent.trim().slice(0, 40);
      }
  }
    return null;
  });
  check('a passage was selected', !!selected, selected ?? '');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.margin-composer textarea').fill('Local-only note that must survive everything.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.waitForTimeout(600);

  const afterNote = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    const b = raw.books.find((x) => x.title.startsWith('The Lighthouse'));
    return {
      position: b.position ?? null,
      quotes: raw.quotes.filter((q) => !q.deletedAt).map((q) => ({ text: q.text.slice(0, 30), note: q.note ?? null, anchorChapter: q.anchor?.chapter })),
    };
  });
  check(
    'position recorded after two page turns',
    afterNote.position && typeof afterNote.position.fraction === 'number',
    JSON.stringify(afterNote.position),
  );
  check('note saved with a text anchor', afterNote.quotes.length === 1 && afterNote.quotes[0].note, JSON.stringify(afterNote.quotes));

  /* ── 3. the hard part: full reload, cloud still dead ── */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /The Lighthouse/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^Continue reading$|^Read$/ }).first().click();
  await page.waitForSelector('.reader-frame', { timeout: 15000 });
  await page.waitForTimeout(1200);

  const restored = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    const b = raw.books.find((x) => x.title.startsWith('The Lighthouse'));
    return { position: b.position ?? null };
  });
  const posBefore = afterNote.position;
  const posAfter = restored.position;
  check(
    'position survives the reload exactly',
    posAfter && posBefore && posAfter.chapter === posBefore.chapter && Math.abs(posAfter.fraction - posBefore.fraction) < 0.01,
    `before ${JSON.stringify(posBefore)} / after ${JSON.stringify(posAfter)}`,
  );

  const frame2 = page.frameLocator('.reader-frame');
  const highlight = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    return doc.querySelectorAll('mark.reader-highlight').length;
  });
  check('highlight repainted after reload', highlight >= 1, `${highlight} mark(s)`);

  // Click the highlight to re-open the note.
  await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    doc.querySelector('mark.reader-highlight').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const noteBack = await page.locator('.margin-composer textarea').inputValue().catch(() => null);
  check('note text survives the reload', noteBack === 'Local-only note that must survive everything.', JSON.stringify(noteBack));

  // Leave the reader, check the quotes view too.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const quotesView = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return raw.quotes.filter((q) => !q.deletedAt).length;
  });
  check('quote persisted in the journal', quotesView === 1, String(quotesView));

  check('no page errors during the whole offline run', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

  await browser.close();
  console.log(failures === 0 ? '\nPASS: the local-first guarantee holds with the cloud dead' : `\nFAIL: ${failures} check(s)`);
  process.exit(failures === 0 ? 0 : 1);
})();
