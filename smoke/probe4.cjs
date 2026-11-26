/* Probe 4: focus restoration, ARIA patterns, delete-book affordance, contrast targets in dark. */
const fs = require('fs');
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');
const BASE = 'http://127.0.0.1:4173/';
const out = {};

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  // 1) Open Data modal from header, check focus target and restore
  const opener = page.getByRole('button', { name: 'Data', exact: true }).first();
  await opener.click();
  await page.waitForTimeout(250);
  out.modalFocus = await page.evaluate(() => ({
    active: document.activeElement?.getAttribute('aria-label') || document.activeElement?.id || document.activeElement?.tagName,
    role: document.activeElement?.getAttribute('role'),
    firstTabStops: [...document.querySelectorAll('.modal-panel button, .modal-panel input')].slice(0, 3).map((b) => b.textContent.trim() || b.type),
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  out.focusRestore = await page.evaluate(() => ({
    activeText: document.activeElement?.textContent?.trim().slice(0, 30) || '',
    isBody: document.activeElement === document.body,
    tag: document.activeElement?.tagName,
  }));

  // 2) Tablist keyboard behaviour
  await page.waitForTimeout(100);
  await page.getByRole('tab', { name: /Reading/ }).first().focus();
  const before = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  out.tablist = {
    roleTablist: await page.locator('[role=tablist]').count(),
    roleTabpanel: await page.locator('[role=tabpanel]').count(),
    tabs: await page.locator('[role=tab]').count(),
    focusedBefore: before,
    focusedAfterArrow: await page.evaluate(() => document.activeElement?.textContent?.trim()),
    selectedCount: await page.locator('[role=tab][aria-selected=true]').count(),
  };

  // 3) Any way to delete a book from the UI?
  await page.getByRole('button', { name: 'Piranesi' }).first().click();
  await page.waitForTimeout(250);
  out.deleteBook = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
    return { hasDelete: btns.some((t) => /delete|remove|trash/i.test(t)), btns };
  });

  // 4) Dark mode: primary button + stars + dt contrast measured
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: /Back to library/ }).click();
  await page.waitForTimeout(300);
  out.darkTargets = await page.evaluate(() => {
    const el = document.querySelector('.btn-primary');
    const cs = getComputedStyle(el);
    return { label: el.textContent.trim(), color: cs.color, bg: cs.backgroundColor };
  });
  await page.emulateMedia({ colorScheme: 'light' });

  // 5) Data reset copy vs actual outcome
  await page.getByRole('button', { name: 'Data', exact: true }).first().click();
  await page.waitForTimeout(200);
  out.resetCopy = await page.evaluate(() => document.querySelector('.data-section:last-of-type')?.textContent?.trim().slice(0, 140));
  await page.getByRole('button', { name: /Clear all data/ }).click();
  await page.waitForTimeout(200);
  out.resetConfirm = await page.evaluate(() => document.querySelector('.confirm-box')?.textContent?.trim().slice(0, 160));
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await page.waitForTimeout(300);
  out.afterReset = await page.evaluate(() => ({
    message: document.querySelector('.data-message')?.textContent ?? null,
    bannerVisible: !!document.querySelector('.demo-banner'),
    cards: document.querySelectorAll('.book-card').length,
    stored: (localStorage.getItem('marginalia.journal.v1') || '').length,
  }));

  // 6) "Keep sample & start" then reload -> what data is in storage?
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.evaluate(() => localStorage.removeItem('marginalia.journal.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Keep sample & start/ }).click();
  await page.waitForTimeout(300);
  out.keepSample = await page.evaluate(() => {
    const raw = localStorage.getItem('marginalia.journal.v1');
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      stored: raw ? raw.length : 0,
      books: parsed?.books?.length ?? null,
      demoIds: parsed?.books ? parsed.books.filter((b) => b.id.startsWith('demo-')).length : null,
    };
  });

  // 7) Reduced motion + 200% zoom sanity
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 640, height: 800 });
  await page.evaluate(() => (document.documentElement.style.zoom = '200%'));
  await page.waitForTimeout(200);
  out.zoomed = await page.evaluate(() => ({ docWidth: document.documentElement.scrollWidth, vw: window.innerWidth }));
  await page.evaluate(() => (document.documentElement.style.zoom = ''));

  await browser.close();
  fs.writeFileSync('.review/probe4.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
