# Marginalia

A personal book journal and EPUB reader — your shelves, notes in the margins, and reading life, kept in your browser.

## What it does today

- **Read EPUBs** — open a DRM-free EPUB and read it **paginated**: chapters in spine order, a table of contents from the book's own nav, embedded images and the book's stylesheet preserved, and a reading position that survives a reload, a font-size change and a repagination. Book content renders in a sandboxed frame with scripts disabled.
- **Reader that behaves like a reader** — tap the right or left of the page to turn it and the middle to hide the controls, swipe or scroll the wheel to turn, arrow keys / `Home` / `End` / `T` for the contents. The header and footer *overlay* the page, so hiding them never reflows the text. Links inside the book are handled by the reader, so a chapter link navigates instead of replacing the page. Page turns respect `prefers-reduced-motion`.
- **Notes in the margins** — select a passage and a small toolbar appears over it: **Note**, **Quote**, **Copy**. A note opens a composer in the margin, beside the page rather than over it. The passage is highlighted, and clicking a highlight re-opens its note for editing. Anchored to the text, not to a page, so a note stays on the same sentence through a font change, a resize and a reload.
- **Reader typography** — per-book settings with a global default: font size, line length, line height, letter/word/paragraph spacing, alignment, hyphenation, margins, a writing margin for notes, column count, and paper/sepia/night themes. A "preserve the book" mode keeps the publisher's own fonts and layout; "my page" overrides them. One button applies WCAG 1.4.12 text spacing.
- **Reading plan** — queue the books you mean to read next, in order. Undated by design: it says which book is next, not when to read it. The page reports your measured pace and when the queue would empty at that pace.
- **Shelves** — group books the way you think of them (*Bedside*, *Research*, *Re-read someday*). **One book, one shelf**, like folders: shelf counts always add up to your library. Unshelved is always there, and deleting a shelf moves its books rather than deleting them.
- **EPUB upload** — drop a DRM-free EPUB and the title, author, language, publisher, cover and chapter count are read from the book itself. Or add a book by hand as metadata only.
- **Library** — track every book through *Want to read → Reading → Finished* (or *Abandoned*), with progress, ratings, reviews, genres, series and dates.
- **Quotes & notes** — collect passages with your own annotations; masonry layout, filter, search, edit, copy.
- **Reading life** — books finished per month, pages read, genres, average rating, and your top shelf.
- **Play Books import** — drop in the notes file exported from Google Play Books, preview it, and attach highlights to books — with duplicate protection.
- **Undo and honest feedback** — deleting a book or a quote can be undone; failed saves surface immediately instead of silently losing work.
- **Your data, exported** — full JSON backups, Markdown journals and CSVs, with or without book files.

## Sync, briefly

The journal syncs across devices through a Cloudflare Worker backed by D1, with EPUB bytes in R2 — no account, no login. Your browser holds a **capability key**: whoever holds the key has access, and it behaves like a bookmark URL, not a password. The server stores only `SHA-256(key)`.

- **Metadata** — books, quotes, shelves and reading positions sync automatically when you are online; offline, changes queue and go out on the next sync. There is no server UI: the app is the only way in.
- **Book files** — when you add an EPUB while online, a copy is uploaded to the private bucket in the background. Open the same book on another device and the reader fetches it once, then keeps it locally. If a book is not in this browser and cannot be fetched, the reader says so instead of pretending.
- **Your data, exported** still applies — exports never depend on the server.

## What it does not do yet

- **No scroll mode.** The reader pages; it does not offer continuous scrolling as an alternative.
- EPUB only. No PDF, MOBI or AZW3, and no DRM-protected files.
- Sync conflicts from edits made on two devices in the same millisecond surface in Settings but are not yet editable side by side.

## Running it

Requires Node.js **20.19+ or 22.12+** (a recent Node 24 works).

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

Production build:

```bash
node node_modules/vite/bin/vite.js build --configLoader native
```

> The `--configLoader native` flag is required on machines where esbuild's config bundler cannot walk up the directory tree (a locked `package.json` above the project). It is also why `vite.config` is `.mjs`.

## Verification

Quality gates define the bar and run in CI on every push:

```bash
npm run qa            # all gates, summaries and failures
npm run qa:verbose    # every check with its measured value
npm run qa:explore    # exploratory probes for problems gates don't cover
```

See [QA.md](QA.md) for what each gate protects and why it exists.

Individual suites:

```bash
npm run verify                        # typecheck + build + smoke + epub tests
npm run typecheck                     # TypeScript only, no emit
npm run build                         # production build
```

The EPUB fixtures are generated rather than committed; `epub-tests.cjs` builds
them on demand, and `node smoke/make-epub-fixture.cjs` does it explicitly.
The smoke build must be compiled first:

```bash
npx tsc -p tsconfig.smoke.json
node smoke/smoke.cjs                  # render, parser, storage, exporters
node smoke/epub-tests.cjs             # ZIP reader, EPUB metadata, shelves
node smoke/plan-tests.cjs             # reading plan queue, pace, forecast
node smoke/reader-tests.cjs           # EPUB opening, TOC, chapters, sanitising
node smoke/reader-typography-tests.cjs # pagination maths, typography, AA spacing
```

The browser suites need the built app served on `http://127.0.0.1:4173`:

```bash
node smoke/serve-dist.cjs             # serves dist/
node smoke/verify-trust.cjs           # delete/undo, focus, durability
node smoke/shelf-upload-tests.cjs     # shelves and upload in a real browser
node smoke/plan-ui-tests.cjs          # the reading plan in a real browser
node smoke/reader-ui-tests.cjs         # reading an EPUB in a real browser
node smoke/reader-pagination-tests.cjs # pagination and customization in a browser
node smoke/reader-behaviour-tests.cjs  # page geometry, reflow anchoring, tap zones, links
node smoke/byte-lifecycle.cjs         # book bytes survive undo, clear on expiry
node smoke/local-first-tests.cjs      # the cloud off: position, notes and highlights survive on local bytes alone
node smoke/dev-server-check.cjs       # the dev server serves the app
```

## Roadmap

The reader is planned in phases. The architecture and typography specifications are kept as local design notes rather than committed documents.

- **Phase 0** — IndexedDB storage and migration *(built)*
- **Phase 1** — the reader: chapters, TOC, typography, position restore, paginated page turns *(built)*
- **Phase 2** — reading ⇄ writing: selection, margin notes, anchored highlights *(built)*
- **Phase 3** — Cloudflare backend: EPUB upload to R2, shelves end to end *(built)*
- **Phase 4** — metadata sync across devices *(built)*
- **Phase 5** — hardening *(ongoing)*

## Importing Play Books highlights

1. In the Play Books app, open a book → **Notes** → **Export notes**. Google saves a document with your highlights to your Google Drive.
2. Download that document (or any `.html` / `.txt` / `.md` / `.csv` / `.json` notes file).
3. In Marginalia, drag the file anywhere onto the window (or use **Import notes**).
4. Preview the parsed highlights, attach them to an existing book or create one, and import. Already-imported quotes are skipped automatically.

## Project layout

```
src/
  types.ts              Data model (Book, Shelf, Quote, ReadStatus)
  storage.ts            Persistence, sanitizing, merging, storage health
  useJournal.ts         App-wide store
  lib/
    epub.ts             EPUB metadata extraction (container → OPF → cover)
    epubBook.ts         EPUB reading: spine, TOC, chapters, resource rewriting
    anchors.ts          Text anchors for marginalia: build, resolve, paint
    pagination.ts       Page geometry, column layout, text anchors
    readingPosition.ts  (chapter, fraction) positions and progress
    readerCss.ts        Reader typography → the page's CSS; column count
    readerSettings.ts   Typography defaults, presets, limits, AA spacing
    zip.ts              Minimal ZIP reader (stored + deflate)
    bookFiles.ts        EPUB bytes in IndexedDB, quota and persistence
    plan.ts             Reading plan queue, measured pace, forecast
    pendingDeletes.ts   Undo that survives a refresh
    colors.ts           Spine colours, shared by every add-book path
    status.ts           The single status model
    toasts.tsx          Transient feedback and undo
    playbooks.ts        Play Books export parser
    exporters.ts        JSON / CSV / Markdown export
  components/           Book cards, modals, shelves, authored icon set
  views/                Library, Reading plan, Reader, Quotes, Reading life
smoke/                  Test suites, QA gates, fixtures
```

## Notes

- Book file contents are untrusted: chapters are intended to render in a sandboxed iframe with scripts disabled and a locked-down CSP.
- DRM-protected EPUBs are not supported and will not be.

## License

MIT — see [LICENSE](LICENSE).
