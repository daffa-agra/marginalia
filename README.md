# Marginalia 📖

A personal book journal — your library, reviews, quotes, and reading stats, kept in your browser.

## Features

- **Library** — track every book through *Want to read → Reading → Finished* (or *Abandoned*), with progress, ratings, reviews, genres, series, and dates.
- **Quotes & notes** — collect passages with your own annotations; masonry layout, filter, edit, copy.
- **Reading life** — books finished per month, pages read, genres, average rating, and your top shelf.
- **Play Books import** — drop in the notes file you exported from Google Play Books (saved to Google Drive), preview it, and attach highlights to books — with duplicate protection.
- **Your data, your machine** — everything lives in the browser's local storage. Export full JSON backups, Markdown journals, or CSVs from the **Data** dialog. No account, no server.

## Running it

Requires Node.js **20.19+ or 22.12+** (any recent Node 24 works).

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

Production build: `pnpm build` · Preview the build: `pnpm preview`

npm works too (`npm install && npm run dev`); the hoisted `.npmrc` keeps pnpm installs portable.

## Importing Play Books highlights

1. In the Play Books app, open a book → **Notes** → **Export notes**. Google saves a document with your highlights to your Google Drive.
2. Download that document (or any `.html` / `.txt` / `.md` / `.csv` / `.json` notes file).
3. In Marginalia, drag the file anywhere onto the window (or use **⬇ Import notes**).
4. Preview the parsed highlights, attach them to an existing book or create one, and import. Already-imported quotes are skipped automatically.

## Project layout

```
src/
  types.ts            Data model (Book, Quote, statuses)
  storage.ts          localStorage persistence, sanitizing, merging
  useJournal.ts       App-wide store (React hooks)
  sampleData.ts       Demo shelf shown before your first save
  lib/
    playbooks.ts      Play Books export parser
    exporters.ts      JSON / CSV / Markdown export
    utils.ts          Dates, ids, formatting
  components/         BookCard, BookDetail, modals, QuoteList…
  views/              Library, Quotes, Stats views
smoke/smoke.cjs       Headless render + parser/storage/exporter tests
```

## Verification

```bash
npx tsc --noEmit -p tsconfig.json        # type check
npx tsc -p tsconfig.smoke.json           # compile smoke build
node smoke/smoke.cjs                     # headless tests
```

The smoke suite server-renders the whole app, and exercises the Play Books parser (HTML + Markdown, notes, positions), storage sanitizing/merging, and all exporters.

## Roadmap

- **v2 — direct Google Drive sync**: connect with Google OAuth (you create a free OAuth Client ID in Google Cloud Console) and pull the exported notes docs straight from Drive — no manual downloads.
- Book cover lookup (Open Library), reading-goal tracking, keyboard shortcuts.
