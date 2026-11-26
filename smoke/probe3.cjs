/* Probe 3: modal typing/focus behaviour, mobile header stacking, overflow culprit, routing, status cycle. */
const fs = require('fs');
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');
const BASE = 'http://127.0.0.1:4173/';
const out = {};

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // 1) Typing into the Add book modal: does focus survive re-renders?
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add book/ }).first().click();
  await page.waitForTimeout(250);
  out.addBookPrefill = await page.evaluate(() => ({
    author: document.querySelector('#bf-author')?.value,
    title: document.querySelector('#bf-title')?.value,
    activeAtOpen: document.activeElement?.id || document.activeElement?.tagName,
    dialogLabel: document.querySelector('[role=dialog]')?.getAttribute('aria-label'),
  }));
  await page.click('#bf-title');
  await page.keyboard.type('Hello World', { delay: 40 });
  out.typing = await page.evaluate(() => ({
    value: document.querySelector('#bf-title')?.value,
    activeAfterTyping: document.activeElement?.id || document.activeElement?.tagName,
  }));
  // focus trap test: Tab from last field should wrap into modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  out.focusReturnAfterClose = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30));

  // 2) Status cycle across statuses via card button
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  out.advanceChain = [];
  for (let i = 0; i < 4; i++) {
    const card = page.locator('.book-card', { hasText: 'The Sirens' });
    const chip = (await card.locator('.status-chip').textContent()).trim();
    const btn = (await card.locator('.book-card-foot button').nth(1).textContent()).trim();
    out.advanceChain.push({ chip, button: btn });
    await card.locator('.book-card-foot button').nth(1).click();
    await page.waitForTimeout(200);
  }

  // 3) Global drag-and-drop: simulate dropping a file on the window (no modal open)
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(['<h1>Dropped Book</h1><p>1. Highlight (10%) dropped highlight</p>'], 'dropped.html', { type: 'text/html' }));
    return d;
  });
  const dropped = await page.evaluate((dataTransfer) => {
    let seen = false;
    document.addEventListener('drop', () => { seen = true; }, { once: true });
    document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
    return seen;
  }, dt);
  await page.waitForTimeout(500);
  out.globalDrop = await page.evaluate(() => ({
    dropSeen: false,
    modalTitle: document.querySelector('.modal-panel h2')?.textContent ?? null,
    hasParsedPreview: !!document.querySelector('.import-target'),
    dropzoneText: document.querySelector('.dropzone')?.textContent?.trim().slice(0, 60) ?? null,
  }));
  out.globalDrop.dropSeen = dropped;

  // 4) Mobile header stacking detail at 390
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  out.mobileHeader = await page.evaluate(() => {
    const rows = [...document.querySelector('.app-header').children].map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: String(el.className), top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
    });
    const btns = [...document.querySelectorAll('.header-actions .btn')].map((b) => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim(), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return {
      header: (() => { const r = document.querySelector('.app-header').getBoundingClientRect(); return { h: Math.round(r.height) }; })(),
      rows,
      btns,
      viewportH: window.innerHeight,
      stickyPct: Math.round((document.querySelector('.app-header').getBoundingClientRect().height / window.innerHeight) * 100),
    };
  });
  // scroll: does sticky header cover content?
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(300);
  out.mobileScroll = await page.evaluate(() => {
    const h = document.querySelector('.app-header').getBoundingClientRect();
    return { headerBottom: Math.round(h.bottom), scrollY: Math.round(window.scrollY) };
  });

  // 5) Quote view filter threshold (3 vs 4 quotes)
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    localStorage.setItem('marginalia.journal.v1', JSON.stringify({
      version: 1,
      books: [{ id: 'b1', title: 'Q', author: 'A', status: 'finished', currentPage: 1, genres: [], color: '#3f6f71', createdAt: 1 }],
      quotes: [1, 2, 3].map((i) => ({ id: 'q' + i, bookId: 'b1', text: 'passage ' + i, createdAt: i })),
    }));
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Quotes/ }).first().click();
  await page.waitForTimeout(200);
  out.quoteFilter3 = { filter: await page.locator('#quote-filter').count() };
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    raw.quotes.push({ id: 'q4', bookId: 'b1', text: 'passage 4', createdAt: 9 });
    localStorage.setItem('marginalia.journal.v1', JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Quotes/ }).first().click();
  await page.waitForTimeout(200);
  out.quoteFilter4 = { filter: await page.locator('#quote-filter').count() };

  // 6) Unbreakable long quote -> overflow culprit
  await page.evaluate(() => {
    localStorage.setItem('marginalia.journal.v1', JSON.stringify({
      version: 1,
      books: [{ id: 'b1', title: 'Long', author: 'A', status: 'finished', currentPage: 1, genres: [], color: '#3f6f71', createdAt: 1 }],
      quotes: [{ id: 'q1', bookId: 'b1', text: 'Supercalifragilisticexpialidocious'.repeat(6), createdAt: 1 }],
    }));
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Quotes/ }).first().click();
  await page.waitForTimeout(250);
  out.longQuote = await page.evaluate(() => {
    const vw = window.innerWidth;
    const wide = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.right > vw + 1) wide.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), right: Math.round(r.right), scrollW: el.scrollWidth });
    });
    const p = document.querySelector('.quote-text p');
    return {
      docWidth: document.documentElement.scrollWidth,
      vw,
      wide: wide.slice(0, 8),
      quoteScrollW: p?.scrollWidth,
      quoteClientW: p?.clientWidth,
      overflowWrap: p ? getComputedStyle(p).overflowWrap : null,
      wordBreak: p ? getComputedStyle(p).wordBreak : null,
    };
  });

  // 7) Routing: does the app have URL state / title per view?
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const titles = { library: await page.title() };
  await page.getByRole('button', { name: /Reading life/ }).first().click();
  await page.waitForTimeout(200);
  titles.stats = await page.title();
  titles.urlAfterNav = page.url();
  out.routing = { ...titles, historyLength: await page.evaluate(() => history.length) };

  // 8) Library duplicate primary action count
  await page.getByRole('button', { name: /Library/ }).first().click();
  await page.waitForTimeout(200);
  out.dupes = await page.evaluate(() => ({
    addBookButtons: [...document.querySelectorAll('button')].filter((b) => /Add book/i.test(b.textContent)).length,
    tabStopsPerCard: (() => {
      const card = document.querySelector('.book-card');
      return card ? card.querySelectorAll('button').length : 0;
    })(),
    cardCount: document.querySelectorAll('.book-card').length,
  }));

  await browser.close();
  fs.writeFileSync('.review/probe3.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
