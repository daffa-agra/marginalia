/* Verification harness for the trust-and-state pass.
 * Re-runs every defect the critique measured, against the rebuilt app.
 * Usage: node smoke/verify-trust.cjs
 */
const fs = require('fs');
const path = require('path');
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');

const BASE = 'http://127.0.0.1:4173/';
const out = {};
let pass = 0;
let fail = 0;
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  return { ctx, page: await ctx.newPage() };
}

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });

  /* 1. Status model: every status menu option applies exactly its label. */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Make the journal real so sample logic does not interfere.
    await page.evaluate(() => {
      localStorage.setItem(
        'marginalia.journal.v1',
        JSON.stringify({
          version: 1,
          books: [{ id: 'b1', title: 'Status Test', author: 'A', status: 'reading', currentPage: 40, totalPages: 100, genres: [], color: '#3f6f71', createdAt: 1 }],
          quotes: [],
        }),
      );
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const matrix = [];
    for (const [option, expected] of [
      ['Want to read', 'Want to read'],
      ['Finished', 'Finished'],
      ['Abandoned', 'Abandoned'],
      ['Reading', 'Reading'],
    ]) {
      await page.locator('.book-card .status-trigger').first().click();
      await page.locator('[role=menu] [role=menuitemradio]', { hasText: option }).first().click();
      await page.waitForTimeout(200);
      const label = (await page.locator('.book-card .status-trigger-label').first().textContent()).trim();
      const stored = await page.evaluate(() => {
        const raw = localStorage.getItem('marginalia.journal.v1');
        return raw ? JSON.parse(raw).books[0] : null;
      });
      matrix.push({ chosen: option, label, expected, status: stored?.status, startedAt: stored?.startedAt, finishedAt: stored?.finishedAt, currentPage: stored?.currentPage });
      check(`status "${option}" applies "${expected}"`, label === expected && stored?.status === expected.toLowerCase().replace(/ /g, '-'), `label=${label} stored=${stored?.status}`);
    }
    // Finished sets finishedAt and completes pages; Abandoned clears finishedAt.
    const finishedState = matrix.find((m) => m.chosen === 'Finished');
    check('Finished stamps a finish date and the last page', !!finishedState?.finishedAt && finishedState?.currentPage === 100, JSON.stringify(finishedState));
    const abandonedState = matrix.find((m) => m.chosen === 'Abandoned');
    check('Abandoned clears the finish date', abandonedState?.finishedAt === undefined, JSON.stringify(abandonedState));
    out.status = matrix;
    await ctx.close();
  }

  /* 2. Durability: a blocked write is announced, and nothing claims success. */
  {
    const { ctx, page } = await newPage(browser);
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException('QuotaExceededError');
      };
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const warning = await page.locator('.storage-warning').count();
    const warningText = warning ? await page.locator('.storage-warning').textContent() : '';
    check('blocked storage shows a persistent warning', warning === 1, warningText?.trim().slice(0, 70));
    check('blocked storage is announced as an alert', (await page.locator('.storage-warning[role=alert]').count()) === 1);
    out.blockedStorage = { warning, warningText, errors: errors.slice(0, 3) };
    await ctx.close();
  }

  /* 3. Save line and no silent claim after a successful write. */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('.header-actions').getByRole('button', { name: /Add book/ }).click();
    await page.waitForTimeout(350);
    await page.locator('.segment', { hasText: 'By hand' }).click();
    await page.waitForTimeout(200);
    await page.fill('#mb-title', 'Persisted Book');
    await page.locator('.modal-panel').getByRole('button', { name: 'Add book', exact: true }).click();
    await page.waitForTimeout(400);
    const saved = await page.locator('.saved-line').count();
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('marginalia.journal.v1');
      const parsed = raw ? JSON.parse(raw) : null;
      return { books: parsed?.books?.length ?? 0, hasSample: (parsed?.books ?? []).some((b) => b.id.startsWith('demo-')) };
    });
    check('a successful write reports when it was saved', saved === 1);
    check('the new journal contains no sample books', !stored.hasSample, JSON.stringify(stored));
    out.saveLine = { saved, stored };
    await ctx.close();
  }

  /* 4. Modal completion: header Add book closes and opens the result. */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('.header-actions').getByRole('button', { name: /Add book/ }).click();
    await page.waitForTimeout(350);
    await page.locator('.segment', { hasText: 'By hand' }).click();
    await page.waitForTimeout(200);
    await page.fill('#mb-title', 'Header Book');
    await page.locator('.modal-panel').getByRole('button', { name: 'Add book', exact: true }).click();
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      modal: !!document.querySelector('.modal-panel'),
      title: document.querySelector('#book-title')?.textContent ?? null,
      overflow: document.body.style.overflow,
    }));
    check('header Add book closes its modal', !state.modal, JSON.stringify(state));
    check('header Add book opens the new book', state.title === 'Header Book', String(state.title));
    check('body scroll is restored after the modal closes', state.overflow === '', state.overflow);
    out.headerAdd = state;
    await ctx.close();
  }

  /* 5. Import: modal closes, toast reports, book opens. */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Import notes/ }).first().click();
    const html = '<html><body><h1>Imported Novel</h1><p>by Tester</p><p>1. Highlight (12%) A real highlight line.</p><p>2. Highlight (40%) A second real line.</p></body></html>';
    await page.locator('input[type=file]').setInputFiles({ name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from(html) });
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /^Import \d+ highlight/ }).click();
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
      modal: !!document.querySelector('.modal-panel'),
      overflow: document.body.style.overflow,
      toast: document.querySelector('.toast')?.textContent ?? null,
      title: document.querySelector('#book-title')?.textContent ?? null,
    }));
    check('import closes its modal', !state.modal, JSON.stringify(state));
    check('import reports what it did', !!state.toast && /Imported 2/.test(state.toast), String(state.toast));
    check('import opens the target book', state.title === 'Imported Novel', String(state.title));
    out.import = state;
    await ctx.close();
  }

  /* 6. Focus: returns to the opener, trap holds in both directions. */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const runs = [];
    for (const label of ['Add book', 'Your data and backups']) {
      // The data dialog opens from the header menu, so click through it.
      if (label === 'Your data and backups') {
        await page.getByRole('button', { name: 'Your data and backups' }).first().click();
        await page.waitForTimeout(150);
        await page.locator('.more-item').first().click();
      } else {
        const trigger = page.locator('.header-actions').getByRole('button', { name: label, exact: false }).first();
        await trigger.click();
      }
      await page.waitForTimeout(250);
      const opened = await page.evaluate(() => ({
        inModal: !!document.activeElement?.closest('.modal-panel'),
        id: document.activeElement?.id || document.activeElement?.tagName,
      }));
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(100);
      const afterShift = await page.evaluate(() => !!document.activeElement?.closest('.modal-panel'));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const returned = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        label:
          document.activeElement?.getAttribute('aria-label') ||
          (document.activeElement?.textContent || '').trim().slice(0, 24),
      }));
      runs.push({ label, opened, afterShift, returned });
      check(`"${label}" dialog focuses a field inside`, opened.inModal, JSON.stringify(opened));
      check(`"${label}" trap holds on Shift+Tab`, afterShift);
      check(`"${label}" returns focus to its trigger`, returned.tag === 'BUTTON' && !!returned.label, JSON.stringify(returned));
    }
    out.focus = runs;
    await ctx.close();
  }

  /* 7. Destructive actions: delete book confirms and removes; quote delete offers undo. */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem(
        'marginalia.journal.v1',
        JSON.stringify({
          version: 1,
          books: [
            { id: 'b1', title: 'Doomed Book', author: 'A', status: 'finished', currentPage: 10, genres: [], color: '#3f6f71', createdAt: 1 },
            { id: 'b2', title: 'Kept Book', author: 'B', status: 'reading', currentPage: 5, genres: [], color: '#5b6d8f', createdAt: 2 },
          ],
          quotes: [
            { id: 'q1', bookId: 'b1', text: 'A deletable passage.', createdAt: 1 },
            { id: 'q2', bookId: 'b1', text: 'A second passage.', createdAt: 2 },
          ],
        }),
      );
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Doomed Book' }).first().click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: /Delete book/ }).click();
    await page.waitForTimeout(250);
    const dialog = await page.evaluate(() => ({
      title: document.querySelector('[role=dialog] h2')?.textContent ?? null,
      mentionsQuotes: /2 quotes/.test(document.querySelector('[role=dialog]')?.textContent ?? ''),
    }));
    check('deleting a book asks first and names what goes with it', !!dialog.title && dialog.mentionsQuotes, JSON.stringify(dialog));
    await page.getByRole('button', { name: /Delete book and quotes/ }).click();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const raw = localStorage.getItem('marginalia.journal.v1');
      const parsed = raw ? JSON.parse(raw) : null;
      return { books: parsed?.books?.map((b) => b.title), quotes: parsed?.quotes?.length, toast: document.querySelector('.toast')?.textContent ?? null };
    });
    check('deleted book and its quotes are gone', !after.books.includes('Doomed Book') && after.quotes === 0, JSON.stringify(after));
    check('deleting a book reports it', !!after.toast && /Deleted/.test(after.toast), String(after.toast));

    // Quote delete + undo
    await page.getByRole('button', { name: 'Kept Book' }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /Add quote/ }).click();
    await page.fill('#q-text', 'An undoable passage.');
    await page.getByRole('button', { name: 'Save quote' }).click();
    await page.waitForTimeout(400);
    const quotesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('marginalia.journal.v1')).quotes.length);
    await page.locator('.quote-card').first().getByRole('button', { name: /Delete quote/ }).click();
    await page.waitForTimeout(300);
    const afterDelete = await page.evaluate(() => {
      const toasts = [...document.querySelectorAll('.toast')];
      const latest = toasts[toasts.length - 1];
      return {
        quotes: JSON.parse(localStorage.getItem('marginalia.journal.v1')).quotes.length,
        toast: latest?.textContent ?? null,
        undo: !!latest?.querySelector('.toast-action'),
        live: document.querySelectorAll('[aria-live]').length,
      };
    });
    check('quote delete removes the quote', afterDelete.quotes === quotesBefore - 1, JSON.stringify(afterDelete));
    check('quote delete offers undo', afterDelete.undo === true, JSON.stringify(afterDelete));
    check('quote delete is announced in a live region', afterDelete.live > 0);
    // Target the newest toast: the book-delete toast may still be visible.
    await page.locator('.toast .toast-action').last().click();
    await page.waitForTimeout(300);
    const afterUndo = await page.evaluate(() => JSON.parse(localStorage.getItem('marginalia.journal.v1')).quotes.length);
    check('undo restores the quote', afterUndo === quotesBefore, `before=${quotesBefore} afterUndo=${afterUndo}`);
    out.destructive = { dialog, after, afterDelete, afterUndo };
    await ctx.close();
  }

  /* 8. Copy feedback. */
  {
    const { ctx, page } = await newPage(browser);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => undefined },
        configurable: true,
      });
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem(
        'marginalia.journal.v1',
        JSON.stringify({
          version: 1,
          books: [{ id: 'b1', title: 'Copy Book', author: 'A', status: 'finished', currentPage: 1, genres: [], color: '#3f6f71', createdAt: 1 }],
          quotes: [{ id: 'q1', bookId: 'b1', text: 'A copyable passage.', createdAt: 1 }],
        }),
      );
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Copy Book' }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /Copy quote/ }).click();
    await page.waitForTimeout(300);
    const toast = await page.locator('.toast').textContent().catch(() => null);
    check('copy reports success', !!toast && /copied/i.test(toast), String(toast));
    out.copy = { toast };
    await ctx.close();
  }

  /* 9. First run: sample shelf is in-memory only; empty journal stays empty. */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const firstRun = await page.evaluate(() => ({
      cards: document.querySelectorAll('.book-card').length,
      banner: !!document.querySelector('.demo-banner'),
      sampleTags: document.querySelectorAll('.sample-tag').length,
      stored: (localStorage.getItem('marginalia.journal.v1') || '').length,
    }));
    check('first run shows the sample shelf with sample tags', firstRun.cards === 6 && firstRun.sampleTags > 0, JSON.stringify(firstRun));
    check('first run writes nothing to storage', firstRun.stored === 0, String(firstRun.stored));
    out.firstRun = firstRun;

    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx2.addInitScript(() => {
      localStorage.setItem('marginalia.journal.v1', JSON.stringify({ version: 1, books: [], quotes: [] }));
    });
    const page2 = await ctx2.newPage();
    await page2.goto(BASE, { waitUntil: 'networkidle' });
    const savedEmpty = await page2.evaluate(() => {
      const raw = localStorage.getItem('marginalia.journal.v1');
      return {
        cards: document.querySelectorAll('.book-card').length,
        empty: !!document.querySelector('.empty-state'),
        storedBooks: JSON.parse(raw).books.length,
      };
    });
    check('a saved empty journal stays empty', savedEmpty.cards === 0 && savedEmpty.empty && savedEmpty.storedBooks === 0, JSON.stringify(savedEmpty));
    out.savedEmpty = savedEmpty;
    await ctx2.close();
    await ctx.close();
  }

  /* 10. Mobile shell heights. */
  {
    const { ctx, page } = await newPage(browser, { viewport: { width: 390, height: 844 } });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const mobile = await page.evaluate(() => {
      const header = document.querySelector('.app-header');
      const r = header.getBoundingClientRect();
      const navRect = document.querySelector('.nav-list').getBoundingClientRect();
      return {
        headerH: Math.round(r.height),
        headerPosition: getComputedStyle(header).position,
        navH: Math.round(navRect.height),
        stickyPct: Math.round((r.height / window.innerHeight) * 100),
        addBtn: (() => { const b = document.querySelector('.header-actions .btn-primary'); const bb = b.getBoundingClientRect(); return { w: Math.round(bb.width), h: Math.round(bb.height) }; })(),
      };
    });
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(200);
    const scrolled = await page.evaluate(() => Math.round(document.querySelector('.app-header').getBoundingClientRect().top));
    check('mobile header is under 130px', mobile.headerH <= 130, JSON.stringify(mobile));
    check('mobile header scrolls away', mobile.headerPosition !== 'sticky' && scrolled <= 0, `pos=${mobile.headerPosition} top=${scrolled}`);
    out.mobile = { ...mobile, scrolled };
    await ctx.close();
  }

  /* 11. Long unbroken content does not break the page width. */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.setItem(
        'marginalia.journal.v1',
        JSON.stringify({
          version: 1,
          books: [{ id: 'b1', title: 'Long', author: 'A', status: 'finished', currentPage: 1, genres: [], color: '#3f6f71', createdAt: 1 }],
          quotes: [{ id: 'q1', bookId: 'b1', text: 'Supercalifragilisticexpialidocious'.repeat(8), createdAt: 1 }],
        }),
      );
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Quotes/ }).first().click();
    await page.waitForTimeout(300);
    const width = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
    check('a long unbroken quote does not widen the page', width.doc <= width.vw + 1, JSON.stringify(width));
    out.longQuote = width;
    await ctx.close();
  }

  /* 12. Contrast and touch targets. */
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const targets = await page.evaluate(() => {
      const small = [];
      document.querySelectorAll('button, a, select').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.height < 28) small.push({ text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), h: Math.round(r.height) });
      });
      const status = document.querySelector('.status-trigger');
      return { small: small.slice(0, 10), statusSize: status ? { h: Math.round(status.getBoundingClientRect().height), w: Math.round(status.getBoundingClientRect().width) } : null };
    });
    check('no control is shorter than 28px', targets.small.length === 0, JSON.stringify(targets.small));
    out.targets = targets;
    await ctx.close();
  }

  await browser.close();
  out.summary = { pass, fail, results };
  fs.writeFileSync(path.join('.review', 'verify-trust.json'), JSON.stringify(out, null, 2));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
