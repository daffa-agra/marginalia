import type { Book, JournalData, Quote } from '../types';

export interface ExportFile {
  filename: string;
  content: string;
}

export function exportJson(data: JournalData): ExportFile {
  return {
    filename: `marginalia-${new Date().toISOString().slice(0, 10)}.json`,
    content: JSON.stringify(data, null, 2),
  };
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function exportCsv(data: JournalData): ExportFile {
  const header = [
    'id',
    'title',
    'author',
    'series',
    'series_index',
    'status',
    'rating',
    'total_pages',
    'current_page',
    'started_at',
    'finished_at',
    'genres',
    'review',
  ];
  const lines = [header.join(',')];
  for (const b of data.books) {
    lines.push(
      [
        b.id,
        b.title,
        b.author,
        b.series ?? '',
        b.seriesIndex != null ? String(b.seriesIndex) : '',
        b.status,
        b.rating != null ? String(b.rating) : '',
        b.totalPages != null ? String(b.totalPages) : '',
        String(b.currentPage),
        b.startedAt ?? '',
        b.finishedAt ?? '',
        b.genres.join('; '),
        b.review ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return {
    filename: `marginalia-books-${new Date().toISOString().slice(0, 10)}.csv`,
    content: lines.join('\r\n'),
  };
}

export function exportQuotesCsv(data: JournalData): ExportFile {
  const titleById = new Map(data.books.map((b) => [b.id, b.title]));
  const header = ['book', 'quote', 'note', 'position', 'created_at'];
  const lines = [header.join(',')];
  for (const q of data.quotes) {
    lines.push(
      [
        titleById.get(q.bookId) ?? '',
        q.text,
        q.note ?? '',
        q.position ?? '',
        new Date(q.createdAt).toISOString().slice(0, 10),
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return {
    filename: `marginalia-quotes-${new Date().toISOString().slice(0, 10)}.csv`,
    content: lines.join('\r\n'),
  };
}

/** Simple readable .md backup of everything. */
export function exportMarkdown(data: JournalData): ExportFile {
  const quotesByBook = new Map<string, Quote[]>();
  for (const q of data.quotes) {
    const list = quotesByBook.get(q.bookId) ?? [];
    list.push(q);
    quotesByBook.set(q.bookId, list);
  }
  const out: string[] = ['# Marginalia journal', ''];
  const statusLabel: Record<Book['status'], string> = {
    'want-to-read': 'Want to read',
    reading: 'Reading',
    finished: 'Finished',
    abandoned: 'Abandoned',
  };
  for (const b of data.books) {
    out.push(`## ${b.title}`);
    out.push('');
    out.push(`- Author: ${b.author}`);
    out.push(`- Status: ${statusLabel[b.status]}`);
    if (b.series) {
      out.push(
        `- Series: ${b.series}${b.seriesIndex != null ? ` #${b.seriesIndex}` : ''}`,
      );
    }
    if (b.rating) out.push(`- Rating: ${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}`);
    if (b.totalPages) out.push(`- Pages: ${b.currentPage}/${b.totalPages}`);
    if (b.startedAt) out.push(`- Started: ${b.startedAt}`);
    if (b.finishedAt) out.push(`- Finished: ${b.finishedAt}`);
    if (b.genres.length) out.push(`- Genres: ${b.genres.join(', ')}`);
    if (b.review) {
      out.push('', '**Review**', '', b.review);
    }
    const quotes = quotesByBook.get(b.id) ?? [];
    if (quotes.length) {
      out.push('', '**Quotes**', '');
      for (const q of quotes) {
        out.push(`> ${q.text}${q.position ? ` (${q.position})` : ''}`);
        if (q.note) out.push('');
        if (q.note) out.push(`_Note:_ ${q.note}`);
        out.push('');
      }
    }
    out.push('');
  }
  return {
    filename: `marginalia-journal-${new Date().toISOString().slice(0, 10)}.md`,
    content: out.join('\n'),
  };
}

export function downloadTextFile(file: ExportFile): void {
  const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
