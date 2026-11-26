/**
 * Pagination.
 *
 * A chapter is one tall document of text blocks. This module carves that
 * document into fixed-size pages, and maps a page back to a character in the
 * chapter so a reflow can land on the very same words.
 *
 * ## Why the geometry is what it is
 *
 * The obvious implementation — set `column-width`, read `scrollWidth`, divide —
 * breaks, because the browser silently clamps a column that is wider than the
 * box left over after padding. The stride the code then uses no longer matches
 * the pitch the browser rendered, so every page after the first is offset by a
 * growing amount until the text has slid out of the frame entirely.
 *
 * So the geometry guarantees an exact fit instead of measuring and hoping:
 *
 *   page    = root content width         (the translate stride)
 *   column  = page / columnsPerPage      (exactly divides the page)
 *   gap     = 0                          (columns are contiguous)
 *
 * Because columns are contiguous and divide the page exactly, page *n* always
 * begins on a column boundary. The visual gutter between two columns is not a
 * `column-gap` — it is inline padding on the text blocks, which keeps the
 * arithmetic exact while still leaving whitespace between the print.
 *
 * The vertical axis is constrained instead: `body` is exactly the page height
 * with `column-fill: auto`, so the browser fills a column to the page height and
 * flows the rest into the next one.
 *
 * ## Anchoring
 *
 * A page index dies with the layout; a character offset does not. Positions are
 * stored as (chapter, fraction of the chapter's text), and the fraction is
 * resolved back through a DOM range to a page. That is what makes a font-size
 * change or a window resize stay on the same sentence instead of snapping back
 * to page one.
 */

export interface PageGeometry {
  pageCount: number;
  /** Width of one page in CSS px. Also the horizontal translate stride. */
  pageWidth: number;
  columnWidth: number;
  columnsPerPage: 1 | 2;
  /** Left edge of the column flow, in the document's untransformed space. */
  contentLeft: number;
}

/** Space between the two columns of a spread, applied as text-block padding. */
export const COLUMN_GUTTER = 48;
const MIN_PAGE_WIDTH = 200;
/** Sub-pixel slack: browsers lay out to fractions of a pixel. */
const SLACK = 0.5;

function fallbackGeometry(viewportWidth: number): PageGeometry {
  return {
    pageCount: 1,
    pageWidth: viewportWidth,
    columnWidth: viewportWidth,
    columnsPerPage: 1,
    contentLeft: 0,
  };
}

/**
 * Runs `fn` with the page transform neutralised.
 *
 * Every rect read must be in the untransformed flow, or a measurement taken on
 * page 4 would be shifted left by three page widths.
 */
function untransformed<T>(doc: Document, fn: () => T): T {
  const body = doc.body;
  if (!body) return fn();
  const previous = body.style.transform;
  body.style.transform = 'none';
  // Force a synchronous reflow so the rects read below are untransformed.
  void body.offsetWidth;
  try {
    return fn();
  } finally {
    body.style.transform = previous;
    void body.offsetWidth;
  }
}

function rectsOf(target: Text | Element): DOMRect[] {
  const doc = target.ownerDocument;
  if (!doc) return [];
  const range = doc.createRange();
  range.selectNodeContents(target);
  return Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
}

function nonEmptyRects(range: Range): DOMRect[] {
  return Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
}

/**
 * Total inline extent of the column flow.
 *
 * A range over the whole body yields one rect per line fragment, across every
 * column, so the rightmost edge is the true end of the flow. This is the only
 * reliable measure: `scrollWidth` on an `overflow: visible` element reports the
 * padding box, not the overflowing columns, and reading `scrollHeight` gives the
 * height of column one.
 */
function flowExtent(doc: Document): { width: number; left: number } {
  const body = doc.body;
  if (!body) return { width: 0, left: 0 };
  const bodyRect = body.getBoundingClientRect();
  const range = doc.createRange();
  range.selectNodeContents(body);
  let right = bodyRect.left;
  for (const rect of range.getClientRects()) {
    if (rect.width > 0 || rect.height > 0) right = Math.max(right, rect.right);
  }
  return { width: right - bodyRect.left, left: bodyRect.left };
}

/**
 * Lays the document out in columns and reports the page geometry.
 *
 * Call after the content is in the DOM and fonts are ready, since both change
 * how much text fits on a page.
 */
export function paginate(
  doc: Document,
  viewportWidth: number,
  viewportHeight: number,
  columnsPerPage: 1 | 2 = 1,
): PageGeometry {
  const root = doc.documentElement;
  const body = doc.body;
  const view = doc.defaultView;
  if (!root || !body || !view) return fallbackGeometry(viewportWidth);

  const columns: 1 | 2 = columnsPerPage === 2 ? 2 : 1;

  // The column container is the body, and it fills the frame exactly: no
  // padding, no margin. So one page is the frame's content box, and the
  // translate stride and the column pitch are the same number by construction.
  const pageWidth = Math.max(MIN_PAGE_WIDTH, root.clientWidth || viewportWidth);
  const pageHeight = Math.max(1, root.clientHeight || viewportHeight);
  const columnWidth = pageWidth / columns;

  const extent = untransformed(doc, () => {
    body.style.setProperty('height', `${pageHeight}px`);
    body.style.setProperty('column-width', `${columnWidth}px`);
    body.style.setProperty('column-gap', '0px');
    body.style.setProperty('column-fill', 'auto');
    body.style.setProperty('overflow', 'visible');
    // The gutter is padding on the text blocks, not a column gap, so the
    // columns stay exactly one page-width apart.
    root.style.setProperty('--reader-gutter', columns === 2 ? `${COLUMN_GUTTER / 2}px` : '0px');
    // Force the column layout before measuring it.
    void body.offsetWidth;
    void body.scrollHeight;
    return flowExtent(doc);
  });

  const pageCount = Math.max(1, Math.ceil((extent.width - SLACK) / pageWidth));

  return {
    pageCount,
    pageWidth,
    columnWidth,
    columnsPerPage: columns,
    contentLeft: extent.left,
  };
}

/**
 * Moves the paged document to a page index.
 *
 * The stride is the page width, an exact multiple of the column pitch by
 * construction, so page *n* always lands on a column boundary.
 */
export function showPage(
  doc: Document,
  pageIndex: number,
  geometry: PageGeometry,
  animate = false,
): void {
  const body = doc.body;
  if (!body) return;
  const reduced = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  body.style.setProperty('transform', `translateX(${-pageIndex * geometry.pageWidth}px)`);
  body.style.setProperty(
    'transition',
    animate && !reduced ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
  );
}

/* ── page ↔ fraction, for the stored position ── */

export function pageToFraction(pageIndex: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  return Math.min(1, Math.max(0, pageIndex / (pageCount - 1)));
}

export function fractionToPage(fraction: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  return Math.min(pageCount - 1, Math.max(0, Math.round(fraction * (pageCount - 1))));
}

/* ── text anchors ── */

function textWalker(doc: Document): TreeWalker | null {
  const body = doc.body;
  if (!body) return null;
  return doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
}

/** Characters of reading text in the document. */
export function textLength(doc: Document): number {
  const walker = textWalker(doc);
  if (!walker) return 0;
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    total += node.nodeValue?.length ?? 0;
  }
  return total;
}

/**
 * Smallest offset in `node` whose text starts at or after `x`.
 *
 * A character's left edge is non-decreasing in the offset, so a binary search
 * finds the first character belonging to the column that starts at `x`.
 */
function bisectLeftEdge(doc: Document, node: Text, x: number): number {
  const length = node.nodeValue?.length ?? 0;
  const range = doc.createRange();
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    range.setStart(node, mid);
    range.setEnd(node, length);
    const rects = nonEmptyRects(range);
    const left = rects.length ? rects[0].left : Infinity;
    if (left < x - SLACK) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Character offset of the first character visible on a page.
 *
 * Document order is column order in a multi-column flow, so taking the first
 * character inside the page's x-range gives the text at the top of the page.
 */
export function textOffsetAtPage(doc: Document, pageIndex: number, geometry: PageGeometry): number {
  const start = geometry.contentLeft + pageIndex * geometry.pageWidth;
  const end = start + geometry.pageWidth;
  return untransformed(doc, () => {
    const walker = textWalker(doc);
    if (!walker) return 0;
    let before = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      const length = text.nodeValue?.length ?? 0;
      if (length === 0) continue;
      const rects = rectsOf(text);
      if (rects.length === 0) {
        before += length;
        continue;
      }
      const touches = rects.some((r) => r.right > start + SLACK && r.left < end - SLACK);
      if (!touches) {
        before += length;
        continue;
      }
      const left = Math.min(...rects.map((r) => r.left));
      if (left >= start - SLACK) return before;
      return before + bisectLeftEdge(doc, text, start);
    }
    return Math.max(0, before - 1);
  });
}

/** Locates a document-wide character offset. */
function locateOffset(doc: Document, offset: number): { node: Text; local: number } | null {
  const walker = textWalker(doc);
  if (!walker) return null;
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const length = text.nodeValue?.length ?? 0;
    if (length === 0) continue;
    if (offset < seen + length) return { node: text, local: Math.max(0, offset - seen) };
    seen += length;
  }
  return null;
}

/** The page holding a character offset. */
export function pageForTextOffset(doc: Document, offset: number, geometry: PageGeometry): number {
  if (geometry.pageCount <= 1) return 0;
  return untransformed(doc, () => {
    const target = locateOffset(doc, offset);
    if (!target) return geometry.pageCount - 1;
    const range = doc.createRange();
    const length = target.node.nodeValue?.length ?? 0;
    const end = Math.min(length, target.local + 1);
    if (end <= target.local) return geometry.pageCount - 1;
    range.setStart(target.node, target.local);
    range.setEnd(target.node, end);
    const rects = nonEmptyRects(range);
    if (rects.length === 0) return geometry.pageCount - 1;
    const left = Math.min(...rects.map((r) => r.left));
    const page = Math.floor((left - geometry.contentLeft + 1) / geometry.pageWidth);
    return Math.max(0, Math.min(geometry.pageCount - 1, page));
  });
}

/** The page an element starts on, for chapter fragments and TOC targets. */
export function pageForElement(doc: Document, element: Element, geometry: PageGeometry): number {
  return untransformed(doc, () => {
    const rect = element.getBoundingClientRect();
    const page = Math.floor((rect.left - geometry.contentLeft + 1) / geometry.pageWidth);
    return Math.max(0, Math.min(geometry.pageCount - 1, page));
  });
}

/** Fraction of the chapter's text that comes before a page. */
export function textFractionAtPage(doc: Document, pageIndex: number, geometry: PageGeometry): number {
  const total = textLength(doc);
  if (total === 0) return 0;
  return Math.min(1, Math.max(0, textOffsetAtPage(doc, pageIndex, geometry) / total));
}

/** The page holding a fraction of the chapter's text. */
export function pageForTextFraction(doc: Document, fraction: number, geometry: PageGeometry): number {
  const total = textLength(doc);
  if (total === 0) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return pageForTextOffset(doc, Math.round(clamped * (total - 1)), geometry);
}
