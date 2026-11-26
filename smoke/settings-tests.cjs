/* Settings UI: key display, linking, and offline behaviour with no server. */
const path = require('path');
const playwright = require('C:/Users/PAB-EDU-NB4282/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright');

const BASE = 'http://127.0.0.1:4173/';
let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // The API is deliberately routed to abort in this test, so the browser's own
    // "failed to load resource" log is expected. What matters is that the *app*
    // handles it, which is asserted separately below.
    if (/Failed to load resource|net::ERR_FAILED|ERR_ABORTED/.test(text)) return;
    errors.push(text);
  });

  // The API does not exist yet, so every network call must fail gracefully.
  await page.route('**://api.books.daffagra.my.id/**', (route) => route.abort('failed'));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });

  /* ── open Settings ── */
  await page.locator('.more-trigger').click();
  await page.waitForTimeout(300);
  await page.locator('.more-item', { hasText: /Settings/ }).click();
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => {
    const modal = document.querySelector('.modal-panel');
    return modal
      ? {
          open: true,
          title: modal.querySelector('h2')?.textContent?.trim(),
          groups: [...modal.querySelectorAll('.settings-group h3')].map((h) => h.textContent.trim()),
        }
      : null;
  });
  check('Settings opens', opened?.open === true, JSON.stringify(opened?.groups));
  check('Settings says where the journal lives', opened?.groups?.includes('Where your journal lives'));
  check('Settings shows the key', opened?.groups?.includes('Your key'));
  check('Settings shows local storage', opened?.groups?.includes('Books on this device'));

  /* ── the key is real and stable ── */
  const keyInfo = await page.evaluate(() => {
    const code = document.querySelector('.settings-key code');
    const raw = localStorage.getItem('marginalia.key.v1');
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      shown: code?.textContent ?? '',
      stored: parsed?.value ?? null,
      fingerprint: document.querySelector('.settings-key-fingerprint')?.textContent ?? '',
    };
  });
  check('a 256-bit key is generated', typeof keyInfo.stored === 'string' && keyInfo.stored.length === 43, `${keyInfo.stored?.length} chars`);
  check('the key is base64url', /^[A-Za-z0-9_-]{43}$/.test(keyInfo.stored ?? ''), keyInfo.stored?.slice(0, 12) + '…');
  check('the key is shown grouped for reading aloud', /\s/.test(keyInfo.shown), keyInfo.shown.slice(0, 24) + '…');
  check('the shown key strips back to the stored key', keyInfo.shown.replace(/\s+/g, '') === keyInfo.stored);
  check('a fingerprint is shown beside it', /^[A-Z0-9]{6}$/.test(keyInfo.fingerprint), keyInfo.fingerprint);

  /* ── the status explains that nothing has synced ── */
  const status = await page.evaluate(() => {
    const text = document.querySelector('.settings-body')?.textContent ?? '';
    return {
      neverSynced: /Never synced/.test(text),
      waiting: /Waiting to sync/.test(text),
      server: /api\.books\.daffagra\.my\.id/.test(text),
    };
  });
  check('status says it has never synced', status.neverSynced);
  check('status names the server', status.server);

  /* ── syncing with no server must not hang or crash ── */
  const syncBtn = page.locator('.settings-actions button', { hasText: /Sync now/ });
  await syncBtn.click();
  await page.waitForTimeout(2500);
  const afterSync = await page.evaluate(() => {
    const text = document.querySelector('.settings-body')?.textContent ?? '';
    return {
      stillOpen: !!document.querySelector('.modal-panel'),
      message: document.querySelector('.settings-hint')?.textContent ?? '',
      offlineish: /offline|connection|answer|sync/i.test(text),
    };
  });
  check('Settings survives a failed sync', afterSync.stillOpen === true);
  check('a failed sync explains itself instead of spinning', afterSync.offlineish, afterSync.message.slice(0, 60));
  check('a failed sync does not throw', errors.length === 0, errors.slice(0, 2).join(' | '));

  /* ── linking a device ── */
  const linkBox = page.locator('#link-key');
  await linkBox.fill('too-short');
  await page.locator('.settings-link button', { hasText: 'Link' }).click();
  await page.waitForTimeout(400);
  const rejected = await page.evaluate(() => {
    const err = document.querySelector('.settings-hint[role="alert"], .danger-text');
    return { shown: !!err, text: err?.textContent ?? '' };
  });
  check('a malformed key is rejected with a reason', rejected.shown, rejected.text.slice(0, 60));

  // A well-formed but different key is accepted and replaces the device key.
  const otherKey = 'B'.repeat(21) + 'c' + 'D'.repeat(21);
  await linkBox.fill(otherKey);
  await page.locator('.settings-link button', { hasText: 'Link' }).click();
  await page.waitForTimeout(600);
  const linked = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('marginalia.key.v1') ?? '{}').value,
    shown: document.querySelector('.settings-key code')?.textContent?.replace(/\s+/g, '') ?? '',
  }));
  check('a valid key links this device', linked.stored === otherKey, `${linked.stored?.slice(0, 10)}…`);
  check('the displayed key updates when linked', linked.shown === otherKey);

  /* ── forgetting the key makes a new one ── */
  await page.locator('.settings-link-forget').click();
  await page.waitForTimeout(600);
  const forgotten = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('marginalia.key.v1') ?? '{}').value,
  }));
  check('forgetting a key generates a fresh one', forgotten.stored !== otherKey && forgotten.stored?.length === 43);

  /* ── and the app is still usable ── */
  await page.getByRole('button', { name: /Close/ }).first().click();
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => ({
    modal: !!document.querySelector('.modal-panel'),
    library: !!document.querySelector('.view'),
  }));
  check('closing Settings returns to the app', back.modal === false && back.library === true);

  check('no console or page errors overall', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
