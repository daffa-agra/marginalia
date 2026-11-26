/* Reading plan: browser tests for the queue UI. */
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');

const BASE = 'http://127.0.0.1:4173/';
let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function book(id, title, overrides = {}) {
  return {
    id,
    title,
    author: 'Author ' + id,
    status: 'want-to-read',
    currentPage: 0,
    genres: [],
    color: '#3f6f71',
    createdAt: 1,
    ...overrides,
  };
}

async function fresh(browser, data) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((d) => localStorage.setItem('marginalia.journal.v1', JSON.stringify(d)), data);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { ctx, page, errors };
}

const sorted = (raw) =>
  raw.books
    .filter((b) => typeof b.queuePosition === 'number')
    .sort((a, b) => a.queuePosition - b.queuePosition)
    .map((b) => b.title);

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });

  /* --- Empty plan --- */
  {
    const { ctx, page, errors } = await fresh(browser, {
      version: 1,
      books: [book('b1', 'Unqueued')],
      quotes: [],
      shelves: [],
    });
    await page.getByRole('button', { name: /^Plan$/ }).click();
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      heading: document.querySelector('#library-title, #plan-title')?.textContent,
      empty: !!document.querySelector('.empty-state'),
    }));
    check('Plan view opens with an empty state', state.empty === true, JSON.stringify(state));
    check('no errors on the plan view', errors.length === 0, errors[0]);
    await ctx.close();
  }

  /* --- Queue from the library card --- */
  {
    const { ctx, page } = await fresh(browser, {
      version: 1,
      books: [book('b1', 'First Book'), book('b2', 'Second Book')],
      quotes: [],
      shelves: [],
    });
    await page.locator('.book-card', { hasText: 'First Book' }).locator('.queue-btn').click();
    await page.waitForTimeout(400);
    await page.locator('.book-card', { hasText: 'Second Book' }).locator('.queue-btn').click();
    await page.waitForTimeout(400);
    const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('marginalia.journal.v1')));
    const queue = sorted(raw);
    check('queuing from a card records order', JSON.stringify(queue) === JSON.stringify(['First Book', 'Second Book']), JSON.stringify(queue));

    const badges = await page.evaluate(() =>
      [...document.querySelectorAll('.queue-btn.queued')].map((b) => b.textContent.trim()),
    );
    check('queued cards show their position', badges.length === 2, JSON.stringify(badges));
    await ctx.close();
  }

  /* --- Plan view ordering and reorder --- */
  {
    const { ctx, page } = await fresh(browser, {
      version: 1,
      books: [
        book('a', 'Alpha', { queuePosition: 0 }),
        book('b', 'Beta', { queuePosition: 1 }),
        book('c', 'Gamma', { queuePosition: 2 }),
      ],
      quotes: [],
      shelves: [],
    });
    await page.getByRole('button', { name: /^Plan$/ }).click();
    await page.waitForTimeout(400);

    const order = await page.evaluate(() =>
      [...document.querySelectorAll('.plan-row-title')].map((b) => b.textContent.trim()),
    );
    check('queue renders in order', JSON.stringify(order) === JSON.stringify(['Alpha', 'Beta', 'Gamma']), JSON.stringify(order));

    const nextUp = await page.evaluate(() => document.querySelector('.plan-next-title')?.textContent?.trim());
    check('"Next up" shows the head of the queue', nextUp === 'Alpha', String(nextUp));

    // Move Gamma up one place.
    await page.locator('.plan-row', { hasText: 'Gamma' }).getByRole('button', { name: /Move Gamma up/ }).click();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('marginalia.journal.v1')));
    const reordered = sorted(after);
    check('moving an item up swaps it with its neighbour', JSON.stringify(reordered) === JSON.stringify(['Alpha', 'Gamma', 'Beta']), JSON.stringify(reordered));

    // Boundaries: first cannot go up, last cannot go down.
    const disabled = await page.evaluate(() => ({
      firstUp: document.querySelector('.plan-row .plan-row-actions button')?.disabled,
      lastDown: [...document.querySelectorAll('.plan-row')].pop()?.querySelectorAll('.plan-row-actions button')[1]?.disabled,
    }));
    check('move-up disabled on the first row', disabled.firstUp === true, JSON.stringify(disabled));
    check('move-down disabled on the last row', disabled.lastDown === true, JSON.stringify(disabled));
    await ctx.close();
  }

  /* --- Removing from the plan closes the gap --- */
  {
    const { ctx, page } = await fresh(browser, {
      version: 1,
      books: [
        book('a', 'Alpha', { queuePosition: 0 }),
        book('b', 'Beta', { queuePosition: 1 }),
        book('c', 'Gamma', { queuePosition: 2 }),
      ],
      quotes: [],
      shelves: [],
    });
    await page.getByRole('button', { name: /^Plan$/ }).click();
    await page.waitForTimeout(400);
    await page.locator('.plan-row', { hasText: 'Beta' }).getByRole('button', { name: /Remove Beta/ }).click();
    await page.waitForTimeout(500);
    const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('marginalia.journal.v1')));
    const remaining = sorted(raw);
    check('removing from the plan leaves no gap', JSON.stringify(remaining) === JSON.stringify(['Alpha', 'Gamma']), JSON.stringify(remaining));
    const positions = raw.books.filter((b) => typeof b.queuePosition === 'number').map((b) => b.queuePosition).sort();
    check('positions are contiguous from zero', JSON.stringify(positions) === JSON.stringify([0, 1]), JSON.stringify(positions));
    await ctx.close();
  }

  /* --- Start reading moves the book out of the queue --- */
  {
    const { ctx, page } = await fresh(browser, {
      version: 1,
      books: [book('a', 'Starter', { queuePosition: 0 }), book('b', 'Follower', { queuePosition: 1 })],
      quotes: [],
      shelves: [],
    });
    await page.getByRole('button', { name: /^Plan$/ }).click();
    await page.waitForTimeout(400);
    await page.locator('.plan-next').getByRole('button', { name: 'Start reading' }).click();
    await page.waitForTimeout(500);
    const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('marginalia.journal.v1')));
    const starter = raw.books.find((b) => b.title === 'Starter');
    check('starting a book sets it Reading', starter?.status === 'reading', JSON.stringify(starter?.status));
    check('starting a book stamps a start date', !!starter?.startedAt, String(starter?.startedAt));
    check('starting a book leaves the queue', starter?.queuePosition === undefined, JSON.stringify(starter?.queuePosition));
    const remaining = sorted(raw);
    check('the next book becomes the head', JSON.stringify(remaining) === JSON.stringify(['Follower']), JSON.stringify(remaining));
    await ctx.close();
  }

  /* --- Forecast appears once there is history --- */
  {
    const { ctx, page } = await fresh(browser, {
      version: 1,
      books: [
        book('f1', 'Done One', { status: 'finished', finishedAt: daysAgo(5) }),
        book('f2', 'Done Two', { status: 'finished', finishedAt: daysAgo(25) }),
        book('f3', 'Done Three', { status: 'finished', finishedAt: daysAgo(55) }),
        book('q1', 'Queued One', { queuePosition: 0 }),
        book('q2', 'Queued Two', { queuePosition: 1 }),
      ],
      quotes: [],
      shelves: [],
    });
    await page.getByRole('button', { name: /^Plan$/ }).click();
    await page.waitForTimeout(400);
    const forecast = await page.evaluate(() => ({
      text: document.querySelector('.plan-forecast')?.textContent ?? null,
      hasWeeks: /week/.test(document.querySelector('.plan-forecast')?.textContent ?? ''),
    }));
    check('forecast reports weeks to clear the queue', forecast.hasWeeks === true, (forecast.text ?? '').slice(0, 80));
    await ctx.close();
  }

  /* --- Forecast refuses to guess with thin history --- */
  {
    const { ctx, page } = await fresh(browser, {
      version: 1,
      books: [
        book('f1', 'Only One', { status: 'finished', finishedAt: daysAgo(5) }),
        book('q1', 'Queued', { queuePosition: 0 }),
      ],
      quotes: [],
      shelves: [],
    });
    await page.getByRole('button', { name: /^Plan$/ }).click();
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => document.querySelector('.plan-forecast')?.textContent ?? '');
    check('forecast declines to guess from one book', /Finish a few books/.test(text), text.slice(0, 80));
    await ctx.close();
  }

  /* --- Plan survives a reload --- */
  {
    const { ctx, page } = await fresh(browser, {
      version: 1,
      books: [book('a', 'Persisted', { queuePosition: 0 })],
      quotes: [],
      shelves: [],
    });
    await page.getByRole('button', { name: /^Plan$/ }).click();
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^Plan$/ }).click();
    await page.waitForTimeout(400);
    const title = await page.evaluate(() => document.querySelector('.plan-next-title')?.textContent?.trim());
    check('the plan survives a reload', title === 'Persisted', String(title));
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
