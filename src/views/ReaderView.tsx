import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book } from '../types';
import type { JournalStore } from '../useJournal';
import { Icon } from '../components/icons';
import { loadBookBytes } from '../lib/bookFiles';
import { chapterHtml, closeBook, openBook } from '../lib/epubBook';
import type { ParsedBook } from '../lib/epubBook';
import { bookProgress, chapterLabel, clampFraction, normalisePosition, progressPatch } from '../lib/readingPosition';
import type { ReadingPosition as Position } from '../lib/readingPosition';

/**
 * The reading surface.
 *
 * Chapters render in a sandboxed iframe with scripts disabled, so a hostile
 * EPUB cannot reach the app. Position is stored as (chapter, fraction) and
 * restored after a reflow, because page numbers do not survive a font change.
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
  const [parsed, setParsed] = useState<ParsedBook | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [fontSize, setFontSize] = useState(18);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const pendingFraction = useRef(0);

  const position: Position | null = book.position ?? null;
  const total = parsed?.chapters.length ?? 0;

  /* ── load the archive once ── */
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
        const bookData = await openBook(buffer);
        if (cancelled) return;
        setParsed(bookData);
        const start = normalisePosition(book.position, bookData.chapters.length);
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
    // Load once per book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  /* ── release blob URLs when leaving ── */
  useEffect(() => {
    return () => {
      setParsed((current) => {
        if (current) closeBook(current);
        return null;
      });
    };
  }, []);

  /**
   * The reader renders in its own document, so the app's CSS variables do not
   * cascade into it. Read the resolved token values once and pass them in, so
   * the book page and the reader share one palette including dark mode.
   */
  const [tokens, setTokens] = useState<Record<string, string>>({});

  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
      setTokens({
        ink: get('--ink', '#211d17'),
        surface: get('--surface', '#fffdf8'),
        muted: get('--ink-2', '#5d5448'),
        accent: get('--accent-strong', '#8b3616'),
        border: get('--border-strong', '#d3c7b1'),
        raised: get('--surface-2', '#f7f3ea'),
      });
    };
    read();
    // Re-read when the OS theme changes, since tokens are theme-dependent.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener?.('change', read);
    return () => media.removeEventListener?.('change', read);
  }, []);

  const readerCss = useMemo(
    () => `
:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; }
body {
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  font-size: ${fontSize}px;
  line-height: 1.65;
  color: ${tokens.ink ?? 'inherit'};
  background: ${tokens.surface ?? 'transparent'};
  padding: 0 clamp(16px, 5vw, 64px);
  -webkit-text-size-adjust: 100%;
  overflow-wrap: break-word;
  hyphens: auto;
}
#book-content { max-width: 68ch; margin: 0 auto; padding-bottom: 40vh; }
img, svg, video { max-width: 100%; height: auto; }
figure { margin: 1.5em 0; }
figcaption { font-size: 0.85em; color: ${tokens.muted ?? 'inherit'}; font-style: normal; }
h1, h2, h3, h4 { line-height: 1.25; font-family: Georgia, serif; }
a { color: ${tokens.accent ?? 'inherit'}; }
blockquote {
  margin: 1.2em 0;
  padding-left: 1em;
  border-left: 1px solid ${tokens.border ?? 'currentColor'};
  color: ${tokens.muted ?? 'inherit'};
}
pre, code { font-family: ui-monospace, 'Cascadia Code', monospace; font-size: 0.9em; }
pre { overflow-x: auto; padding: 0.8em; background: ${tokens.raised ?? 'transparent'}; border-radius: 6px; }
table { border-collapse: collapse; max-width: 100%; }
td, th { border: 1px solid ${tokens.border ?? 'currentColor'}; padding: 4px 8px; }
`,
    [fontSize, tokens],
  );

  /* ── render the current chapter ── */
  useEffect(() => {
    if (!parsed || !bufferRef.current) return;
    const chapter = parsed.chapters[chapterIndex];
    if (!chapter) return;
    let cancelled = false;
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

  /* ── restore scroll within a chapter, and save on scroll ── */
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

  const onFrameLoad = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!doc) return;
    // Stored fraction wins over wherever the fresh document starts.
    const target = pendingFraction.current;
    const maxScroll = doc.documentElement.scrollHeight - doc.documentElement.clientHeight;
    if (maxScroll > 0 && target > 0) {
      doc.documentElement.scrollTop = Math.round(maxScroll * target);
      doc.body.scrollTop = Math.round(maxScroll * target);
    }
    pendingFraction.current = 0;

    let timer: number | undefined;
    const onScroll = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const el = doc.documentElement;
        const max = el.scrollHeight - el.clientHeight;
        const fraction = max > 0 ? el.scrollTop / max : 0;
        persistPosition(chapterIndex, fraction);
      }, 600);
    };
    doc.addEventListener('scroll', onScroll, { passive: true });
  }, [chapterIndex, persistPosition]);

  /* ── keyboard paging ── */
  const goToChapter = useCallback(
    (index: number, fraction = 0) => {
      if (!parsed) return;
      const clamped = Math.max(0, Math.min(parsed.chapters.length - 1, index));
      pendingFraction.current = fraction;
      setChapterIndex(clamped);
      persistPosition(clamped, fraction);
    },
    [parsed, persistPosition],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (tocOpen) setTocOpen(false);
        else onBack();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        const doc = frameRef.current?.contentDocument;
        if (doc) {
          const el = doc.documentElement;
          const max = el.scrollHeight - el.clientHeight;
          if (el.scrollTop >= max - 8) goToChapter(chapterIndex + 1, 0);
          else el.scrollTop = Math.min(max, el.scrollTop + el.clientHeight * 0.92);
        }
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        const doc = frameRef.current?.contentDocument;
        if (doc) {
          const el = doc.documentElement;
          if (el.scrollTop <= 8) goToChapter(chapterIndex - 1, 1);
          else el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight * 0.92);
        }
      }
      if (event.key.toLowerCase() === 't') setTocOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chapterIndex, goToChapter, onBack, tocOpen]);

  /* ── progress for the footer ── */
  const currentPosition: Position = { chapter: chapterIndex, fraction: 0, updatedAt: 0 };
  const percent = parsed ? bookProgress(position ?? currentPosition, parsed.chapters.length) : 0;

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
    <section className="reader" aria-label={`Reading ${book.title}`}>
      <header className={chromeVisible ? 'reader-bar visible' : 'reader-bar'}>
        <button type="button" className="reader-icon-btn" aria-label="Back to book page" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div className="reader-title">
          <span className="reader-book-title">{book.title}</span>
          {parsed && (
            <span className="reader-chapter">
              {chapterLabel({ chapter: chapterIndex, fraction: 0, updatedAt: 0 }, parsed.chapters.length)}
            </span>
          )}
        </div>
        <div className="reader-bar-actions">
          <button
            type="button"
            className="reader-icon-btn"
            aria-label="Table of contents"
            aria-expanded={tocOpen}
            onClick={() => setTocOpen((v) => !v)}
          >
            <Icon name="shelf" />
          </button>
          <button
            type="button"
            className="reader-icon-btn"
            aria-label="Decrease text size"
            onClick={() => setFontSize((s) => Math.max(14, s - 1))}
          >
            A−
          </button>
          <button
            type="button"
            className="reader-icon-btn"
            aria-label="Increase text size"
            onClick={() => setFontSize((s) => Math.min(30, s + 1))}
          >
            A+
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
                      onClick={() => {
                        if (targetIndex >= 0) goToChapter(targetIndex, 0);
                        setTocOpen(false);
                      }}
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

      <div className="reader-stage">
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
          aria-label="Previous chapter"
          disabled={chapterIndex <= 0}
          onClick={() => goToChapter(chapterIndex - 1, 0)}
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
          aria-label="Next chapter"
          disabled={!parsed || chapterIndex >= parsed.chapters.length - 1}
          onClick={() => goToChapter(chapterIndex + 1, 0)}
        >
          <Icon name="chevronDown" size={14} />
        </button>
        <button
          type="button"
          className="reader-nav-btn reader-chrome-toggle"
          aria-label="Toggle reading controls"
          onClick={() => setChromeVisible((v) => !v)}
        >
          <Icon name="more" size={14} />
        </button>
      </footer>
    </section>
  );
}

