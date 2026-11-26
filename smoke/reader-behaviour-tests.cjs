/*
 * Browser tests: how the reader behaves, anchored to the conventions of
 * established EPUB readers (Readest/foliate, Apple Books).
 *
 * These exist because the failures they check are invisible to a unit test and
 * silent to a reader: a page can be one pixel out of alignment, or a font change
 * can quietly throw away your place, without anything throwing.
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

const label = (page) => page.evaluate(() => document.querySelector('.reader-chapter')?.textContent ?? '');

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

/**
 * Counts text fragments that sit partly outside the visible page.
 *
 * This is the check that catches column drift: when the translate stride
 * disagrees with the rendered column pitch, each page shows a widening sliver of
 * its neighbour, and eventually no text at all.
 */
async function clippedFragments(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.reader-frame');
    const doc = frame.contentDocument;
    const fr = frame.getBoundingClientRect();
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let clipped = 0;
    let inside = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width < 1) continue;
        if (!(rect.right > fr.left + 1 && rect.left < fr.right - 1)) continue;
        if (rect.left >= fr.left - 1 && rect.right <= fr.right + 1) inside += 1;
        else clipped += 1;
      }
    }
    return { clipped, inside };
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

  /* --- page geometry: the stride is exactly one page --- */
  const geometry = await page.evaluate(() => {
    const frame = document.querySelector('.reader-frame');
    const doc = frame.contentDocument;
    const body = doc.body;
    const cs = doc.defaultView.getComputedStyle(body);
    // How many columns the page currently holds, from the CSS the paginator set.
    const columns = Math.max(1, Math.round(doc.documentElement.clientWidth / parseFloat(cs.columnWidth)));
    return {
      rootWidth: doc.documentElement.clientWidth,
      rootHeight: doc.documentElement.clientHeight,
      frameWidth: frame.clientWidth,
      frameHeight: frame.clientHeight,
      columnWidth: parseFloat(cs.columnWidth),
      columns,
      columnGap: parseFloat(cs.columnGap),
      bodyHeight: parseFloat(cs.height),
      bodyPadding: [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)],
    };
  });
  // The container must have no padding: padding would shrink the box the
  // columns are measured from while the stride stayed the page width, which is
  // exactly the drift this suite exists to catch.
  check(
    'the column container has no padding of its own',
    geometry.bodyPadding[0] === 0 && geometry.bodyPadding[1] === 0,
    `padding ${geometry.bodyPadding.join('/')}px`,
  );
  check(
    'the columns divide the page exactly',
    Math.abs(geometry.columnWidth * geometry.columns - geometry.rootWidth) < 1,
    `${geometry.columns} × ${geometry.columnWidth}px = ${geometry.rootWidth}px`,
  );
  check(
    'the column strip is exactly one page tall',
    Math.abs(geometry.bodyHeight - geometry.frameHeight) < 2,
    `${geometry.bodyHeight}px vs ${geometry.frameHeight}px`,
  );
  check('columns are contiguous, so the pitch equals the stride', geometry.columnGap === 0, `gap ${geometry.columnGap}px`);

  /* --- every page is fully on-screen, at every page --- */
  const pageCount = Number(/of (\d+)$/.exec(await label(page))?.[1] ?? 0);
  const health = [];
  for (let i = 0; i < pageCount; i++) {
    health.push({ page: i + 1, ...(await clippedFragments(page)) });
    if (i < pageCount - 1) {
      await page.getByRole('button', { name: 'Next page' }).click();
      await page.waitForTimeout(300);
    }
  }
  check(
    'no page shows text clipped outside the frame',
    health.every((h) => h.clipped === 0),
    health.map((h) => `p${h.page}:${h.clipped}`).join(' '),
  );
  check(
    'every page shows whole text',
    health.every((h) => h.inside > 0),
    health.map((h) => h.inside).join(','),
  );

  /* --- reflow holds the reader's place --- */
  const beforeReflow = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return raw.books[0].position;
  });
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.waitForTimeout(400);
  const fontSlider = page.locator('.reader-settings input[aria-label="Font size"]');
  await fontSlider.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '26');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1800);
  const afterReflow = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('marginalia.journal.v1'));
    return raw.books[0].position;
  });
  check(
    'a font change keeps the text fraction, not the page number',
    Math.abs((afterReflow?.fraction ?? 0) - (beforeReflow?.fraction ?? 0)) < 0.05,
    `${beforeReflow?.fraction?.toFixed(3)} → ${afterReflow?.fraction?.toFixed(3)}`,
  );
  const afterReflowLabel = await label(page);
  check(
    'a font change does not throw the reader back to page one',
    !/page 1 of/.test(afterReflowLabel) || /page 1 of/.test(afterReflowLabel) === (beforeReflow?.fraction ?? 0) < 0.01,
    afterReflowLabel,
  );

  /* --- columns are a real setting --- */
  await fontSlider.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '18');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'One', exact: true }).click();
  await page.waitForTimeout(1500);
  const one = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    return parseFloat(doc.defaultView.getComputedStyle(doc.body).columnWidth);
  });
  await page.getByRole('button', { name: 'Two', exact: true }).click();
  await page.waitForTimeout(1500);
  const two = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    const style = doc.defaultView.getComputedStyle(doc.body);
    return { columnWidth: parseFloat(style.columnWidth), root: doc.documentElement.clientWidth };
  });
  check('one column spans the page', Math.abs(one - two.root) < 2, `${one}px of ${two.root}px`);
  check('two columns halve the page', Math.abs(two.columnWidth - two.root / 2) < 2, `${two.columnWidth}px of ${two.root}px`);
  // Back to one column for the navigation tests, so a turn is a whole page.
  await page.getByRole('button', { name: 'One', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.waitForTimeout(500);

  /* --- tap zones --- */
  const stage = await page.locator('.reader-stage').boundingBox();
  const beforeTap = await label(page);
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
  await page.waitForTimeout(500);
  check(
    'a centre tap toggles the chrome instead of turning the page',
    (await label(page)) === beforeTap &&
      (await page.evaluate(() => !document.querySelector('.reader.chrome-visible'))),
    await label(page),
  );
  await page.mouse.click(stage.x + stage.width * 0.88, stage.y + stage.height * 0.5);
  await page.waitForTimeout(600);
  check('a tap on the right turns forward', (await label(page)) !== beforeTap, await label(page));
  await page.mouse.click(stage.x + stage.width * 0.12, stage.y + stage.height * 0.5);
  await page.waitForTimeout(600);
  check('a tap on the left turns back', (await label(page)) === beforeTap, await label(page));
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
  await page.waitForTimeout(500);
  check(
    'a centre tap brings the chrome back',
    await page.evaluate(() => !!document.querySelector('.reader.chrome-visible')),
    '',
  );

  /* --- chrome overlays the page instead of shrinking it --- */
  const chrome = await page.evaluate(() => {
    const stageEl = document.querySelector('.reader-stage');
    const bar = document.querySelector('.reader-bar');
    return {
      stageHeight: stageEl.getBoundingClientRect().height,
      viewport: window.innerHeight,
      barPosition: getComputedStyle(bar).position,
      barTop: bar.getBoundingClientRect().top,
      stageTop: stageEl.getBoundingClientRect().top,
    };
  });
  check(
    'the page fills the window while the chrome is up',
    Math.abs(chrome.stageHeight - chrome.viewport) < 2,
    `${chrome.stageHeight}px of ${chrome.viewport}px`,
  );
  check('the chrome is an overlay, not a layout row', chrome.barPosition === 'absolute', chrome.barPosition);
  check('the chrome sits over the page, not above it', Math.abs(chrome.barTop - chrome.stageTop) < 2, `${chrome.barTop} vs ${chrome.stageTop}`);

  /* --- the wheel turns pages --- */
  const beforeWheel = await label(page);
  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(700);
  check('the mouse wheel turns a page', (await label(page)) !== beforeWheel, `${beforeWheel} → ${await label(page)}`);

  /* --- an internal link is navigated by the reader, not the frame --- */
  let guard = 0;
  while (guard < 40) {
    const current = await label(page);
    const m = /page (\d+) of (\d+)/.exec(current);
    if (m && Number(m[1]) === Number(m[2])) break;
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForTimeout(200);
    guard += 1;
  }
  const link = await page.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    const anchor = [...doc.querySelectorAll('a')].find((a) => /Next chapter/.test(a.textContent));
    if (!anchor) return null;
    const r = anchor.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
  });
  check('the chapter link is present to click', Boolean(link && link.w > 0), JSON.stringify(link));
  if (link && link.w > 0) {
    await page.mouse.click(stage.x + link.x, stage.y + link.y);
    await page.waitForTimeout(1800);
    const after = await label(page);
    const frame = await page.evaluate(() => {
      const doc = document.querySelector('.reader-frame').contentDocument;
      return { url: doc.URL, text: doc.body.innerText.length };
    });
    check('an internal link moves to that chapter', /2 of 6/.test(after), after);
    check('the frame keeps showing the book instead of navigating away', frame.text > 0, `${frame.url} · ${frame.text} chars`);
  }

  /* --- reduced motion is honoured --- */
  await ctx.addInitScript(() => {});
  const otherCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const reducedPage = await otherCtx.newPage();
  await reducedPage.goto(BASE, { waitUntil: 'networkidle' });
  await openReader(reducedPage);
  const transition = await reducedPage.evaluate(() => {
    const doc = document.querySelector('.reader-frame').contentDocument;
    return doc.body.style.transition;
  });
  check('reduced motion removes the page-turn animation', transition === 'none', transition || '(unset)');
  await otherCtx.close();

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
