import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book } from '../types';
import type { JournalStore } from '../useJournal';
import { Icon } from '../components/icons';
import { ReaderSettingsPanel } from '../components/ReaderSettingsPanel';
import { loadBookBytes } from '../lib/bookFiles';
import { chapterHtml, closeBook, openBook } from '../lib/epubBook';
import type { ParsedBook } from '../lib/epubBook';
import {
  bookProgress,
  chapterLabel,
  clampFraction,
  normalisePosition,
  progressPatch,
} from '../lib/readingPosition';
import type { ReadingPosition as Position } from '../lib/readingPosition';
import { buildReaderCss, resolveColumns } from '../lib/readerCss';
import { fractionToPage, pageToFraction, paginate, showPage } from '../lib/pagination';
import type { PaginationResult } from '../lib/pagination';
import { useReaderSettings } from '../lib/useReaderSettings';

/**
 * The reading surface.
 *
 * A chapter renders as one tall document in a sandboxed frame; the pagination
 * module carves it into pages that fit. Position is stored as (chapter,
 * fraction-of-pages), so it survives a reflow, a font change and a reload.
 */
export function ReaderView({
  book,
  store,
  onBack,
}: {
  book: Book;
  store: JournalStore;
  onBack: () => void;
}) {
  const settingsStore = useReaderSettings(book.id);
  const { typography, settings } = settingsStore;

  const [parsed, setParsed] = useState<ParsedBook | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [pages, setPages] = useState<PaginationResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const pendingFraction = useRef(0);

  const total = parsed?.chapters.length ?? 0;

  /* ── open the archive ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const blob = await loadBookBytes(book.id);
        if (!blob) {
          if (!cancelled) {
            setError('This book has no file attached. Add an EPUB from the book page.');
            setLoading(false);
          }
          return;
        }
        const buffer = await blob.arrayBuffer();
        if (cancelled) return;
        bufferRef.current = buffer;
        const data = await openBook(buffer);
        if (cancelled) return;
        setParsed(data);
        const start = normalisePosition(book.position, data.chapters.length);
        setChapterIndex(start?.chapter ?? 0);
        pendingFraction.current = start?.fraction ?? 0;
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open this book.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    return () => {
      setParsed((current) => {
        if (current) closeBook(current);
        return null;
      });
    };
  }, []);

  /* ── CSS derived from typography ── */
  const columns = useMemo(() => {
    const width = stageRef.current?.clientWidth ?? window.innerWidth;
    return resolveColumns(settings.columns, width, typography.fontSizePx);
  }, [settings.columns, typography.fontSizePx, ready]);

  const readerCss = useMemo(
    () => buildReaderCss({ typography, mode: settings.mode, theme: settings.theme, columns }),
    [typography, settings.mode, settings.theme, columns],
  );

  const persistPosition = useCallback(
    (chapter: number, fraction: number) => {
      const next: Position = { chapter, fraction: clampFraction(fraction), updatedAt: Date.now() };
      const patch: Partial<Book> = { position: next };
      if (book.totalPages) {
        Object.assign(patch, progressPatch(book, bookProgress(next, total)));
      }
      store.updateBook(book.id, patch);
    },
    [book, store, total],
  );

  /* ── render the chapter, then paginate ── */
  const repaginate = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const stage = stageRef.current;
    if (!doc || !doc.body || !stage) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width === 0 || height === 0) return;

    const result = paginate(doc, width, height);
    setPages(result);
    const target = fractionToPage(pendingFraction.current, result.pageCount);
    setPageIndex(target);
    showPage(doc, target, result);
    pendingFraction.current = 0;
    setReady(true);
  }, []);

  useEffect(() => {
    if (!parsed || !bufferRef.current) return;
    const chapter = parsed.chapters[chapterIndex];
    if (!chapter) return;
    let cancelled = false;
    setReady(false);
    (async () => {
      try {
        const html = await chapterHtml(parsed, chapter, bufferRef.current!, readerCss);
        if (cancelled) return;
        const frame = frameRef.current;
        if (frame) frame.srcdoc = html;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not render this chapter.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parsed, chapterIndex, readerCss]);

  /** Attach the same keys to the book document whenever a chapter loads. */
  const attachFrameKeys = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.addEventListener('keydown', (event) => keyHandlerRef.current(event));
  }, []);

  const onFrameLoad = useCallback(() => {
    // Give the frame a tick to lay out fonts and images before measuring.
    window.setTimeout(() => {
      repaginate();
      attachFrameKeys();
    }, 60);
  }, [repaginate, attachFrameKeys]);

  /* ── re-measure on resize ── */
  useEffect(() => {
    if (!ready) return;
    const onResize = () => {
      const doc = frameRef.current?.contentDocument;
      if (!doc) return;
      const result = paginate(
        doc,
        stageRef.current?.clientWidth ?? 0,
        stageRef.current?.clientHeight ?? 0,
      );
      setPages(result);
      const clamped = Math.min(pageIndex, result.pageCount - 1);
      setPageIndex(clamped);
      showPage(doc, clamped, result);
    };
    let timer: number | undefined;
    const debounced = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(onResize, 180);
    };
    window.addEventListener('resize', debounced);
    return () => {
      window.removeEventListener('resize', debounced);
      if (timer) window.clearTimeout(timer);
    };
  }, [ready, pageIndex]);

  const goToPage = useCallback(
    (next: number) => {
      if (!pages) return;
      const clamped = Math.max(0, Math.min(pages.pageCount - 1, next));
      setPageIndex(clamped);
      const doc = frameRef.current?.contentDocument;
      if (doc) showPage(doc, clamped, pages);
      persistPosition(chapterIndex, pageToFraction(clamped, pages.pageCount));
    },
    [pages, chapterIndex, persistPosition],
  );

  const turnPage = useCallback(
    (direction: 1 | -1) => {
      if (!pages) return;
      const next = pageIndex + direction;
      if (next < 0) {
        if (chapterIndex > 0) {
          pendingFraction.current = 1;
          setChapterIndex(chapterIndex - 1);
          persistPosition(chapterIndex - 1, 1);
        }
        return;
      }
      if (next >= pages.pageCount) {
        if (parsed && chapterIndex < parsed.chapters.length - 1) {
          pendingFraction.current = 0;
          setChapterIndex(chapterIndex + 1);
          persistPosition(chapterIndex + 1, 0);
        }
        return;
      }
      goToPage(next);
    },
    [pages, pageIndex, chapterIndex, parsed, goToPage, persistPosition],
  );

  /* ── keyboard ── */
  // Keys must work whether focus is in the app or inside the book, because a
  // reader clicks the text far more often than the chrome. A keydown inside
  // the iframe never reaches the parent window, so both are listened to.
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else if (tocOpen) setTocOpen(false);
        else onBack();
        return;
      }
      if (event.key.toLowerCase() === 't') {
        setTocOpen((v) => !v);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        turnPage(1);
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        turnPage(-1);
      }
    };
    keyHandlerRef.current = onKey;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turnPage, onBack, tocOpen, settingsOpen]);


  const goToChapter = useCallback(
    (index: number, fraction = 0) => {
      if (!parsed) return;
      const clamped = Math.max(0, Math.min(parsed.chapters.length - 1, index));
      pendingFraction.current = fraction;
      setChapterIndex(clamped);
      persistPosition(clamped, fraction);
      setTocOpen(false);
    },
    [parsed, persistPosition],
  );

  const percent = pages
    ? bookProgress({ chapter: chapterIndex, fraction: pageToFraction(pageIndex, pages.pageCount), updatedAt: 0 }, total || 1)
    : bookProgress(book.position ?? null, total || 1);

  if (error) {
    return (
      <section className="view reader-view" aria-labelledby="reader-error">
        <button type="button" className="btn reader-back" onClick={onBack}>
          <Icon name="back" size={14} /> Back
        </button>
        <div className="empty-state" role="alert">
          <span className="empty-rule" aria-hidden="true" />
          <h2 id="reader-error">This book could not be opened</h2>
          <p className="muted">{error}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="reader" aria-label={`Reading ${book.title}`} data-theme-reader={settings.theme}>
      <header className="reader-bar">
        <button type="button" className="reader-icon-btn" aria-label="Back to book page" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div className="reader-title">
          <span className="reader-book-title">{book.title}</span>
          {parsed && (
            <span className="reader-chapter">
              {chapterLabel({ chapter: chapterIndex, fraction: 0, updatedAt: 0 }, parsed.chapters.length)}
              {pages ? ` · page ${pageIndex + 1} of ${pages.pageCount}` : ''}
            </span>
          )}
        </div>
        <div className="reader-bar-actions">
          <button
            type="button"
            className="reader-icon-btn"
            aria-label="Table of contents"
            aria-expanded={tocOpen}
            onClick={() => {
              setTocOpen((v) => !v);
              setSettingsOpen(false);
            }}
          >
            <Icon name="shelf" />
          </button>
          <button
            type="button"
            className="reader-icon-btn"
            aria-label="Reading settings"
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsOpen((v) => !v);
              setTocOpen(false);
            }}
          >
            Aa
          </button>
        </div>
      </header>

      {tocOpen && parsed && (
        <>
          <div className="reader-scrim" onClick={() => setTocOpen(false)} />
          <nav className="reader-toc" aria-label="Table of contents">
            <h2>Contents</h2>
            <ol>
              {parsed.toc.map((entry, i) => {
                const targetIndex = entry.path
                  ? parsed.chapters.findIndex((c) => c.path === entry.path)
                  : -1;
                return (
                  <li key={`${entry.label}-${i}`} style={{ paddingLeft: `${entry.depth * 12}px` }}>
                    <button
                      type="button"
                      className={targetIndex === chapterIndex ? 'reader-toc-link active' : 'reader-toc-link'}
                      disabled={targetIndex < 0}
                      onClick={() => goToChapter(targetIndex, 0)}
                    >
                      {entry.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </>
      )}

      {settingsOpen && (
        <>
          <div className="reader-scrim" onClick={() => setSettingsOpen(false)} />
          <ReaderSettingsPanel store={settingsStore} onClose={() => setSettingsOpen(false)} />
        </>
      )}

      <div className="reader-stage" ref={stageRef}>
        {loading ? (
          <div className="reader-loading">
            <p className="muted">Opening the book…</p>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            className="reader-frame"
            title={`${book.title} — chapter ${chapterIndex + 1}`}
            sandbox="allow-same-origin"
            onLoad={onFrameLoad}
          />
        )}
      </div>

      <footer className="reader-foot">
        <button
          type="button"
          className="reader-nav-btn"
          aria-label="Previous page"
          onClick={() => turnPage(-1)}
        >
          <Icon name="chevronDown" size={14} className="flip-up" />
        </button>
        <div className="reader-progress">
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Book progress"
          >
            <div className="progress-fill" style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
          <span className="reader-progress-label numeric">{percent}%</span>
        </div>
        <button
          type="button"
          className="reader-nav-btn"
          aria-label="Next page"
          onClick={() => turnPage(1)}
        >
          <Icon name="chevronDown" size={14} />
        </button>
      </footer>
    </section>
  );
}
