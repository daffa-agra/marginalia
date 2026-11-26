export interface ParsedHighlight {
  text: string;
  note?: string;
  position?: string;
  /** Order as found in the source document. */
  index: number;
}

export interface ParsedDoc {
  /** Book title, taken from the doc's heading structure. */
  bookTitle: string;
  /** Author if the export includes one. */
  author?: string;
  highlights: ParsedHighlight[];
}

export interface ParsedFile {
  filename: string;
  kind: 'playbooks-doc' | 'generic';
  /** One per book section found (Play Books docs have exactly one). */
  docs: ParsedDoc[];
  warnings: string[];
}

const HIGHLIGHT_LINE =
  /^\s*(?:(\d+)\.\s*)?(?:Highlights?)\s*(?:\(page\s+(\d+[^)]*)\)|\(loc(?:ation)?\s+(\d+[^)]*)\)|\((?:p(?:g)?\.?\s*)?(\d+(?:\.\d+)?)%\)|\(p(?:g)?\.?\s*(\d+[a-z]?)\))?\s*(?:[:·-]\s*)?(.*)$/i;
const NOTE_LINE = /^\s*Note\s*(?:\(([^)]*)\))?\s*[:·-]\s*(.*)$/i;
const POSITION_ONLY = /^\s*(?:page\s+|loc(?:ation)?\s+|loc\.\s+)?(\d+(?:\.\d+)?)\s*%\s*:?\s*$/i;

/**
 * Parse Play Books "Export notes" documents.
 *
 * Structure is heading-per-book, then per highlight a block of:
 *   1. Highlight (42%) "quoted text"
 *   Note (43%): your note
 * or line-based variants. Anything unrecognized is kept as plain text
 * lines so nothing silently disappears.
 */
export function parseAnnotationFile(filename: string, content: string): ParsedFile {
  const warnings: string[] = [];
  const isHtml = /\.html?$/i.test(filename) || /^\s*<(?:!doctype|html)/i.test(content);
  const text = isHtml ? htmlToLines(content) : content;

  const lines = text.split(/\r\n|\r|\n/);
  const docs: ParsedDoc[] = [];

  let current: ParsedDoc | null = null;
  let lastHighlight: ParsedHighlight | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    const heading = headingTitle(line);
    if (heading) {
      current = { bookTitle: heading, highlights: [] };
      docs.push(current);
      lastHighlight = null;
      continue;
    }

    if (!current) {
      // Tolerate exports without headings: treat everything as one doc.
      current = { bookTitle: guessTitleFromFilename(filename), highlights: [] };
      docs.push(current);
      lastHighlight = null;
      warnings.push('No headings found; assumed the whole file is one book.');
    }
    const doc: ParsedDoc = current;
    const highlight = matchHighlight(trimmed);
    if (highlight) {
      const hl: ParsedHighlight = {
        text: highlight.text,
        position: highlight.position,
        index: doc.highlights.length,
      };
      doc.highlights.push(hl);
      lastHighlight = hl;
      continue;
    }

    const note = matchNote(trimmed);
    if (note) {
      if (lastHighlight && !lastHighlight.note) {
        lastHighlight.note = note.text;
        if (note.position && !lastHighlight.position) {
          lastHighlight.position = note.position;
        }
      } else {
        // Standalone note becomes its own entry so it is not lost.
        doc.highlights.push({
          text: note.text,
          position: note.position,
          index: doc.highlights.length,
        });
        lastHighlight = doc.highlights[doc.highlights.length - 1];
      }
      continue;
    }

    const posOnly = POSITION_ONLY.exec(trimmed);
    if (posOnly && lastHighlight) {
      lastHighlight.position = `${posOnly[1]}%`;
      continue;
    }

    // Author line right after the title.
    if (
      doc.highlights.length === 0 &&
      !doc.author &&
      /^(by|author)\s+/i.test(trimmed)
    ) {
      doc.author = trimmed.replace(/^(by|author)\s+/i, '').trim();
      continue;
    }

    // Plain text fallback: attach to the last highlight as text continuation,
    // otherwise treat the line as a quote itself.
    if (lastHighlight) {
      lastHighlight.text = `${lastHighlight.text} ${trimmed}`.trim();
    } else {
      doc.highlights.push({ text: trimmed, index: doc.highlights.length });
      lastHighlight = doc.highlights[doc.highlights.length - 1];
    }
  }

  for (const doc of docs) {
    doc.highlights = doc.highlights.filter((h) => h.text.replace(/\s+/g, '').length > 1);
  }
  const usable = docs.filter((d) => d.highlights.length > 0);
  if (docs.length > 0 && usable.length === 0) {
    warnings.push('No highlights found in this file.');
  }

  return {
    filename,
    kind: 'playbooks-doc',
    docs: usable.length > 0 ? usable : docs.slice(0, 1),
    warnings,
  };
}

function headingTitle(line: string): string | null {
  const md = /^#{1,6}\s+(.+)$/.exec(line);
  if (md) return md[1].trim();
  const html = /^<h[1-6][^>]*>(.*?)<\/h[1-6]>$/i.exec(line.trim());
  if (html) return stripTags(html[1]);
  return null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlToLines(html: string): string {
  return (
    html
      .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, '')
      // Keep headings detectable after tag-stripping by promoting them to markdown.
      .replace(
        /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
        (_m, level: string, inner: string) => `\n${'#'.repeat(Number(level))} ${stripTags(inner)}\n`,
      )
      .replace(/<\/(p|div|li|tr|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
  );
}

function matchHighlight(
  line: string,
): { text: string; position?: string } | null {
  const m = HIGHLIGHT_LINE.exec(line);
  if (!m) return null;
  // The line starts with an optional "12." prefix, so search the head
  // for the word rather than anchoring to the very start.
  const head = m[0].slice(0, 24);
  if (!/\bhighlights?\b/i.test(head)) return null;

  const position =
    (m[2] && `p. ${m[2]}`) ||
    (m[3] && `loc. ${m[3]}`) ||
    (m[4] && `${m[4]}%`) ||
    (m[5] && `p. ${m[5]}`) ||
    undefined;

  let text = (m[6] ?? '').trim();
  // "Highlight (42%) "quoted text"" — quotes around the body.
  const quoted = /^["“](.*)["”]$/.exec(text);
  if (quoted) text = quoted[1].trim();
  if (!text) return null;
  return { text, position };
}

function matchNote(line: string): { text: string; position?: string } | null {
  const m = NOTE_LINE.exec(line);
  if (!m) return null;
  let text = (m[2] ?? '').trim();
  const quoted = /^["“](.*)["”]$/.exec(text);
  if (quoted) text = quoted[1].trim();
  if (!text) return null;
  const posRaw = (m[1] ?? '').trim();
  let position: string | undefined;
  if (/^\d+(\.\d+)?%$/.test(posRaw)) position = posRaw;
  else if (/^page/i.test(posRaw)) position = `p. ${posRaw.replace(/^page\s*/i, '')}`;
  else if (/^loc/i.test(posRaw)) position = `loc. ${posRaw.replace(/^loc(?:ation)?\.?\s*/i, '')}`;
  return { text, position };
}

function guessTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base.length > 0 ? base : 'Imported highlights';
}
