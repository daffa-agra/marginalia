/**
 * Pagination.
 *
 * The reader renders a chapter as one tall document. This module measures that
 * document and carves it into pages that fit the frame, using CSS multi-column
 * on a wrapper: the browser does the layout, so text stays selectable and
 * images stay intact.
 *
 * A "position" is still (chapter, fraction) but a fraction is now a page index
 * divided by page count, so a reflow can land on the nearest whole page rather
 * than mid-paragraph.
 */

export interface PaginationResult {
  pageCount: number;
  /** Width of one page in CSS px, for the translate step. */
  pageWidth: number;
  /** Gap between columns, in CSS px. */
  gap: number;
}

const PAGE_GAP = 48;

/**
 * Lays a document out in columns and reports how many pages it makes.
 *
 * `viewportWidth`/`viewportHeight` are the visible frame, in CSS px. The
 * document must already be in the DOM and styled.
 *
 * The count comes from the scroll width of the column container: with
 * `column-width` fixed and `column-fill: auto`, the browser lays the text out
 * in as many columns as it needs, and the container's scrollWidth grows to
 * match. Counting columns from that is the only reliable measure — reading
 * `scrollHeight` would give the height of column one.
 */
export function paginate(doc: Document, viewportWidth: number, viewportHeight: number): PaginationResult {
  const body = doc.body;
  const content = doc.getElementById('book-content');
  if (!body || !content) return { pageCount: 1, pageWidth: viewportWidth, gap: PAGE_GAP };

  // Reset previous pagination so the measurement starts from a clean layout.
  body.style.removeProperty('column-width');
  body.style.removeProperty('column-gap');
  body.style.removeProperty('column-fill');
  body.style.removeProperty('height');
  body.style.removeProperty('overflow');
  body.style.removeProperty('transform');
  body.style.removeProperty('transition');

  // Width of the text column as the typography allows it.
  const maxInline = parseFloat(doc.defaultView?.getComputedStyle(content).maxInlineSize || '0');
  const available = Math.max(200, maxInline > 0 ? Math.min(maxInline, viewportWidth) : viewportWidth);
  const pageWidth = Math.min(available, viewportWidth);

  body.style.setProperty('height', `${viewportHeight}px`);
  body.style.setProperty('overflow', 'hidden');
  body.style.setProperty('column-width', `${pageWidth}px`);
  body.style.setProperty('column-gap', `${PAGE_GAP}px`);
  body.style.setProperty('column-fill', 'auto');

  const stride = pageWidth + PAGE_GAP;
  // scrollWidth is the full width of all columns laid end to end.
  const totalWidth = Math.max(body.scrollWidth, content.scrollWidth);
  const pageCount = Math.max(1, Math.round((totalWidth + PAGE_GAP) / stride));

  return { pageCount, pageWidth, gap: PAGE_GAP };
}

/** Moves the paged document to a page index, horizontally. */
export function showPage(doc: Document, pageIndex: number, result: PaginationResult): void {
  const body = doc.body;
  if (!body) return;
  const stride = result.pageWidth + result.gap;
  body.style.setProperty('transform', `translateX(${-pageIndex * stride}px)`);
  body.style.setProperty('transition', 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)');
}

/** Fraction (0–1) for a page index, and the inverse. */
export function pageToFraction(pageIndex: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  return Math.min(1, Math.max(0, pageIndex / (pageCount - 1)));
}

export function fractionToPage(fraction: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  return Math.min(pageCount - 1, Math.max(0, Math.round(fraction * (pageCount - 1))));
}
