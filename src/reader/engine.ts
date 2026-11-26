import { buildOverrideCss } from './override';
import type { BookTypography, ReaderSettings } from './typography';

/**
 * The engine boundary (READER-DESIGN §6.1): everything else talks to this
 * adapter, never to foliate-js directly, so an engine swap touches one file.
 *
 * The vendored View is a custom element; its APIs are loosely typed here on
 * purpose — the adapter owns the narrow surface the app actually uses.
 */

export interface TocItem {
  label: string;
  href: string;
  subItems?: TocItem[];
}

export interface RelocateInfo {
  cfi: string;
  /** 0–1 through the whole book, when known. */
  fraction: number | null;
  /** Examples: "ch. 4" crumbs come from the book's own TOC. */
  tocLabel: string | null;
}

export interface ChapterDoc {
  doc: Document;
  index: number;
}

type RelocateHandler = (info: RelocateInfo) => void;
type LoadHandler = (chapter: ChapterDoc) => void;

interface FoliateView extends HTMLElement {
  open(book: Blob): Promise<void>;
  close(): void;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  goTo(target: string): Promise<unknown>;
  goToFraction(fraction: number): Promise<unknown>;
  goToTextStart(): Promise<unknown>;
  initToc(): void;
  book: {
    toc: TocItem[];
    metadata?: { title?: string; author?: string; language?: string };
    dir?: string;
  } | null;
  renderer: {
    setStyles(css: string): void;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    addEventListener(type: string, listener: EventListener): void;
  } | null;
}

/** EPUB ZIP is a ZIP of arbitrary HTML; nothing over this is even parsed. */
export const MAX_EPUB_BYTES = 100 * 1024 * 1024;

export class ReaderEngine {
  private view: FoliateView | null = null;
  private css = '';
  private relocateHandler: RelocateHandler | null = null;
  private loadHandler: LoadHandler | null = null;
  private boundRelocate = (event: Event) => {
    const detail = (event as CustomEvent).detail as {
      cfi?: string;
      fraction?: number;
      tocItem?: { label?: string } | null;
    };
    this.relocateHandler?.({
      cfi: detail.cfi ?? '',
      fraction: typeof detail.fraction === 'number' ? detail.fraction : null,
      tocLabel: detail.tocItem?.label ?? null,
    });
  };
  private boundLoad = (event: Event) => {
    const detail = (event as CustomEvent).detail as { doc: Document; index: number };
    this.enforceSandbox(detail.doc);
    this.loadHandler?.({ doc: detail.doc, index: detail.index });
  };

  get title(): string {
    return this.view?.book?.metadata?.title ?? '';
  }

  /** OPF metadata picked out of the book, useful for the journaling side. */
  get metadata(): { title?: string; author?: string; language?: string } {
    return this.view?.book?.metadata ?? {};
  }

  async open(
    container: HTMLElement,
    blob: Blob,
    handlers: { onRelocate: RelocateHandler; onLoad?: LoadHandler },
  ): Promise<TocItem[]> {
    this.relocateHandler = handlers.onRelocate;
    this.loadHandler = handlers.onLoad ?? null;
    if (blob.size > MAX_EPUB_BYTES) {
      throw new Error('This book is over 100 MB — larger than Marginalia reads');
    }
    const view = document.createElement('foliate-view') as FoliateView;
    this.view = view;
    view.addEventListener('relocate', this.boundRelocate);
    container.appendChild(view);
    await view.open(blob);
    // The paginator (inside the shadow root) fires 'load' for each chapter
    // document; View relays it as a DOM event reaching us here.
    view?.addEventListener('load', this.boundLoad);
    this.view?.renderer?.addEventListener?.('load', this.boundLoad as EventListener);
    view.initToc();
    if (this.css) view.renderer?.setStyles(this.css);
    this.enforceSandbox();
    return this.flattenToc(view.book?.toc ?? []);
  }

  private flattenToc(toc: TocItem[]): TocItem[] {
    return toc;
  }

  /**
   * Chapter documents are stripped of script and given a strict CSP as
   * defence in depth; the iframes themselves carry `allow-same-origin`
   * only — that is enforced in the vendored paginator (design §6.2).
   */
  private enforceSandbox(doc?: Document): void {
    if (doc) {
      for (const script of doc.querySelectorAll('script')) script.remove();
      const CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data: blob:";
      // The sandboxed iframe with allow-same-origin (no allow-scripts)
      // cannot fetch or run anything; meta CSP is depth, not the wall.
      const meta = doc.createElement('meta');
      meta.setAttribute('http-equiv', 'Content-Security-Policy');
      meta.setAttribute('content', CSP);
      doc.head?.prepend(meta);
    }
  }

  setTypography(t: BookTypography, settings: ReaderSettings): void {
    this.css = buildOverrideCss(t, settings.mode);
    this.view?.renderer?.setStyles?.(this.css);
  }

  setColumns(count: 1 | 2 | 'auto'): void {
    const renderer = this.view?.renderer;
    if (!renderer) return;
    // The paginator reads the `max-column-count` attribute; 2 columns =
    // 2 when the viewport is wide enough, 1 = force a single column.
    if (count === 'auto') renderer.removeAttribute('max-column-count');
    else renderer.setAttribute('max-column-count', String(count));
    if ('maxColumnCount' in renderer) {
      (renderer as unknown as { maxColumnCount: number }).maxColumnCount = count === 'auto' ? 2 : count;
    }
  }

  setAnimated(on: boolean): void {
    const renderer = this.view?.renderer;
    if (!renderer) return;
    if (on) renderer.setAttribute('animated', '');
    else renderer.removeAttribute('animated');
  }

  async next(): Promise<void> {
    await this.view?.next();
  }

  async prev(): Promise<void> {
    await this.view?.prev();
  }

  async goTo(cfi: string): Promise<void> {
    if (!cfi) return;
    try {
      await this.view?.goTo(cfi);
    } catch {
      // A stale CFI (unusual chapter layout) must not crash the reader.
    }
  }

  async goToFraction(fraction: number): Promise<void> {
    await this.view?.goToFraction(fraction);
  }

  async goToStart(): Promise<void> {
    await this.view?.goToTextStart();
  }

  destroy(): void {
    if (!this.view) return;
    this.view.removeEventListener('relocate', this.boundRelocate);
    this.view.removeEventListener('load', this.boundLoad);
    try {
      this.view.close();
    } catch {
      // Already torn down by the container.
    }
    this.view.remove();
    this.view = null;
    this.relocateHandler = null;
    this.loadHandler = null;
    this.css = '';
  }
}


