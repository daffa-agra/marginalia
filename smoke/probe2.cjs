/* Targeted probes for the Marginalia UX review. */
const fs = require('fs');
const path = require('path');
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const out = {};

async function run() {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // --- A. header geometry at widths
  out.header = {};
  for (const w of [1280, 900, 768, 640, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    out.header[w] = await page.evaluate(() => {
      const h = document.querySelector('.app-header').getBoundingClientRect();
      const main = document.querySelector('.app-main').getBoundingClientRect();
      const nav = document.querySelector('.nav-list').getBoundingClientRect();
      return {
        headerH: Math.round(h.height),
        mainTop: Math.round(main.top),
        navScrollW: document.querySelector('.nav-list').scrollWidth,
        navClientW: document.querySelector('.nav-list').clientWidth,
        headerBottom: Math.round(h.bottom),
      };
    });
  }

  // --- B. book-card advance-status label vs action
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  const sipCard = page.locator('.book-card', { hasText: 'The Sirens' });
  const label = await sipCard.locator('.book-card-foot button').nth(1).textContent();
  const statusBefore = await sipCard.locator('.status-chip').textContent();
  await sipCard.locator('.book-card-foot button').nth(1).click();
  await page.waitForTimeout(250);
  const statusAfter = await page.locator('.book-card', { hasText: 'The Sirens' }).locator('.status-chip').textContent();
  out.advance = { label: label.trim(), statusBefore: statusBefore.trim(), statusAfter: statusAfter.trim() };

  // --- C. is there any delete-book affordance?
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Piranesi' }).first().click();
  await page.waitForTimeout(250);
  out.bookDetail = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim());
    return {
      buttons,
      hasDelete: buttons.some((t) => /delete|remove|trash/i.test(t)),
      url: location.href,
      navCurrent: document.querySelectorAll('[aria-current]').length,
    };
  });
  // browser back behaviour from a book detail
  const beforeBack = page.url();
  await page.goBack().catch(() => {});
  await page.waitForTimeout(300);
  out.browserBack = { before: beforeBack, after: page.url(), bodyText: (await page.textContent('body')).slice(0, 80) };

  // --- D. import flow: modal close after open-book
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Import notes/ }).first().click();
  await page.waitForTimeout(300);
  const notes = '<html><body><h1>Test Import Book</h1><p>by Tester</p><p>1. Highlight (10%) A highlight line from the test file.</p></body></html>';
  const fileInput = page.locator('input[type=file]');
  await fileInput.setInputFiles({ name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from(notes) });
  await page.waitForTimeout(400);
  out.importReview = await page.evaluate(() => ({
    hasReview: !!document.querySelector('.import-target'),
    buttonLabels: [...document.querySelectorAll('.modal-panel button')].map((b) => b.textContent.trim()).filter(Boolean),
  }));
  await page.getByRole('button', { name: /^Import \d+ highlight/ }).click();
  await page.waitForTimeout(1400);
  out.importDone = await page.evaluate(() => ({
    modalStillOpen: !!document.querySelector('.modal-panel'),
    modalTitle: document.querySelector('.modal-panel h2')?.textContent ?? null,
    bookTitleOnPage: document.querySelector('#book-title')?.textContent ?? null,
    bodyOverflow: document.body.style.overflow,
  }));

  // --- E. quote delete: confirmation or undo?
  await page.evaluate(() => {
    localStorage.setItem('marginalia.journal.v1', JSON.stringify({
      version: 1,
      books: [{ id: 'b1', title: 'Quote Test', author: 'A', status: 'finished', currentPage: 10, genres: [], color: '#3f6f71', createdAt: 1 }],
      quotes: [
        { id: 'q1', bookId: 'b1', text: 'First passage to delete.', createdAt: 1 },
        { id: 'q2', bookId: 'b1', text: 'Second passage.', createdAt: 2 },
        { id: 'q3', bookId: 'b1', text: 'Third passage.', createdAt: 3 },
        { id: 'q4', bookId: 'b1', text: 'Fourth passage.', createdAt: 4 },
      ],
    }));
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Quote Test/ }).first().click();
  await page.waitForTimeout(250);
  const before = await page.locator('.quote-card').count();
  await page.locator('.quote-card').first().getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(300);
  out.quoteDelete = {
    before,
    after: await page.locator('.quote-card').count(),
    dialogs: await page.locator('[role=dialog]').count(),
    undoVisible: (await page.getByRole('button', { name: /undo/i }).count()) > 0,
    liveRegions: await page.locator('[role=status],[role=alert],[aria-live]').count(),
  };

  // copy feedback
  await page.locator('.quote-card').first().getByRole('button', { name: 'Copy' }).click();
  await page.waitForTimeout(300);
  out.copyFeedback = await page.evaluate(() => ({
    statusTexts: [...document.querySelectorAll('[role=status],[role=alert],[aria-live]')].map((e) => e.textContent.trim()),
  }));

  // --- F. demo banner: dismissable? overlapping content?
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  out.banner = await page.evaluate(() => {
    const b = document.querySelector('.demo-banner');
    const r = b.getBoundingClientRect();
    return {
      text: b.textContent.trim(),
      buttons: [...b.querySelectorAll('button')].map((x) => x.textContent.trim()),
      rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
      matchesFooter: document.querySelector('.app-footer').getBoundingClientRect().top < r.bottom,
    };
  });

  // --- G. empty state unreachable? seed saved-empty journal then reload
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('marginalia.journal.v1', JSON.stringify({ version: 1, books: [], quotes: [] }));
    }
  });
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  out.savedEmpty = await p2.evaluate(() => ({
    bookCards: document.querySelectorAll('.book-card').length,
    emptyState: !!document.querySelector('.empty-state'),
    banner: !!document.querySelector('.demo-banner'),
    stored: (localStorage.getItem('marginalia.journal.v1') || '').length,
  }));
  await ctx2.close();

  // --- H. long-content overflow culprit on detail
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p3 = await ctx3.newPage();
  await p3.addInitScript(() => {
    localStorage.setItem('marginalia.journal.v1', JSON.stringify({
      version: 1,
      books: [{
        id: 'stress-1',
        title: 'The Extraordinarily Long and Unabridged Title of a Book That Keeps Going and Going and Going Without Any Pause',
        author: 'Somebody Withanexceptionallylongunbrokenfamilyname-Bartholomew-Jones-Smythe',
        status: 'reading', totalPages: 9999, currentPage: 12,
        genres: ['Experimental fiction', 'Literary criticism', 'Postmodern', 'Translated'],
        color: '#5b6d8f', createdAt: Date.now(),
      }],
      quotes: [],
    }));
  });
  await p3.goto(BASE, { waitUntil: 'networkidle' });
  await p3.getByRole('button', { name: /The Extraordinarily/ }).first().click();
  await p3.waitForTimeout(300);
  out.overflow = await p3.evaluate(() => {
    const vw = window.innerWidth;
    const wide = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 1) {
        wide.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().slice(0, 50), right: Math.round(r.right), w: Math.round(r.width), scrollW: el.scrollWidth });
      }
    });
    return { docWidth: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 12) };
  });
  await ctx3.close();

  // --- I. stats with zero ratings → heading text
  const ctx4 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p4 = await ctx4.newPage();
  await p4.addInitScript(() => {
    localStorage.setItem('marginalia.journal.v1', JSON.stringify({
      version: 1,
      books: [{ id: 'b1', title: 'Unrated', author: 'A', status: 'finished', currentPage: 5, genres: [], color: '#3f6f71', createdAt: 1, finishedAt: '2026-01-02' }],
      quotes: [],
    }));
  });
  await p4.goto(BASE, { waitUntil: 'networkidle' });
  await p4.getByRole('button', { name: /Reading life/ }).first().click();
  await p4.waitForTimeout(200);
  out.statsNoRatings = await p4.evaluate(() => ({
    headings: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()),
    panels: [...document.querySelectorAll('.stats-panel')].map((p) => p.textContent.trim().slice(0, 90)),
  }));
  await ctx4.close();

  // --- J. quote count filter threshold + quotes view add button
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.getByRole('button', { name: /Quotes/ }).first().click();
  await page.waitForTimeout(300);
  out.quotesView = await page.evaluate(() => ({
    heading: document.querySelector('h1')?.textContent,
    buttons: [...document.querySelectorAll('.app-main button')].map((b) => b.textContent.trim()).filter(Boolean),
    filterInput: !!document.querySelector('#quote-filter'),
  }));

  await browser.close();
  fs.writeFileSync(path.join('.review', 'probe2.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
