import { useCallback, useEffect, useState } from 'react';
import { useJournal } from './useJournal';
import { LibraryView } from './views/LibraryView';
import { StatsView } from './views/StatsView';
import { PlanView } from './views/PlanView';
import { QuotesView } from './views/QuotesView';
import { BookDetailView } from './components/BookDetail';
import { ReaderView } from './views/ReaderView';
import { ImportModal } from './components/ImportModal';
import { DataModal } from './components/DataModal';
import { UploadBookModal } from './components/UploadBookModal';
import { SettingsModal } from './components/SettingsModal';
import { BrandMark, Icon } from './components/icons';
import { ToastRegion, useToasts } from './lib/toasts';
import { listPendingDeletes, removePendingDelete } from './lib/pendingDeletes';
import { useAutoSync } from './lib/useAutoSync';
import { useBookUploads } from './lib/useBookUploads';
import { completeSignInFromRedirect } from './lib/auth';
import { runSync } from './lib/syncEngine';
import { cx } from './lib/utils';

type View = 'library' | 'plan' | 'quotes' | 'stats';

const NAV: Array<{ id: View; label: string; icon: 'shelf' | 'quote' | 'chart' | 'bookmark' }> = [
  { id: 'library', label: 'Library', icon: 'shelf' },
  { id: 'plan', label: 'Plan', icon: 'bookmark' },
  { id: 'quotes', label: 'Quotes', icon: 'quote' },
  { id: 'stats', label: 'Reading life', icon: 'chart' },
];

const TITLES: Record<View, string> = {
  library: 'Marginalia — Book journal',
  plan: 'Reading plan — Marginalia',
  quotes: 'Quotes — Marginalia',
  stats: 'Reading life — Marginalia',
};

export default function App() {
  const store = useJournal();
  const { toasts, notify, dismiss } = useToasts();

  // Annotations, positions and edits cross devices on their own: every local
  // change pushes after a short debounce, and anything another device wrote
  // arrives on the next catch-up. Sync state still surfaces in Settings.
  useAutoSync(store.rawData, store.replaceAll);
  // Book bytes queue and retry like the journal does: a failed or interrupted
  // cloud copy is re-attempted, so the book can still reach other devices.
  useBookUploads(store.data, store.updateBook);
  const [view, setView] = useState<View>('library');
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [readingBookId, setReadingBookId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [globalDrag, setGlobalDrag] = useState(false);

  const openBook = useCallback((id: string) => {
    setOpenBookId(id);
    setReadingBookId(null);
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  /** Enter the reading surface. Needs a file, which the book page guarantees. */
  const readBook = useCallback((id: string) => {
    setReadingBookId(id);
    setOpenBookId(null);
    setMoreOpen(false);
  }, []);

  const goLibrary = useCallback(() => {
    setOpenBookId(null);
    setReadingBookId(null);
    setView('library');
    setMoreOpen(false);
  }, []);

  const switchView = useCallback((next: View) => {
    setOpenBookId(null);
    setReadingBookId(null);
    setView(next);
    setMoreOpen(false);
  }, []);

  useEffect(() => {
    document.title = openBookId ? 'Book — Marginalia' : TITLES[view];
  }, [view, openBookId]);

  // A Google sign-in lands back on this page with ?code and ?state in the
  // address. Turning those into a session is boot work, and the pull right
  // after it is what fills an empty device with the account's journal — the
  // auto-sync hooks skip a device with nothing to push.
  useEffect(() => {
    void (async () => {
      const done = await completeSignInFromRedirect();
      if (!done) return;
      if (done.ok) {
        notify(`Signed in as ${done.session.user.name ?? done.session.user.email ?? 'you'}`);
        const outcome = await runSync(store.rawData, undefined);
        if (outcome.data) store.replaceAll(outcome.data);
      } else {
        notify(done.error, { tone: 'danger' });
      }
    })();
    // Runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A delete interrupted by a refresh must still be undoable. Anything whose
  // window is still open gets its undo offered again on load.
  useEffect(() => {
    for (const pending of listPendingDeletes()) {
      const remaining = Math.max(1000, pending.expiresAt - Date.now());
      notify(`Deleted “${pending.book.title}”`, {
        duration: remaining,
        tone: 'danger',
        action: {
          label: 'Undo',
          onClick: () => {
            removePendingDelete(pending.book.id);
            store.restoreBook(pending.book, pending.quotes);
          },
        },
      });
    }
    // Runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global drag-and-drop: dropping a notes file anywhere opens the importer.
  useEffect(() => {
    let depth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      depth += 1;
      setGlobalDrag(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setGlobalDrag(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      depth = 0;
      setGlobalDrag(false);
      setImportOpen(true);
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  const quoteCount = store.data.quotes.length;
  const bookCount = store.data.books.length;
  const { health } = store;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <button type="button" className="brand" onClick={goLibrary} aria-label="Marginalia, go to library">
          <BrandMark />
          <span className="brand-name">Marginalia</span>
        </button>
        <nav aria-label="Main">
          <ul className="nav-list">
            {NAV.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cx('nav-link', view === item.id && !openBookId && 'active')}
                  aria-current={view === item.id && !openBookId ? 'page' : undefined}
                  onClick={() => switchView(item.id)}
                >
                  <Icon name={item.icon} />
                  <span className="nav-label">{item.label}</span>
                  {item.id === 'quotes' && quoteCount > 0 ? (
                    <span className="nav-badge numeric">{quoteCount}</span>
                  ) : null}
                  {item.id === 'library' && bookCount > 0 ? (
                    <span className="nav-badge numeric">{bookCount}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-primary add-trigger"
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size={14} />
            <span className="header-action-label">Add book</span>
          </button>
          <button
            type="button"
            className="btn btn-quiet import-trigger"
            onClick={() => setImportOpen(true)}
            aria-label="Import notes"
          >
            <Icon name="import" size={14} />
            <span className="header-action-label">Import notes</span>
          </button>
          <div className={moreOpen ? 'more-menu open' : 'more-menu'}>
            <button
              type="button"
              className="btn btn-quiet icon-btn more-trigger"
              aria-label="Your data and backups"
              title="Your data and backups"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onClick={() => setMoreOpen((v) => !v)}
            >
              <Icon name="more" />
            </button>
            {moreOpen && (
              <div className="more-popover" role="menu" aria-label="More actions">
                <button
                  type="button"
                  role="menuitem"
                  className="more-item"
                  onClick={() => {
                    setMoreOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  <Icon name="key" /> Settings and sync
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="more-item"
                  onClick={() => {
                    setMoreOpen(false);
                    setDataOpen(true);
                  }}
                >
                  <Icon name="shelf" /> Your data and backups
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="more-item"
                  onClick={() => {
                    setMoreOpen(false);
                    setImportOpen(true);
                  }}
                >
                  <Icon name="import" /> Import Play Books notes
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!health.writable && (
        <div className="storage-warning" role="alert">
          <Icon name="offline" />
          <span>
            This browser is not saving changes. Export a backup now, or try a normal (non-private)
            window.
          </span>
          <button type="button" className="btn btn-small" onClick={() => setDataOpen(true)}>
            Export
          </button>
        </div>
      )}

      <main id="main" className="app-main" tabIndex={-1}>
        {readingBookId ? (
          <ReaderView
            book={store.data.books.find((b) => b.id === readingBookId)!}
            store={store}
            onBack={() => {
              setOpenBookId(readingBookId);
              setReadingBookId(null);
            }}
          />
        ) : openBookId ? (
          <BookDetailView
            bookId={openBookId}
            store={store}
            onBack={goLibrary}
            onRead={readBook}
            notify={notify}
          />
        ) : view === 'library' ? (
          <LibraryView store={store} onOpenBook={openBook} notify={notify} />
        ) : view === 'stats' ? (
          <StatsView data={store.data} />
        ) : view === 'plan' ? (
          <PlanView
            store={store}
            onOpenBook={openBook}
            notify={notify}
            onBrowseLibrary={goLibrary}
          />
        ) : (
          <QuotesView store={store} notify={notify} />
        )}
      </main>

      <footer className="app-footer">
        <p className="muted">
          Kept in this browser, and synced to your other devices when online.{' '}
          {health.lastSavedAt ? <SavedLine at={health.lastSavedAt} /> : null}
        </p>
      </footer>

      {store.isDemo && (
        <div className="demo-banner" role="note">
          <span>
            Six sample books are loaded so the shelves are not empty. Editing anything replaces them
            with your own journal.
          </span>
          <button type="button" className="btn btn-small" onClick={store.persistNow}>
            Keep the samples
          </button>
        </div>
      )}

      {globalDrag && (
        <div className="drag-veil" aria-hidden="true">
          <div className="drag-veil-inner">Drop to import highlights</div>
        </div>
      )}

      {importOpen && (
        <ImportModal
          store={store}
          notify={notify}
          onClose={() => setImportOpen(false)}
          onOpenBook={openBook}
        />
      )}
      {dataOpen && (
        <DataModal
          store={store}
          onClose={() => setDataOpen(false)}
          notify={notify}
          returnFocusTo=".more-trigger"
        />
      )}
      {settingsOpen && (
        <SettingsModal
          rawData={store.rawData}
          onClose={() => setSettingsOpen(false)}
          onSynced={store.replaceAll}
          notify={notify}
        />
      )}
      {adding && (
        <UploadBookModal
          store={store}
          notify={notify}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            openBook(id);
          }}
        />
      )}

      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function SavedLine({ at }: { at: number }) {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return <span className="saved-line">Last saved {time}</span>;
}

