/* Final a11y + polish sweep on the rebuilt app. */
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
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Skip link actually moves focus now?
  await page.keyboard.press('Tab');
  out.skipFocused = await page.evaluate(() => document.activeElement?.className);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  out.skipAfter = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    id: document.activeElement?.id,
    hash: location.hash,
    mainTabIndex: document.querySelector('#main')?.getAttribute('tabindex'),
  }));

  // Inert while a modal is open
  await page.getByRole('button', { name: /Add book/ }).first().click();
  await page.waitForTimeout(250);
  out.inert = await page.evaluate(() => {
    const dialog = document.querySelector('[role=dialog]');
    const header = document.querySelector('.app-header');
    const main = document.querySelector('.app-main');
    return {
      headerInert: header?.hasAttribute('inert') ?? null,
      headerAriaHidden: header?.getAttribute('aria-hidden') ?? null,
      mainInert: main?.hasAttribute('inert') ?? null,
      toastRegionInert: document.querySelector('.toast-region')?.hasAttribute('inert') ?? null,
      dialogPresent: !!dialog,
    };
  });
  // Tab forward 30 times: nothing behind the dialog should take focus
  const escaped = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('.modal-panel'));
    if (!inside) escaped.push(await page.evaluate(() => document.activeElement?.tagName));
  }
  out.trapForward = { escapes: escaped.length, sample: escaped.slice(0, 3) };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  out.inertAfterClose = await page.evaluate(() => ({
    headerInert: document.querySelector('.app-header')?.hasAttribute('inert') ?? null,
    mainInert: document.querySelector('.app-main')?.hasAttribute('inert') ?? null,
    ariaHiddenLeft: document.querySelectorAll('[aria-hidden="true"]').length,
  }));

  // Heading outline per view
  const outlines = {};
  for (const [name, click] of [
    ['library', null],
    ['quotes', /Quotes/],
    ['stats', /Reading life/],
  ]) {
    if (click) {
      await page.getByRole('button', { name: click }).first().click();
      await page.waitForTimeout(200);
    }
    outlines[name] = await page.evaluate(() =>
      [...document.querySelectorAll('h1,h2,h3')].map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 34)}`),
    );
  }
  out.headings = outlines;

  // Sample shelf becomes real on first edit and drops the samples
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add book/ }).first().click();
  await page.fill('#bf-title', 'My Real Book');
  await page.getByRole('button', { name: 'Add book', exact: true }).last().click();
  await page.waitForTimeout(500);
  out.sampleAbsorb = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return {
      books: raw.books.length,
      titles: raw.books.map((b) => b.title),
      demoIds: raw.books.filter((b) => b.id.startsWith('demo-')).length,
    };
  });

  // Keep-the-samples path persists the samples deliberately
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Keep the samples/ }).click();
  await page.waitForTimeout(400);
  out.keepSamples = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return { books: raw.books.length, demoIds: raw.books.filter((b) => b.id.startsWith('demo-')).length };
  });

  // Reduced motion honoured
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  out.reducedMotion = await page.evaluate(() => {
    const el = document.querySelector('.book-card');
    return { transitionDuration: getComputedStyle(el).transitionDuration };
  });

  // Focus ring visible on keyboard nav
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  out.focusRing = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement);
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor };
  });

  await ctx.close();
  await browser.close();
  fs.writeFileSync('.review/final-sweep.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
