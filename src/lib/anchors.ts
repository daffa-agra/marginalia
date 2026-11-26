/**
 * Anchoring a passage of a book.
 *
 * A page number is worthless as a bookmark: change the font size and the page
 * it names moves. A DOM path into the chapter is better, because a reflow
 * changes layout, not structure — the same chapter always renders the same
 * markup, so a path to a text node stays valid across a font change, a resize,
 * a column change and a reload.
 *
 * So an anchor is a chapter index plus two positions, each encoded as a
 * child-index path from `#book-content` followed by an offset *inside a text
 * node*. That is enough to rebuild a live `Range` without touching the
 * document, which in turn means a highlight can be repainted from scratch on
 * every render instead of being mutated in place.
 *
 * ## Why text is stored too
 *
 * Paths are stable for a given rendition of a chapter, but not across a
 * re-upload of a revised EPUB, or if the sanitiser changes. The anchor therefore
 * also carries the selected text and a little context either side of it, so a
 * broken path can fall back to finding the passage by its own words. The
 * fallback is deliberately conservative: it requires a unique match, because
 * attaching a note to the wrong sentence is worse than losing the highlight.
 */

/** One contiguous run of characters inside a single text node. */
export interface AnchorSegment {
  node: Text;
  start: number;
  end: number;
}

export interface TextAnchor {
  /** Spine index of the chapter this passage lives in. */
  chapter: number;
  /** `"0.3.1@42"` — child-index path to a text node, then an offset in it. */
  start: string;
  end: string;
  /** The selected text, used to re-find the passage if the path breaks. */
  text: string;
  /** A few characters before and after, to disambiguate a repeated phrase. */
  prefix?: string;
  suffix?: string;
}

/** Characters of context stored either side of the passage. */
const CONTEXT_CHARS = 32;

/* ── path encoding ── */

function encodePath(doc: Document, node: Node): string | null {
  const root = doc.getElementById('book-content');
  if (!root || !root.contains(node)) return null;
  const parts: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index < 0) return null;
    parts.unshift(index);
    current = parent;
  }
  return parts.join('.');
}

function decodeNode(doc: Document, path: string): Node | null {
  const root = doc.getElementById('book-content');
  if (!root) return null;
  let current: Node = root;
  for (const part of path.split('.')) {
    if (part === '') continue;
    const index = Number(part);
    if (!Number.isInteger(index) || index < 0) return null;
    const next: Node | undefined = current.childNodes[index];
    if (!next) return null;
    current = next;
  }
  return current;
}

function encodePosition(doc: Document, node: Node, offset: number): string | null {
  const path = encodePath(doc, node);
  if (path === null) return null;
  return `${path}@${offset}`;
}

function decodePosition(doc: Document, encoded: string): { node: Text; offset: number } | null {
  const at = encoded.lastIndexOf('@');
  if (at < 0) return null;
  const node = decodeNode(doc, encoded.slice(0, at));
  const offset = Number(encoded.slice(at + 1));
  if (!node || node.nodeType !== Node.TEXT_NODE || !Number.isInteger(offset) || offset < 0) {
    return null;
  }
  return { node: node as Text, offset: Math.min(offset, node.nodeValue?.length ?? 0) };
}

/* ── building ── */

/** The text before and after a node, within the chapter, for context. */
function surroundingText(doc: Document, node: Node, offset: number): { prefix: string; suffix: string } {
  const root = doc.getElementById('book-content');
  if (!root) return { prefix: '', suffix: '' };
  const range = doc.createRange();
  range.selectNodeContents(root);

  const before = range.cloneRange();
  try {
    before.setEnd(node, offset);
  } catch {
    return { prefix: '', suffix: '' };
  }
  const after = range.cloneRange();
  try {
    after.setStart(node, offset);
  } catch {
    return { prefix: '', suffix: '' };
  }
  const prefix = before.toString().slice(-CONTEXT_CHARS);
  const suffix = after.toString().slice(0, CONTEXT_CHARS);
  return { prefix, suffix };
}

/**
 * Encodes a live selection as a portable anchor, or `null` if the range is not
 * inside the chapter (an empty selection, or something outside the book text).
 */
export function buildAnchor(doc: Document, chapter: number, range: Range): TextAnchor | null {
  const text = range.toString();
  if (!text.trim()) return null;
  if (!range.startContainer.isConnected || !range.endContainer.isConnected) return null;

  const start = encodePosition(doc, range.startContainer, range.startOffset);
  const end = encodePosition(doc, range.endContainer, range.endOffset);
  if (start === null || end === null) return null;

  const { prefix, suffix } = surroundingText(doc, range.startContainer, range.startOffset);
  return { chapter, start, end, text, prefix, suffix };
}

/* ── resolving ── */

function segmentsBetween(doc: Document, from: { node: Text; offset: number }, to: { node: Text; offset: number }): AnchorSegment[] {
  const root = doc.getElementById('book-content');
  if (!root) return [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: AnchorSegment[] = [];

  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const length = text.nodeValue?.length ?? 0;
    if (length === 0) continue;

    const isStart = text === from.node;
    const isEnd = text === to.node;
    if (!started && !isStart) continue;
    if (isStart) started = true;

    const start = isStart ? Math.min(from.offset, length) : 0;
    const end = isEnd ? Math.min(to.offset, length) : length;
    if (end > start) segments.push({ node: text, start, end });
    if (isEnd) break;
  }
  return segments;
}

/**
 * Rebuilds the passage from an anchor.
 *
 * Tries the stored path first. If that no longer lands on real text — the book
 * was replaced, or the sanitiser changed — falls back to finding the stored text
 * by its words, and only accepts an unambiguous match.
 */
export function resolveAnchor(doc: Document, anchor: TextAnchor): AnchorSegment[] {
  const from = decodePosition(doc, anchor.start);
  const to = decodePosition(doc, anchor.end);
  if (from && to) {
    const segments = segmentsBetween(doc, from, to);
    if (segments.length > 0) return segments;
  }
  return findText(doc, anchor);
}

/** Last resort: locate the passage by the words it contains. */
function findText(doc: Document, anchor: TextAnchor): AnchorSegment[] {
  const root = doc.getElementById('book-content');
  if (!root || !anchor.text.trim()) return [];
  const haystack = root.textContent ?? '';
  const needle = anchor.text;

  const matches: number[] = [];
  let index = haystack.indexOf(needle);
  while (index >= 0 && matches.length < 2) {
    matches.push(index);
    index = haystack.indexOf(needle, index + 1);
  }
  // A repeated phrase is exactly the case where a wrong match is plausible, so
  // context is used to choose; if that does not disambiguate, give up.
  if (matches.length > 1 && (anchor.prefix || anchor.suffix)) {
    const withContext = matches.filter((start) => {
      const before = haystack.slice(Math.max(0, start - CONTEXT_CHARS), start);
      const after = haystack.slice(start + needle.length, start + needle.length + CONTEXT_CHARS);
      return (!anchor.prefix || before.endsWith(anchor.prefix)) && (!anchor.suffix || after.startsWith(anchor.suffix));
    });
    if (withContext.length === 1) return segmentsAtTextOffsets(doc, root, withContext[0], needle.length);
    return [];
  }
  if (matches.length !== 1) return [];
  return segmentsAtTextOffsets(doc, root, matches[0], needle.length);
}

/** Converts a character offset within `root`'s text into text-node segments. */
function segmentsAtTextOffsets(doc: Document, root: Element, offset: number, length: number): AnchorSegment[] {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: AnchorSegment[] = [];
  let seen = 0;
  const end = offset + length;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const size = text.nodeValue?.length ?? 0;
    if (size === 0) continue;
    const nodeStart = seen;
    const nodeEnd = seen + size;
    seen = nodeEnd;
    if (nodeEnd <= offset || nodeStart >= end) continue;
    const start = Math.max(0, offset - nodeStart);
    const stop = Math.min(size, end - nodeStart);
    if (stop > start) segments.push({ node: text, start, end: stop });
    if (nodeEnd >= end) break;
  }
  return segments;
}

/* ── painting ── */

const HIGHLIGHT_CLASS = 'reader-highlight';

/** Removes every painted highlight, restoring the original markup. */
export function clearHighlights(doc: Document): void {
  const root = doc.getElementById('book-content');
  if (!root) return;
  for (const mark of Array.from(root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    // Merge the text nodes the split created, so the next set of paths sees the
    // same structure the anchors were built against.
    parent.normalize();
  }
}

/**
 * Wraps one resolved passage in a `mark`, or returns `null` if it cannot.
 *
 * A range that crosses element boundaries cannot be wrapped by
 * `surroundContents` (it throws), so this falls back to splitting the runs and
 * collecting them into the mark. Every step is guarded: a passage that cannot be
 * painted is better skipped than left to throw into React's render cycle, which
 * would unmount the whole reader.
 */
function wrapPassage(doc: Document, segments: AnchorSegment[], id: string, tone?: string): HTMLElement | null {
  if (segments.length === 0) return null;
  const mark = doc.createElement('mark');
  mark.className = HIGHLIGHT_CLASS;
  mark.dataset.highlightId = id;
  if (tone === 'note') mark.dataset.tone = 'note';
  mark.setAttribute('title', 'Open note');
  mark.setAttribute('role', 'button');
  mark.setAttribute('tabindex', '-1');

  // Clamp every offset to the node's *current* length. `surroundContents` and
  // `extractContents` split the text nodes they touch, so a later segment may
  // refer to a node that is shorter than when the range was built.
  const safe = segments
    .map(({ node, start, end }) => {
      const length = node.nodeValue?.length ?? 0;
      if (!node.isConnected || length === 0) return null;
      const from = Math.min(Math.max(0, start), length);
      const to = Math.min(Math.max(from, end), length);
      return to > from ? { node, start: from, end: to } : null;
    })
    .filter((s): s is AnchorSegment => s !== null);
  if (safe.length === 0) return null;

  try {
    const first = safe[0];
    const firstRange = doc.createRange();
    firstRange.setStart(first.node, first.start);
    firstRange.setEnd(first.node, first.end);
    firstRange.surroundContents(mark);
  } catch {
    return null;
  }

  for (const segment of safe.slice(1)) {
    // The first mark may have swallowed nodes the remaining segments pointed
    // at; those are already inside it, so they need no second move.
    if (mark.contains(segment.node)) continue;
    try {
      const range = doc.createRange();
      range.setStart(segment.node, segment.start);
      range.setEnd(segment.node, segment.end);
      mark.appendChild(range.extractContents());
    } catch {
      // A run that cannot be moved is left as plain, unhighlighted text.
    }
  }
  return mark;
}

/**
 * Paints a set of highlights into the chapter.
 *
 * Existing highlights are cleared first and every passage is resolved against
 * the clean document, because wrapping text in an element changes the child
 * indices that the next anchor's path refers to. Resolve-all-then-paint is what
 * keeps that honest.
 *
 * `mark` is used rather than a class on the existing element because a passage
 * can begin and end mid-paragraph, and only a wrapper can express that without
 * rewriting the text.
 */
export function paintHighlights(
  doc: Document,
  highlights: Array<{ id: string; anchor: TextAnchor; tone?: 'note' | 'quote' }>,
): number {
  clearHighlights(doc);
  const root = doc.getElementById('book-content');
  if (!root) return 0;

  // Resolve everything before touching the DOM.
  const resolved = highlights
    .map((h) => ({ ...h, segments: resolveAnchor(doc, h.anchor) }))
    .filter((h) => h.segments.length > 0);

  let painted = 0;
  for (const highlight of resolved) {
    if (wrapPassage(doc, highlight.segments, highlight.id, highlight.tone)) painted += 1;
  }
  return painted;
}

/** Text-node offset of a position, counted from the start of the chapter. */
export function offsetWithinChapter(doc: Document, node: Node, offset: number): number {
  const root = doc.getElementById('book-content');
  if (!root) return 0;
  const range = doc.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}
