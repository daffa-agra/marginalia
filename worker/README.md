# Marginalia API

The Cloudflare Worker behind [Marginalia](https://books.daffagra.my.id). It does
three things, and deliberately no more:

| Endpoint | Purpose |
|---|---|
| `POST /api/hello` | Create-or-fetch the journal for a capability key. Idempotent. |
| `POST /api/sync` | Push local changes, receive remote ones. One endpoint, not twelve. |
| `POST /api/files/upload-url` | Sign a 5-minute R2 `PUT` for one EPUB. |
| `POST /api/files/read-url` | Sign a 5-minute R2 `GET` for one EPUB. |

**The Worker never touches book bytes.** Its free tier allows 10 ms of CPU per
request; a 5 MB body is orders of magnitude past that. So it signs a URL and gets
out of the way, and the browser talks to R2 directly.

## Access model

There is no login. The browser generates a 256-bit key on first run and sends it
as `X-Journal-Key`. The Worker stores only `SHA-256(key)` and compares in constant
time. No account, no email, no password — and the honest consequence: whoever
holds the key has access. It behaves like a bookmark URL, not a password. The key
is shown in Settings so it can be entered on a second device, and it can be
rotated.

Every query is scoped by the journal id resolved from that key. **No endpoint
takes a journal id from the request body.**

## Deploying

```bash
cd worker
npm install

# One-time: create the schema on the remote database.
npx wrangler d1 execute marginalia-v3 --remote --file=src/schema.sql

# Secrets (never committed).
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put JOURNAL_PEPPER        # optional but recommended

npx wrangler deploy
```

`wrangler.toml` binds:

- `DB` → D1 `marginalia-v3` (`a72e3d16-d133-492d-9145-120579b837f3`)
- `BOOKS` → R2 `marginalia-books`
- route `api.books.daffagra.my.id`

### Local development

```bash
cp .dev.vars.example .dev.vars   # fill in the R2 credentials
npx wrangler dev                 # http://127.0.0.1:8787
```

Then point the app at it by setting `window.__MARGINALIA_API_BASE__` (see
`src/lib/api.ts`) or by editing the default in that file.

## R2 layout

```
marginalia/{journalId}/books/{bookId}/{sha256}.epub
```

The content hash makes uploads idempotent: the same file uploaded from two
devices lands on one object. The bucket is **private**; the only way in is a
short-lived signed URL scoped to a single key, so a leaked URL cannot list the
bucket or read a different book.

## Sync semantics

The client is local-first: `localStorage` is the read/write path and this server
is a target. All the merge rules live in `src/sync.ts` and are mirrored in the
client's `src/lib/merge.ts`; both are unit-tested.

1. **Newer `updatedAt` wins.**
2. **A tombstone competes on the same field**, so a delete propagates and does
   not resurrect. Rows are never `DELETE`d for a tombstone — the row stays with
   `deleted_at` set, because that is how the delete reaches a device that has
   been offline.
3. **An identical-millisecond tie keeps the stored row and reports a conflict**,
   which the client surfaces rather than resolving silently. Two devices that
   wrote the *same* body have agreed, and no conflict is raised.

## Verifying

```bash
npx tsc --noEmit -p tsconfig.json   # types
node ../smoke/worker-tests.cjs      # 22 unit tests: keys, merge, rows, schema
```

The unit tests need no network and no D1 bindings, so they run in CI.

## What is not verified here

Deployment to the live account, and the D1/R2 round trip, cannot be exercised
from a unit test. `schema.sql` has been written against the design's DDL but has
not been applied to the remote database by this repository; run the one-time
`d1 execute` above before the first sync.

## Cost

Everything sits inside the free tier: 100k Worker requests/day, D1 5 GB,
R2 10 GB with zero egress. Free plans throttle rather than bill, so the realistic
failure at a limit is a feature that stops working, never an invoice.
