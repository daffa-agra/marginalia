import { useCallback, useEffect, useState } from 'react';
import { useJournal } from './useJournal';
import { LibraryView } from './views/LibraryView';
import { StatsView } from './views/StatsView';
import { QuotesView } from './views/QuotesView';
import { BookDetailView } from './components/BookDetail';
import { ImportModal } from './components/ImportModal';
import { DataModal } from './components/DataModal';
import { BookFormModal } from './components/BookFormModal';
import { cx } from './lib/utils';

type View = 'library' | 'stats' | 'quotes';

const NAV: Array<{ id: View; label: string; icon: string }> = [
  { id: 'library', label: 'Library', icon: '▤' },
  { id: 'quotes', label: 'Quotes', icon: '❝' },
  { id: 'stats', label: 'Reading life', icon: '✻' },
];

export default function App() {
  const store = useJournal();
  const [view, setView] = useState<View>('library');
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [globalDrag, setGlobalDrag] = useState(false);

  const openBook = useCallback((id: string) => {
    setOpenBookId(id);
    window.scrollTo({ top: 0 });
  }, []);

  const goLibrary = useCallback(() => {
    setOpenBookId(null);
    setView('library');
  }, []);

  const switchView = useCallback((next: View) => {
    setOpenBookId(null);
    setView(next);
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

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <button type="button" className="brand" onClick={goLibrary}>
          <span className="brand-mark" aria-hidden="true">
            ❧
          </span>
          <span className="brand-name">Marginalia</span>
        </button>
        <nav aria-label="Main">
          <ul className="nav-list" role="list">
            {NAV.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cx('nav-link', view === item.id && !openBookId && 'active')}
                  aria-current={view === item.id && !openBookId ? 'page' : undefined}
                  onClick={() => switchView(item.id)}
                >
                  <span aria-hidden="true">{item.icon}</span> {item.label}
                  {item.id === 'quotes' && quoteCount > 0 ? (
                    <span className="nav-badge">{quoteCount}</span>
                  ) : null}
                  {item.id === 'library' && bookCount > 0 ? (
                    <span className="nav-badge">{bookCount}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="header-actions">
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add book
          </button>
          <button type="button" className="btn" onClick={() => setImportOpen(true)}>
            ⬇ Import notes
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setDataOpen(true)}>
            Data
          </button>
        </div>
      </header>

      <main id="main" className="app-main">
        {openBookId ? (
          <BookDetailView bookId={openBookId} store={store} onBack={goLibrary} />
        ) : view === 'library' ? (
          <LibraryView store={store} onOpenBook={openBook} />
        ) : view === 'stats' ? (
          <StatsView data={store.data} />
        ) : (
          <QuotesView store={store} />
        )}
      </main>

      <footer className="app-footer">
        <p className="muted">
          Marginalia · your reading life, kept locally in this browser. Export from <strong>Data</strong> to back
          it up.
        </p>
      </footer>

      {store.isDemo && (
        <div className="demo-banner" role="note">
          <span>
            You're browsing a sample shelf — add a book or import notes and your real journal begins
            (saved in this browser).
          </span>
          <button type="button" className="btn btn-small" onClick={store.persistNow}>
            Keep sample &amp; start
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
          onClose={() => setImportOpen(false)}
          onOpenBook={openBook}
        />
      )}
      {dataOpen && <DataModal store={store} onClose={() => setDataOpen(false)} />}
      {adding && (
        <BookFormModal store={store} onClose={() => setAdding(false)} onSaved={openBook} />
      )}
    </div>
  );
}
