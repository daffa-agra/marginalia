import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book } from '../types';
import { loadBookBytes } from '../lib/bookFiles';
import { ReaderEngine, type RelocateInfo, type TocItem } from './engine';
import { TypographyPanel } from './TypographyPanel';
import { loadPositions, loadSettings, savePosition, saveSettings, type ReadingPosition } from './settings';
import { clampTypography, resolveTypography, type ReaderSettings } from './typography';
import { Icon } from '../components/icons';
import { cx } from '../lib/utils';

/**
 * The reading surface (READER-DESIGN §6.3): quiet chrome, the book is the
 * content. Position is saved device-local and restored by CFI, so a font
 * change never costs the reader their page.
 */

type ReaderState =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

export function ReaderView({
  book,
  onBack,
}: {
  book: Book;
  onBack: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ReaderEngine | null>(null);
  const [state, setState] = useState<ReaderState>({ phase: 'loading' });
  const [settings, setSettings] = useState<ReaderSettings>(() => loadSettings());
  const [relocate, setRelocate] = useState<RelocateInfo | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const lastRestoredCfi = useRef<string | null>(null);

  const typography = useMemo(() => resolveTypography(settings, book.id), [settings, book.id]);

  const patchSettings = useCallback(
    (next: ReaderSettings) => {
      setSettings(next);
      saveSettings(next);
    },
    [],
  );

  const setTypographyForBook = useCallback(
    (patch: Partial<typeof settings.global>, scopeAll: boolean) => {
      setSettings((current) => {
        if (scopeAll) {
          const merged = { ...current, global: clampTypography({ ...current.global, ...patch }) };
          saveSettings(merged);
          if (current.perBook[book.id]) {
            return {
              ...merged,
              perBook: {
                ...merged.perBook,
                [book.id]: clampTypography({ ...merged.perBook[book.id], ...patch }),
              },
            };
          }
          return merged;
        }
        const base = current.perBook[book.id] ?? current.global;
        return {
          ...current,
          perBook: {
            ...current.perBook,
            [book.id]: clampTypography({ ...base, ...patch }),
          },
        };
      });
    },
    [book.id],
  );

  const resetTypography = useCallback(
    (scopeAll: boolean) => {
      setSettings((current) => {
        const next: ReaderSettings = scopeAll
          ? { ...current, perBook: {} }
          : {
              ...current,
              perBook: Object.fromEntries(Object.entries(current.perBook).filter(([id]) => id !== book.id)),
            };
        saveSettings(next);
        return next;
      });
    },
    [book.id],
  );

  // Open the book once. foliate-js owns the layout from here on; React only
  // reacts to its events.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const engine = new ReaderEngine();
    engineRef.current = engine;

    loadBookBytes(book.id)
      .then(async (blob) => {
        if (cancelled) return;
        if (!blob) {
          setState({
            phase: 'error',
            message: 'The book file is not in this browser\u2019s storage. Add the EPUB again to read it.',
          });
          return;
        }
        const saved: ReadingPosition | null = loadPositions()[book.id] ?? null;
        lastRestoredCfi.current = saved?.cfi ?? null;
        const tocItems = await engine.open(container, blob, {
          onRelocate: (info) => {
            setRelocate(info);
            if (typeof info.fraction === 'number') setProgress(Math.round(info.fraction * 100));
          },
        });
        if (cancelled) return;
        setToc(tocItems);
        engine.setColumns(settings.columns);
        engine.setTypography(typography, settings);
        if (saved?.cfi) await engine.goTo(saved.cfi);
        else if (typeof saved?.percent === 'number') await engine.goToFraction(saved.percent / 100);
        setState({ phase: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Failed to open the book.', err);
        setState({
          phase: 'error',
          message:
            err instanceof Error && err.message
              ? err.message
              : 'This file could not be opened as a DRM-free EPUB.',
        });
      });

    return () => {
      cancelled = true;
      engine.destroy();
      engineRef.current = null;
    };
    // Open is intentionally once-per-mount; settings changes go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // Typography and chrome options apply live; the engine styles every
  // chapter document, last, with !important.
  useEffect(() => {
    engineRef.current?.setTypography(typography, settings);
    engineRef.current?.setColumns(settings.columns);
  }, [typography, settings]);

  // Position save: debounced 1.5 s (design §6.3).
  const persistPosition = useCallback(
    (info: RelocateInfo) => {
      if (!info.cfi) return;
      const position: ReadingPosition = {
        cfi: info.cfi,
        percent: typeof info.fraction === 'number' ? Math.round(info.fraction * 100) : 0,
        updatedAt: Date.now(),
      };
      savePosition(book.id, position);
    },
    [book.id],
  );

  useEffect(() => {
    if (!relocate) return;
    const timer = window.setTimeout(() => persistPosition(relocate), 1500);
    return () => window.clearTimeout(timer);
  }, [relocate, persistPosition]);

  const pageBy = useCallback(
    (direction: 'next' | 'prev') => {
      const engine = engineRef.current;
      if (!engine) return;
      if (direction === 'next') void engine.next();
      else void engine.prev();
    },
    [],
  );

  // Keyboard map (design §6.2, §6.3).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        if (event.key === '=' || event.key === '+') {
          event.preventDefault();
          setTypographyForBook({ fontSizePx: Math.min(32, typography.fontSizePx + 1) }, false);
          return;
        }
        if (event.key === '-') {
          event.preventDefault();
          setTypographyForBook({ fontSizePx: Math.max(12, typography.fontSizePx - 1) }, false);
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          setTypographyForBook({ fontSizePx: 17 }, false);
          return;
        }
        return;
      }
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        pageBy('next');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        pageBy('prev');
      } else if (event.key === 'Escape') {
        if (panelOpen) setPanelOpen(false);
        else if (tocOpen) setTocOpen(false);
        else onBack();
      } else if (event.key === 't' || event.key === 'T') {
        const target = event.target as HTMLElement | null;
        if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        setPanelOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, pageBy, panelOpen, setTypographyForBook, tocOpen, typography.fontSizePx]);

  return (
    <div
      className={cx(
        'reader',
        `reader-theme-${settings.theme}`,
        settings.fullscreen && 'reader-fullscreen',
        settings.mode === 'own' && 'reader-mode-own',
      )}
      data-book-id={book.id}
    >
      <header className="reader-header">
        <button type="button" className="btn btn-quiet icon-btn" onClick={onBack} aria-label="Back to the library">
          <Icon name="back" />
        </button>
        <div className="reader-title" role="heading" aria-level={1}>
          <span className="reader-title-text">{book.title}</span>
          {relocate?.tocLabel ? <span className="reader-toc-label">{relocate.tocLabel}</span> : null}
        </div>
        <div className="reader-header-actions">
          <button
            type="button"
            className="btn btn-quiet icon-btn"
            aria-label="Contents"
            aria-expanded={tocOpen}
            onClick={() => setTocOpen((open) => !open)}
          >
            <Icon name="menu" />
          </button>
          <button
            type="button"
            className="btn btn-quiet icon-btn reader-aa-trigger"
            aria-label="Typography settings"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <span aria-hidden="true">Aa</span>
          </button>
        </div>
      </header>

      {settings.fullscreen ? null : (
        <div className="reader-body">
          <div ref={containerRef} className="reader-container" />
          {tocOpen && (
            <aside className="reader-toc" aria-label="Table of contents">
              <div className="reader-panel-head">
                <h2>Contents</h2>
                <button type="button" className="btn btn-quiet icon-btn" aria-label="Close contents" onClick={() => setTocOpen(false)}>
                  <Icon name="close" />
                </button>
              </div>
              <nav>
                <ul className="reader-toc-list">
                  {toc.map((item, index) => (
                    <TocEntry key={`${item.href}-${index}`} item={item} onNavigate={(href) => {
                      setTocOpen(false);
                      void engineRef.current?.goTo(href);
                    }} />
                  ))}
                </ul>
              </nav>
            </aside>
          )}
          {panelOpen && (
            <TypographyPanel
              book={book}
              settings={settings}
              onPatchSettings={patchSettings}
              onPatchTypography={setTypographyForBook}
              onReset={resetTypography}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </div>
      )}

      <footer className="reader-footer">
        <span className="reader-progress-label numeric">{progress}%</span>
        <input
          type="range"
          className="reader-progress"
          min={0}
          max={100}
          value={progress}
          aria-label="Reading progress"
          onChange={(event) => {
            const value = Number(event.target.value);
            setProgress(value);
            void engineRef.current?.goToFraction(value / 100);
          }}
        />
      </footer>

      {state.phase === 'loading' && (
        <div className="reader-veil" role="status">
          <p>{`Opening ${book.title}…`}</p>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="reader-veil" role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn" onClick={onBack}>
            Back to the library
          </button>
        </div>
      )}
    </div>
  );
}

function TocEntry({ item, onNavigate }: { item: TocItem; onNavigate: (href: string) => void }) {
  return (
    <li>
      <button type="button" className="reader-toc-link" onClick={() => onNavigate(item.href)}>
        {item.label?.trim() || 'Untitled section'}
      </button>
      {item.subItems?.length ? (
        <ul>
          {item.subItems.map((sub, index) => (
            <TocEntry key={`${sub.href}-${index}`} item={sub} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
