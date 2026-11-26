/* Visual + runtime evidence capture for the Marginalia UI review.
 * Usage: node smoke/visual-review.cjs [outDir]
 * Requires: a Playwright install reachable from PLAYWRIGHT_PATH or the npx cache.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] || '.review');
fs.mkdirSync(OUT, { recursive: true });

const candidates = [
  process.env.PLAYWRIGHT_PATH,
  'C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright',
  'C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
].filter(Boolean);
let playwright;
for (const c of candidates) {
  try {
    playwright = require(c);
    break;
  } catch (e) {}
}
if (!playwright) throw new Error('playwright not found');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';

const consoleLog = [];
const measurements = {};

async function shot(page, name) {
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
}

async function auditPage(page, key) {
  const data = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal overflow offenders
    const overflow = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > vw + 1 || r.left < -1) {
        overflow.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : '',
          text: (el.textContent || '').trim().slice(0, 60),
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    });

    // Contrast sampling for visible text
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      let node = el;
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor || '');
        if (c && c.a > 0.9) return c;
        node = node.parentElement;
      }
      return { r: 246, g: 241, b: 231, a: 1 };
    };
    const contrast = [];
    const seen = new Set();
    document.querySelectorAll('body *').forEach((el) => {
      const style = getComputedStyle(el);
      if (!el.textContent || !el.textContent.trim()) return;
      if (el.children.length > 0 && [...el.children].some((c) => c.textContent.trim())) return;
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return;
      const fg = parse(style.color || '');
      if (!fg) return;
      const bg = bgOf(el);
      const l1 = lum(fg);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      const text = el.textContent.trim().slice(0, 40);
      const k = `${text}|${Math.round(ratio * 10)}`;
      if (seen.has(k)) return;
      seen.add(k);
      if (ratio < need) {
        contrast.push({
          text,
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : '',
          ratio: Math.round(ratio * 100) / 100,
          need,
          fontSize: size,
          color: style.color,
          bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
        });
      }
    });

    // Small touch targets on interactive elements
    const small = [];
    document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="tab"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.height < 32 || r.width < 32) {
        small.push({
          tag: el.tagName.toLowerCase(),
          text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    });

    // Heading outline
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
      level: Number(h.tagName[1]),
      text: h.textContent.trim().slice(0, 70),
    }));

    // Accessible names (rough): interactive elements with no text/aria-label/title
    const unnamed = [];
    document.querySelectorAll('button, a[href], [role="button"]').forEach((el) => {
      const name = (
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.textContent ||
        ''
      ).trim();
      if (!name) unnamed.push({ tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 120) });
    });

    return {
      viewport: { w: vw, h: vh },
      docWidth: document.documentElement.scrollWidth,
      horizontalOverflow: overflow.slice(0, 15),
      lowContrast: contrast.slice(0, 30),
      lowContrastCount: contrast.length,
      smallTargets: small.slice(0, 25),
      headings,
      unnamed,
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
  });
  measurements[key] = data;
}

async function main() {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleLog.push({ type: m.type(), text: m.text() });
  });
  page.on('pageerror', (e) => consoleLog.push({ type: 'pageerror', text: String(e) }));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page, '01-library-desktop');
  await auditPage(page, 'library-desktop');

  // Book detail (Piranesi)
  await page.getByRole('button', { name: 'Piranesi' }).first().click();
  await page.waitForTimeout(250);
  await shot(page, '02-book-detail');
  await auditPage(page, 'book-detail');
  await page.getByRole('button', { name: /Back to library/ }).click();
  await page.waitForTimeout(200);

  // Quotes
  await page.getByRole('button', { name: /Quotes/ }).first().click();
  await page.waitForTimeout(250);
  await shot(page, '03-quotes');
  await auditPage(page, 'quotes');

  // Stats
  await page.getByRole('button', { name: /Reading life/ }).first().click();
  await page.waitForTimeout(250);
  await shot(page, '04-stats');
  await auditPage(page, 'stats');

  // Add book modal
  await page.getByRole('button', { name: /Add book/ }).first().click();
  await page.waitForTimeout(300);
  await shot(page, '05-add-book-modal');
  await auditPage(page, 'add-book-modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Import modal
  await page.getByRole('button', { name: /Import notes/ }).first().click();
  await page.waitForTimeout(300);
  await shot(page, '06-import-modal');
  await auditPage(page, 'import-modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Data modal
  await page.getByRole('button', { name: 'Data', exact: true }).first().click();
  await page.waitForTimeout(300);
  await shot(page, '07-data-modal');
  await auditPage(page, 'data-modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Narrow widths on library
  await page.getByRole('button', { name: /Library/ }).first().click();
  for (const [w, h, key] of [
    [900, 900, 'library-900'],
    [768, 900, 'library-768'],
    [640, 900, 'library-640'],
    [390, 844, 'library-390'],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    await shot(page, `08-${key}`);
    await auditPage(page, key);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Piranesi' }).first().click();
  await page.waitForTimeout(250);
  await shot(page, '09-book-detail-390');
  await auditPage(page, 'book-detail-390');

  // Dark mode desktop
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: /Back to library/ }).click();
  await page.waitForTimeout(300);
  await shot(page, '10-library-dark');
  await auditPage(page, 'library-dark');
  await page.getByRole('button', { name: /Reading life/ }).first().click();
  await page.waitForTimeout(250);
  await shot(page, '11-stats-dark');
  await auditPage(page, 'stats-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // Empty first-run state: fresh profile, nothing saved, but sample data still shows.
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await context2.newPage();
  await page2.addInitScript(() => {
    window.localStorage.setItem(
      'marginalia.journal.v1',
      JSON.stringify({ version: 1, books: [], quotes: [] }),
    );
  });
  await page2.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page2, '12-empty-library');
  await auditPage(page2, 'empty-library');
  await page2.getByRole('button', { name: /Quotes/ }).first().click();
  await page2.waitForTimeout(200);
  await shot(page2, '13-empty-quotes');
  await page2.getByRole('button', { name: /Reading life/ }).first().click();
  await page2.waitForTimeout(200);
  await shot(page2, '14-empty-stats');

  // Keyboard pass: tab order on library
  await context2.close();
  await page.getByRole('button', { name: /Library/ }).first().click();
  await page.waitForTimeout(200);
  const tabOrder = [];
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    tabOrder.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 40),
          visibleOutline: getComputedStyle(el).outlineStyle,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
      }),
    );
  }
  const focusShot = await page.screenshot({ path: path.join(OUT, '15-focus-state.png') });
  measurements.tabOrder = tabOrder;

  // Long-content stress: very long title/author. Seed via localStorage.
  const context3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page3 = await context3.newPage();
  await page3.addInitScript(() => {
    const long =
      'The Extraordinarily Long and Unabridged Title of a Book That Keeps Going and Going and Going Without Any Pause';
    window.localStorage.setItem(
      'marginalia.journal.v1',
      JSON.stringify({
        version: 1,
        books: [
          {
            id: 'stress-1',
            title: long,
            author: 'Somebody Withanexceptionallylongunbrokenfamilyname-Bartholomew-Jones-Smythe',
            status: 'reading',
            totalPages: 9999,
            currentPage: 12,
            currentPageLabel: '',
            genres: ['Experimental fiction', 'Literary criticism', 'Postmodern', 'Translated'],
            color: '#5b6d8f',
            createdAt: Date.now(),
          },
          {
            id: 'stress-2',
            title: 'A',
            author: 'A',
            status: 'want-to-read',
            currentPage: 0,
            genres: [],
            color: '#3f6f71',
            createdAt: Date.now() - 1,
          },
        ],
        quotes: [
          {
            id: 'sq1',
            bookId: 'stress-1',
            text: 'Supercalifragilisticexpialidocious'.repeat(6),
            note: 'note '.repeat(40),
            createdAt: Date.now(),
          },
        ],
      }),
    );
  });
  await page3.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page3, '16-stress-library');
  await auditPage(page3, 'stress-library');
  await page3.getByRole('button', { name: /The Extraordinarily/ }).first().click();
  await page3.waitForTimeout(250);
  await shot(page3, '17-stress-detail');
  await auditPage(page3, 'stress-detail');
  await context3.close();

  fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(measurements, null, 2));
  fs.writeFileSync(path.join(OUT, 'console.json'), JSON.stringify(consoleLog, null, 2));
  console.log('captured', Object.keys(measurements).length, 'states to', OUT);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
