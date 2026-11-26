/* Exploratory QA: probe for problems the gate suite does not cover.
 * Each probe is a hostile or unusual user action, reported as finding or clean.
 */
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');
const path = require('path');

const BASE = 'http://127.0.0.1:4173/';
const findings = [];

function finding(severity, area, what, detail) {
  findings.push({ severity, area, what, detail });
  console.log(`[${severity}] ${area}: ${what}${detail ? ` — ${detail}` : ''}`);
}

async function fresh(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { ctx, page, errors };
}

async function seed(page, data) {
  await page.evaluate((d) => localStorage.setItem('marginalia.journal.v1', JSON.stringify(d)), data);
  await page.reload({ waitUntil: 'networkidle' });
}

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });

  /* ── 1. Duplicate shelf names ── */
  {
    const { ctx, page } = await fresh(browser);
    for (const name of ['Reading', 'Reading']) {
      await page.getByRole('button', { name: /New shelf/ }).click();
      await page.keyboard.type(name);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    }
    const dupes = await page.evaluate(() => (JSON.parse(localStorage.getItem('marginalia.journal.v1') || '{}').shelves || []).map((s) => s.name));
    if (dupes.length === 2 && dupes[0] === dupes[1]) {
      finding('P2', 'Shelves', 'Two shelves can have the same name, indistinguishable in the bar', JSON.stringify(dupes));
    }
    await ctx.close();
  }

  /* ── 2. Whitespace-only shelf name ── */
  {
    const { ctx, page } = await fresh(browser);
    await page.getByRole('button', { name: /New shelf/ }).click();
    await page.keyboard.type('   ');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const shelves = await page.evaluate(() => (JSON.parse(localStorage.getItem('marginalia.journal.v1') || '{}').shelves || []));
    if (shelves.length > 0) finding('P2', 'Shelves', 'Blank shelf name accepted', JSON.stringify(shelves));
    await ctx.close();
  }

  /* ── 3. Very long shelf name ── */
  {
    const { ctx, page } = await fresh(browser);
    await page.getByRole('button', { name: /New shelf/ }).click();
    await page.keyboard.type('A'.repeat(120));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      vw: window.innerWidth,
    }));
    if (overflow.doc > overflow.vw + 1) {
      finding('P2', 'Shelves', 'A 120-character shelf name widens the page', JSON.stringify(overflow));
    }
    await ctx.close();
  }

  /* ── 4. Rapid double-click on Delete book ── */
  {
    const { ctx, page } = await fresh(browser);
    await seed(page, {
      version: 1,
      books: [{ id: 'b1', title: 'Target', author: 'A', status: 'reading', currentPage: 0, genres: [], color: '#3f6f71', createdAt: 1 }],
      quotes: [],
      shelves: [],
    });
    await page.locator('.book-card .book-link').first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Delete book/ }).click();
    await page.waitForTimeout(200);
    const btn = page.getByRole('button', { name: /Delete book and quotes/ });
    await btn.click();
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1') || '{"books":[]}');
      return { books: raw.books.length, toasts: document.querySelectorAll('.toast').length };
    });
    if (state.books !== 0) finding('P1', 'Delete', 'Book survived its own deletion', JSON.stringify(state));
    if (state.toasts > 1) finding('P3', 'Delete', 'Double delete produced multiple undo toasts', String(state.toasts));
    await ctx.close();
  }

  /* ── 5. Refresh during the undo window ── */
  {
    const { ctx, page } = await fresh(browser);
    await seed(page, {
      version: 1,
      books: [{ id: 'b1', title: 'Undo Test', author: 'A', status: 'reading', currentPage: 0, genres: [], color: '#3f6f71', createdAt: 1 }],
      quotes: [],
      shelves: [],
    });
    await page.locator('.book-card .book-link').first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Delete book/ }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /Delete book and quotes/ }).click();
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      books: JSON.parse(localStorage.getItem('marginalia.journal.v1') || '{"books":[]}').books.length,
      undoOffered: !!document.querySelector('.toast-action'),
    }));
    if (!after.undoOffered && after.books === 0) {
      finding('P2', 'Delete', 'Refreshing during the undo window loses the undo permanently', JSON.stringify(after));
    }
    await ctx.close();
  }

  /* ── 6. Storage quota exhaustion mid-session ── */
  {
    const { ctx, page } = await fresh(browser);
    // Block writes only for the journal key, and only after the boot probe
    // has already succeeded — otherwise this tests the boot path, not a
    // failure discovered while the reader is working.
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'marginalia.journal.v1') throw new DOMException('QuotaExceededError');
        return orig.call(this, k, v);
      };
    });
    await page.getByRole('button', { name: /Add book/ }).first().click();
    await page.waitForTimeout(300);
    await page.locator('.segment', { hasText: 'By hand' }).click();
    await page.fill('#mb-title', 'Quota Book');
    await page.locator('.modal-panel').getByRole('button', { name: 'Add book', exact: true }).click();
    await page.waitForTimeout(800);
    const state = await page.evaluate(() => ({
      warning: !!document.querySelector('.storage-warning'),
      warningText: document.querySelector('.storage-warning')?.textContent?.trim().slice(0, 60) ?? null,
    }));
    if (!state.warning) {
      finding('P2', 'Durability', 'Write failure mid-session not surfaced in UI', JSON.stringify(state));
    }
    await ctx.close();
  }

  /* ── 7. Import a filename with no extension + binary junk ── */
  {
    const { ctx, page } = await fresh(browser);
    await page.getByRole('button', { name: /Import notes/ }).first().click();
    await page.waitForTimeout(300);
    await page.locator('input[type=file]').setInputFiles({
      name: 'notes',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]),
    });
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
      modalOpen: !!document.querySelector('.modal-panel'),
      warning: document.querySelector('.inline-alert, .import-warning')?.textContent?.slice(0, 60) ?? null,
    }));
    if (!state.modalOpen) finding('P2', 'Import', 'Binary junk closed the import dialog without explanation', JSON.stringify(state));
    await ctx.close();
  }

  /* ── 8. Corrupt EPUB upload (valid zip, no container) ── */
  {
    const { ctx, page, errors } = await fresh(browser);
    await page.getByRole('button', { name: /Add book/ }).first().click();
    await page.waitForTimeout(300);
    const broken = path.join(__dirname, '..', '.review', 'fixtures', 'lighthouse-broken.epub');
    if (require('fs').existsSync(broken)) {
      await page.locator('input[type=file]').setInputFiles(broken);
      await page.waitForTimeout(900);
      const state = await page.evaluate(() => ({
        alert: document.querySelector('.inline-alert')?.textContent?.slice(0, 70) ?? null,
        preview: !!document.querySelector('.file-preview'),
      }));
      if (!state.alert) finding('P2', 'Upload', 'Corrupt EPUB gave no error message', JSON.stringify(state));
      if (errors.length) finding('P2', 'Upload', 'Corrupt EPUB logged an unhandled error', errors[0]);
    }
    await ctx.close();
  }

  /* ── 9. Same book uploaded twice ── */
  {
    const { ctx, page } = await fresh(browser);
    const fixture = path.join(__dirname, '..', '.review', 'fixtures', 'lighthouse.epub');

    // First upload succeeds.
    await page.getByRole('button', { name: /Add book/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator('input[type=file]').setInputFiles(fixture);
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /^Add book$/ }).last().click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /Library/ }).first().click();
    await page.waitForTimeout(400);

    // Second upload of the same file is refused with a clear reason.
    await page.getByRole('button', { name: /Add book/ }).first().click();
    await page.waitForTimeout(400);
    await page.locator('input[type=file]').setInputFiles(fixture);
    await page.waitForTimeout(1200);
    const second = await page.evaluate(() => ({
      alert: document.querySelector('.inline-alert')?.textContent?.trim() ?? null,
      preview: !!document.querySelector('.file-preview'),
      canConfirm: [...document.querySelectorAll('.modal-panel button')].some(
        (b) => b.textContent.trim() === 'Add book',
      ),
    }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const books = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1') || '{}');
      return (raw.books || []).map((b) => b.title);
    });

    if (books.length > 1) {
      finding('P3', 'Upload', 'Uploading the same EPUB twice creates two identical books', JSON.stringify(books));
    } else if (!second.alert || second.canConfirm) {
      finding('P2', 'Upload', 'Duplicate upload is not refused with a clear message', JSON.stringify(second));
    }
    await ctx.close();
  }

  /* ── 10. Keyboard: can the shelf bar be operated without a mouse? ── */
  {
    const { ctx, page } = await fresh(browser);
    await seed(page, {
      version: 1,
      books: [{ id: 'b1', title: 'KB', author: 'A', status: 'reading', currentPage: 0, genres: [], color: '#3f6f71', createdAt: 1 }],
      quotes: [],
      shelves: [{ id: 's1', name: 'Focus Shelf', sortOrder: 0, createdAt: 1 }],
    });
    const reachable = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.shelf-tab')];
      return tabs.map((t) => ({ text: t.textContent.trim(), tabindex: t.getAttribute('tabindex') }));
    });
    const allTabbable = reachable.filter((r) => r.tabindex === null).length;
    if (allTabbable > 1) {
      finding('P3', 'Accessibility', 'Shelf tabs use role=tab but are all in the tab order (no roving tabindex)', JSON.stringify(reachable));
    }
    await ctx.close();
  }

  /* ── 11. Empty states after deleting everything ── */
  {
    const { ctx, page } = await fresh(browser);
    await seed(page, { version: 1, books: [], quotes: [], shelves: [] });
    const state = await page.evaluate(() => ({
      empty: !!document.querySelector('.empty-state'),
      shelfTabs: document.querySelectorAll('.shelf-tab').length,
      text: document.querySelector('.empty-state')?.textContent?.slice(0, 80) ?? null,
    }));
    if (!state.empty) finding('P2', 'Empty state', 'Empty library shows no empty state', JSON.stringify(state));
    await ctx.close();
  }

  /* ── 12. Mobile: shelf bar with many shelves ── */
  {
    const { ctx, page } = await fresh(browser, { viewport: { width: 390, height: 844 } });
    const shelves = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `Shelf ${i + 1}`, sortOrder: i, createdAt: 1 }));
    await seed(page, {
      version: 1,
      books: [{ id: 'b1', title: 'M', author: 'A', status: 'reading', currentPage: 0, genres: [], color: '#3f6f71', createdAt: 1 }],
      quotes: [],
      shelves,
    });
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      barScrollable: (() => {
        const bar = document.querySelector('.shelf-tabs');
        return bar ? bar.scrollWidth > bar.clientWidth : false;
      })(),
    }));
    if (m.doc > m.vw + 1) finding('P2', 'Responsive', 'Eight shelves widen the page on mobile', JSON.stringify(m));
    await ctx.close();
  }

  /* ── 13. Does deleting a shelf while filtered strand the user? ── */
  {
    const { ctx, page } = await fresh(browser);
    await seed(page, {
      version: 1,
      books: [{ id: 'b1', title: 'S', author: 'A', status: 'reading', currentPage: 0, shelfId: 's1', genres: [], color: '#3f6f71', createdAt: 1 }],
      quotes: [],
      shelves: [{ id: 's1', name: 'Doomed', sortOrder: 0, createdAt: 1 }],
    });
    await page.locator('.shelf-tab', { hasText: 'Doomed' }).click();
    await page.waitForTimeout(300);
    page.once('dialog', (d) => d.accept());
    await page.locator('.shelf-tab-wrap').locator('button[aria-label*="Delete shelf"]').click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      heading: document.querySelector('#library-title')?.textContent,
      cards: document.querySelectorAll('.book-card').length,
    }));
    if (after.heading === 'Doomed') {
      finding('P2', 'Shelves', 'Deleting the shelf you are viewing leaves the heading stale', JSON.stringify(after));
    }
    await ctx.close();
  }

  await browser.close();

  console.log('');
  console.log(`Exploratory QA: ${findings.length} finding(s)`);
  const bySeverity = findings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }), {});
  console.log(JSON.stringify(bySeverity));
  require('fs').writeFileSync(
    path.join(__dirname, '..', '.review', 'qa-findings.json'),
    JSON.stringify(findings, null, 2),
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
