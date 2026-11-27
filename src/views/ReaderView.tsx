import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, TextAnchor } from '../types';
import type { JournalStore } from '../useJournal';
import { Icon } from '../components/icons';
import { ReaderSettingsPanel } from '../components/ReaderSettingsPanel';
import { MarginComposer, SelectionToolbar } from '../components/MarginComposer';
import { loadBookBytes, saveBookBytes } from '../lib/bookFiles';
import { downloadBookBytes } from '../lib/api';
import { chapterHtml, closeBook, openBook, resolvePath } from '../lib/epubBook';
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
import {
  pageForElement,
  pageForTextFraction,
  pageToFraction,
  paginate,
  showPage,
  textFractionAtPage,
} from '../lib/pagination';
import type { PageGeometry } from '../lib/pagination';
import { useReaderSettings } from '../lib/useReaderSettings';
import { buildAnchor, paintHighlights } from '../lib/anchors';

/** The centre band of a page toggles the chrome, as a fraction of the width. */
const CENTRE_BAND = { start: 0.375, end: 0.625 };
/** A pointer that travels further than this is a drag, not a tap. */
const TAP_SLOP_PX = 15;
/** A horizontal drag this long is a swipe. */
const SWIPE_MIN_PX = 48;

/**
 * The reading surface.
 *
 * A chapter renders as one document in a sandboxed frame; the pagination module
 * carves it into pages. Position is stored as (chapter, fraction of the
 * chapter's text), so it survives a reflow, a font change and a reload.
 *
 * Navigation follows the conventions readers expect from Readest, foliate and
 * Apple Books:
 *
 *   - tap the left or right third of the page to turn it, the middle to toggle
 *     the chrome; drag horizontally to swipe
 *   - the header and footer overlay the page instead of shrinking it, so a page
 *     never reflows just because the chrome appeared
 *   - links inside the book are handled by the reader, never by the frame, so an
 *     internal link navigates instead of replacing the page with a 404
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
  const [geometry, setGeometry] = useState<PageGeometry | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [stageWidth, setStageWidth] = useState(0);

  /** The passage the reader has selected, and where to float the toolbar. */
  const [selection, setSelection] = useState<{
    anchor: TextAnchor;
    quote: string;
    x: number;
    y: number;
    /** Set when the selection came from clicking an existing highlight. */
    existingId?: string;
  } | null>(null);
  const [composerNote, setComposerNote] = useState<string | null>(null);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);

  /** Where to land once the next chapter has laid out. */
  const pendingFraction = useRef(0);
  /** Element id to land on once the chapter has laid out. */
  const pendingFragment = useRef<string | null>(null);
  const geometryRef = useRef<PageGeometry | null>(null);
  /** Chapter currently rendered in the frame, for telling a reflow from a jump. */
  const renderedChapter = useRef<number | null>(null);
  const pageIndexRef = useRef(0);
  const pointerStart = useRef<{ x: number; y: number; t: number } | null>(null);
  /** Accumulated wheel delta, so a trackpad flick turns one page, not six. */
  const wheelAccum = useRef(0);
  const wheelLock = useRef(0);
  /** Late-bound handlers: the frame outlives the render that created it. */
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const linkHandlerRef = useRef<(href: string) => void>(() => {});
  const gestureHandlerRef = useRef<(direction: 1 | -1 | 0, clientX: number) => void>(() => {});
  const turnPageRef = useRef<(direction: 1 | -1) => void>(() => {});
  const selectionHandlerRef = useRef<() => void>(() => {});
  const highlightClickRef = useRef<(id: string) => void>(() => {});
  const paintRef = useRef<() => void>(() => {});
  /** Whether the composer is open, without making the frame handler depend on it. */
  const composerNoteRef = useRef<string | null>(null);
  /** The live selection inside the book, kept across the toolbar's own clicks. */
  const pendingRange = useRef<Range | null>(null);

  const total = parsed?.chapters.length ?? 0;
  pageIndexRef.current = pageIndex;

  /** Quotes taken from this book, which the reader paints over the text. */
  const bookQuotes = useMemo(
    () => store.data.quotes.filter((q) => q.bookId === book.id && !q.deletedAt && q.anchor),
    [store.data.quotes, book.id],
  );

  /* ── open the archive ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        let blob = await loadBookBytes(book.id);
        if (!blob && book.file?.sha256) {
          // Not cached here but synced: pull the cloud copy once and keep it.
          const fetched = await downloadBookBytes(book.id, book.file.sha256);
          if (fetched.ok) {
            await saveBookBytes(book.id, fetched.data);
            blob = await loadBookBytes(book.id);
          }
        }
        if (!blob) {
          if (!cancelled) {
            setError(
              book.file
                ? 'The file is not in this browser and the cloud copy could not be fetched. Try again from somewhere online.'
                : 'This book has no file attached. Add an EPUB from the book page.',
            );
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
    // Reopens only when a different book is selected.
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

  /* ── how many columns a page holds ── */
  // Measured from the live stage width, so "auto" reacts to the window without
  // the reader having to guess at a breakpoint.
  const columns = useMemo<1 | 2>(
    () =>
      resolveColumns(
        settings.columns,
        stageWidth || window.innerWidth,
        typography.fontSizePx,
        typography.measureCh,
      ),
    [settings.columns, stageWidth, typography.fontSizePx, typography.measureCh],
  );

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

  /* ── measure, then place the reader ── */
  const repaginate = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const stage = stageRef.current;
    if (!doc || !doc.body || !stage) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width === 0 || height === 0) return;

    const next = paginate(doc, width, height, columns);
    setGeometry(next);
    geometryRef.current = next;

    // Land on the requested place: a fragment if we have one, else the stored
    // fraction. Resolving through the text keeps the reader on the same words
    // even though the page count has changed underneath them.
    let target: number;
    if (pendingFragment.current) {
      const el = doc.getElementById(pendingFragment.current);
      target = el ? pageForElement(doc, el, next) : resolveFraction(pendingFraction.current);
      pendingFragment.current = null;
    } else {
      target = resolveFraction(pendingFraction.current);
    }
    pendingFraction.current = 0;

    setPageIndex(target);
    pageIndexRef.current = target;
    showPage(doc, target, next);
    setReady(true);
    // Highlights are markup inside the flowing text, so a re-measure has to be
    // followed by a repaint or they would sit on the wrong words.
    paintRef.current();

    function resolveFraction(fraction: number): number {
      if (fraction <= 0) return 0;
      // A fraction of 1 means "the end of the chapter", used when turning back.
      if (fraction >= 1) return Math.max(0, next.pageCount - 1);
      return pageForTextFraction(doc!, fraction, next);
    }
  }, [columns]);

  /* ── render the chapter ── */
  useEffect(() => {
    if (!parsed || !bufferRef.current) return;
    const chapter = parsed.chapters[chapterIndex];
    if (!chapter) return;
    let cancelled = false;

    // A reflow of the same chapter (a font change, a new column count) must not
    // lose the reader's place: record the text fraction before the old document
    // is thrown away. A chapter change brings its own pending fraction.
    const doc = frameRef.current?.contentDocument;
    const current = geometryRef.current;
    if (renderedChapter.current === chapterIndex && doc && current) {
      pendingFraction.current = textFractionAtPage(doc, pageIndexRef.current, current);
    }
    renderedChapter.current = chapterIndex;
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

  /* ── inside the book: keys, taps, swipes, links ── */
  const attachFrameHandlers = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!doc || !frame) return;

    doc.addEventListener('keydown', (event) => keyHandlerRef.current(event));

    // A mouse wheel is a page turn in a paginated book, not a scroll: there is
    // nowhere to scroll to. The delta is accumulated so a trackpad flick is one
    // page rather than one page per event.
    doc.addEventListener(
      'wheel',
      (event) => {
        // A mostly-horizontal wheel turns sideways.
        const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
        const delta = horizontal ? event.deltaX : event.deltaY;
        if (delta === 0) return;
        event.preventDefault();
        const now = Date.now();
        if (now < wheelLock.current) return;
        wheelAccum.current += delta;
        if (Math.abs(wheelAccum.current) < 40) return;
        turnPageRef.current(wheelAccum.current > 0 ? 1 : -1);
        wheelAccum.current = 0;
        wheelLock.current = now + 220;
      },
      { passive: false },
    );

    doc.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointerStart.current = { x: event.clientX, y: event.clientY, t: Date.now() };
    });

    doc.addEventListener('pointerup', (event) => {
      const start = pointerStart.current;
      pointerStart.current = null;
      if (!start) return;
      // A text selection is the reader's, not ours to override.
      const selection = doc.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const elapsed = Date.now() - start.t;
      if (elapsed < 900 && Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
        gestureHandlerRef.current(dx < 0 ? 1 : -1, event.clientX);
        return;
      }
      if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) return;
      gestureHandlerRef.current(0, event.clientX);
    });

    // Selecting text raises the annotation toolbar. `selectionchange` is the
    // only event that reliably fires for a drag-selection inside a frame.
    let selectionTimer: number | undefined;
    doc.addEventListener('selectionchange', () => {
      if (selectionTimer) window.clearTimeout(selectionTimer);
      // Wait for the pointer to settle, or the toolbar would jump mid-drag.
      selectionTimer = window.setTimeout(() => selectionHandlerRef.current(), 140);
    });

    // Clicking an existing highlight re-opens its note.
    doc.addEventListener('click', (event) => {
      const mark = (event.target as Element | null)?.closest?.('mark.reader-highlight');
      if (!mark) return;
      const id = mark.getAttribute('data-highlight-id');
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      highlightClickRef.current(id);
    });

    // The reader owns navigation; the frame itself must never navigate away.
    doc.addEventListener('click', (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      if (/^(https?:|mailto:)/i.test(href)) return;
      if (href.startsWith('#')) {
        const el = doc.getElementById(href.slice(1));
        if (el) {
          const current = geometryRef.current;
          if (current) {
            const page = pageForElement(doc, el, current);
            setPageIndex(page);
            pageIndexRef.current = page;
            showPage(doc, page, current);
            persistPosition(chapterIndex, textFractionAtPage(doc, page, current));
          }
        }
        return;
      }
      linkHandlerRef.current(href);
    });
  }, [chapterIndex, persistPosition]);

  /**
   * Paints this chapter's saved notes over the text.
   *
   * Runs after every pagination, because pagination re-lays out the DOM and a
   * highlighter that survives a font change has to be repainted from its anchor
   * rather than kept as markup.
   */
  const paintChapterHighlights = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const inChapter = bookQuotes
      .map((q) => ({ quote: q, anchor: q.anchor! }))
      .filter(({ anchor }) => anchor.chapter === chapterIndex);
    try {
      paintHighlights(
        doc,
        inChapter.map(({ quote, anchor }) => ({
          id: quote.id,
          anchor,
          tone: quote.note ? 'note' : 'quote',
        })),
      );
    } catch {
      // Highlighting is decoration over the text. A passage that cannot be
      // re-anchored must never take the reader down with it.
    }
  }, [bookQuotes, chapterIndex]);

  /** Reads the current selection and offers the toolbar over it. */
  const handleSelectionChange = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const stage = stageRef.current;
    if (!frame || !doc || !stage) return;
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      // A collapsed selection means the reader clicked away: dismiss the offer.
      if (!composerNoteRef.current) setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      if (!composerNoteRef.current) setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    // Only selections inside the chapter's text can be anchored.
    const content = doc.getElementById('book-content');
    if (!content || !content.contains(range.startContainer) || !content.contains(range.endContainer)) {
      return;
    }
    const anchor = buildAnchor(doc, chapterIndex, range);
    if (!anchor) return;
    // Toolbar position: above the selection, in app coordinates.
    const rect = range.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const x = frameRect.left - stageRect.left + rect.left + rect.width / 2;
    const y = frameRect.top - stageRect.top + rect.top;
    pendingRange.current = range.cloneRange();
    setSelection({ anchor, quote: text, x, y });
  }, [chapterIndex]);

  /** Re-opens the note behind an existing highlight. */
  const handleHighlightClick = useCallback(
    (id: string) => {
      const quote = bookQuotes.find((q) => q.id === id);
      if (!quote) return;
      setSelection({
        anchor: quote.anchor!,
        quote: quote.text,
        x: 0,
        y: 0,
        existingId: quote.id,
      });
      setComposerNote(quote.note ?? '');
      setChromeVisible(false);
    },
    [bookQuotes],
  );

  const onFrameLoad = useCallback(() => {
    // Give the frame a tick for fonts and images before measuring.
    window.setTimeout(() => {
      repaginate();
      paintChapterHighlights();
      attachFrameHandlers();
    }, 60);
  }, [repaginate, paintChapterHighlights, attachFrameHandlers]);

  /* ── stage size, for "auto" columns and for reflowing on resize ── */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let timer: number | undefined;
    let lastWidth = stage.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = stage.clientWidth;
      setStageWidth(width);
      if (width === lastWidth) return;
      lastWidth = width;
      if (timer) window.clearTimeout(timer);
      // Re-measure after the resize settles, keeping the reader's place.
      timer = window.setTimeout(() => {
        const doc = frameRef.current?.contentDocument;
        const current = geometryRef.current;
        if (doc && current) {
          pendingFraction.current = textFractionAtPage(doc, pageIndexRef.current, current);
        }
        repaginate();
      }, 160);
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, [repaginate]);

  /**
   * Chrome is hidden only by a deliberate act — a centre tap, Escape, or a
   * swipe — never by an idle timer. A timer would fade the controls out while
   * the reader is still deciding, and Readest deliberately has none.
   */
  const toggleChrome = useCallback(() => {
    setChromeVisible((visible) => !visible);
    setTocOpen(false);
    setSettingsOpen(false);
  }, []);

  const goToPage = useCallback(
    (next: number) => {
      const current = geometryRef.current;
      const doc = frameRef.current?.contentDocument;
      if (!current || !doc) return;
      const clamped = Math.max(0, Math.min(current.pageCount - 1, next));
      setPageIndex(clamped);
      pageIndexRef.current = clamped;
      showPage(doc, clamped, current);
      persistPosition(chapterIndex, textFractionAtPage(doc, clamped, current));
    },
    [chapterIndex, persistPosition],
  );

  const goToChapter = useCallback(
    (index: number, fraction = 0, fragment: string | null = null) => {
      if (!parsed) return;
      const clamped = Math.max(0, Math.min(parsed.chapters.length - 1, index));
      pendingFraction.current = fraction;
      pendingFragment.current = fragment;
      setTocOpen(false);
      persistPosition(clamped, fraction);
      if (clamped === chapterIndex) {
        // Already there: resolve the anchor in place.
        repaginate();
        return;
      }
      setChapterIndex(clamped);
    },
    [parsed, chapterIndex, persistPosition, repaginate],
  );

  const turnPage = useCallback(
    (direction: 1 | -1) => {
      const current = geometryRef.current;
      if (!current || !parsed) return;
      const next = pageIndexRef.current + direction;

      if (next < 0) {
        if (chapterIndex > 0) {
          pendingFraction.current = 1;
          persistPosition(chapterIndex - 1, 1);
          setChapterIndex(chapterIndex - 1);
        }
        return;
      }
      if (next >= current.pageCount) {
        if (chapterIndex < parsed.chapters.length - 1) {
          pendingFraction.current = 0;
          persistPosition(chapterIndex + 1, 0);
          setChapterIndex(chapterIndex + 1);
        }
        return;
      }
      goToPage(next);
    },
    [parsed, chapterIndex, goToPage, persistPosition],
  );

  /** A relative link inside the book: the same chapter, or another one. */
  const followLink = useCallback(
    (href: string) => {
      if (!parsed) return;
      const [rawPath, fragment] = href.split('#');
      if (!rawPath && fragment) {
        const doc = frameRef.current?.contentDocument;
        const current = geometryRef.current;
        const el = doc?.getElementById(fragment);
        if (doc && current && el) {
          const page = pageForElement(doc, el, current);
          setPageIndex(page);
          pageIndexRef.current = page;
          showPage(doc, page, current);
          persistPosition(chapterIndex, textFractionAtPage(doc, page, current));
        }
        return;
      }
      const chapter = parsed.chapters[chapterIndex];
      if (!chapter) return;
      const baseDir = chapter.path.includes('/')
        ? chapter.path.slice(0, chapter.path.lastIndexOf('/') + 1)
        : '';
      const resolved = resolvePath(baseDir, rawPath);
      const target = parsed.chapters.findIndex((c) => c.path === resolved);
      // A link outside the spine is not navigable from here, and silently
      // replacing the page with a 404 would be worse than doing nothing.
      if (target < 0) return;
      goToChapter(target, 0, fragment || null);
    },
    [parsed, chapterIndex, goToChapter, persistPosition],
  );

  /* ── gestures: tap zones and swipes ── */
  useEffect(() => {
    gestureHandlerRef.current = (direction, clientX) => {
      const stage = stageRef.current;
      const current = geometryRef.current;
      if (!stage) return;
      if (direction !== 0) {
        turnPage(direction);
        return;
      }
      // Zones are measured on the column the tap landed in, not on the whole
      // page. In a two-column spread the centre of the spread is the gutter and
      // is neutral, so each column keeps its own left/centre/right thirds.
      const rect = stage.getBoundingClientRect();
      const lanes = current?.columnsPerPage ?? 1;
      const laneWidth = 1 / lanes;
      // Position within the column that was tapped.
      const within = ((clientX - rect.left) / rect.width) % laneWidth;
      const ratio = within / laneWidth;
      if (ratio < CENTRE_BAND.start) {
        turnPage(-1);
      } else if (ratio > CENTRE_BAND.end) {
        turnPage(1);
      } else {
        // The middle of the page is the chrome toggle, never a page turn.
        toggleChrome();
      }
    };
  }, [turnPage, toggleChrome]);

  /* ── keyboard ── */
  // Keys must work whether focus is in the app or inside the book: a reader
  // clicks the text far more often than the chrome, and a keydown inside the
  // iframe never reaches the parent window.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else if (tocOpen) setTocOpen(false);
        else onBack();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 't') {
        setTocOpen((open) => !open);
        setSettingsOpen(false);
        setChromeVisible(true);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        turnPage(1);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        turnPage(-1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        goToChapter(chapterIndex, 0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        goToChapter(chapterIndex, 1);
      }
    };
    keyHandlerRef.current = onKey;
    linkHandlerRef.current = followLink;
    turnPageRef.current = turnPage;
    selectionHandlerRef.current = handleSelectionChange;
    highlightClickRef.current = handleHighlightClick;
    paintRef.current = paintChapterHighlights;
    composerNoteRef.current = composerNote;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    turnPage,
    onBack,
    tocOpen,
    settingsOpen,
    goToChapter,
    chapterIndex,
    followLink,
    handleSelectionChange,
    handleHighlightClick,
    paintChapterHighlights,
    composerNote,
  ]);

  /* ── saving what the reader wrote ── */
  /** Progress through the whole book at the current page, 0–1. */
  const currentPercent = useCallback((): number | undefined => {
    if (!total) return undefined;
    const within = geometry ? pageToFraction(pageIndex, geometry.pageCount) : 0;
    return Math.min(1, Math.max(0, (chapterIndex + within) / total));
  }, [total, chapterIndex, geometry, pageIndex]);

  const saveQuote = useCallback(() => {
    if (!selection) return;
    if (selection.existingId) {
      setSelection(null);
      return;
    }
    store.addQuotes(book.id, [
      { text: selection.quote, anchor: selection.anchor, percent: currentPercent() },
    ]);
    setSelection(null);
    // The highlight appears via the effect below, which runs with the record
    // already in the store. Painting here as well would race it: this closure
    // still sees the pre-save quote list, so it would clear the highlight the
    // effect had just painted.
  }, [selection, store, book.id, currentPercent]);

  const saveNote = useCallback(
    (note: string) => {
      if (!selection) return;
      if (selection.existingId) {
        store.updateQuote(selection.existingId, { note: note || undefined });
      } else {
        store.addQuotes(book.id, [
          {
            text: selection.quote,
            note: note || undefined,
            anchor: selection.anchor,
            percent: currentPercent(),
          },
        ]);
      }
      setSelection(null);
      setComposerNote(null);
    },
    [selection, store, book.id, currentPercent],
  );

  const deleteNote = useCallback(() => {
    if (!selection?.existingId) return;
    store.deleteQuote(selection.existingId);
    setSelection(null);
    setComposerNote(null);
  }, [selection, store]);

  const copySelection = useCallback(async () => {
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(selection.quote);
    } catch {
      // Clipboard access can be refused; the selection is still on screen.
    }
    setSelection(null);
  }, [selection]);

  /* Keep the highlights in step with the stored quotes. */
  useEffect(() => {
    paintChapterHighlights();
  }, [paintChapterHighlights]);

  /* ── progress ── */
  const percent = useMemo(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc && geometry) {
      const fraction = textFractionAtPage(doc, pageIndex, geometry);
      return bookProgress({ chapter: chapterIndex, fraction, updatedAt: 0 }, total || 1);
    }
    return bookProgress(book.position ?? null, total || 1);
    // `ready` and `chapterIndex` change when the document does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.position, chapterIndex, pageIndex, geometry, total, ready]);

  const opening = loading || (!ready && !error);

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
    <section
      className={chromeVisible ? 'reader chrome-visible' : 'reader'}
      aria-label={`Reading ${book.title}`}
      data-theme-reader={settings.theme}
    >
      <header className="reader-bar" inert={!chromeVisible}>
        <button type="button" className="reader-icon-btn" aria-label="Back to book page" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div className="reader-title">
          <span className="reader-book-title">{book.title}</span>
          {parsed && (
            <span className="reader-chapter">
              {chapterLabel({ chapter: chapterIndex, fraction: 0, updatedAt: 0 }, parsed.chapters.length)}
              {geometry ? ` · page ${pageIndex + 1} of ${geometry.pageCount}` : ''}
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
              setTocOpen((open) => !open);
              setSettingsOpen(false);
              setChromeVisible(true);
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
              setSettingsOpen((open) => !open);
              setTocOpen(false);
              setChromeVisible(true);
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
                      aria-current={targetIndex === chapterIndex ? 'location' : undefined}
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
        {/* The annotation toolbar, floated over the selection it acts on. */}
        {selection && !composerNote && !selection.existingId && (
          <SelectionToolbar
            x={selection.x}
            y={selection.y}
            onNote={() => setComposerNote('')}
            onQuote={saveQuote}
            onCopy={copySelection}
          />
        )}

        {/* The note being written or edited. A composer for an existing note is
            opened by clicking its highlight, so it shows without a toolbar. */}
        {(composerNote !== null || selection?.existingId) && selection && (
          <MarginComposer
            quote={selection.quote}
            initialNote={
              selection.existingId
                ? (bookQuotes.find((q) => q.id === selection.existingId)?.note ?? '')
                : composerNote ?? ''
            }
            onSave={saveNote}
            onDelete={selection.existingId ? deleteNote : undefined}
            onClose={() => {
              setSelection(null);
              setComposerNote(null);
            }}
          />
        )}

        {opening && !loading && (
          <div className="reader-loading" role="status">
            <p className="muted">Setting the page…</p>
          </div>
        )}
        {/* Mouse-only: a thin lid at each edge reveals the chrome without the
            reader having to find the centre tap zone. */}
        <button
          type="button"
          className="reader-edge-lid top"
          aria-label="Show reading controls"
          tabIndex={-1}
          onMouseEnter={() => setChromeVisible(true)}
          onClick={() => setChromeVisible(true)}
        />
        <button
          type="button"
          className="reader-edge-lid bottom"
          aria-label="Show reading controls"
          tabIndex={-1}
          onMouseEnter={() => setChromeVisible(true)}
          onClick={() => setChromeVisible(true)}
        />
      </div>

      <footer className="reader-foot" inert={!chromeVisible}>
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
        <button type="button" className="reader-nav-btn" aria-label="Next page" onClick={() => turnPage(1)}>
          <Icon name="chevronDown" size={14} />
        </button>
      </footer>
    </section>
  );
}
