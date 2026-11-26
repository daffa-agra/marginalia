import type { Book, Quote } from './types';

interface SeedBook {
  id: string;
  title: string;
  author: string;
  series?: string;
  seriesIndex?: number;
  status: Book['status'];
  totalPages?: number;
  currentPage: number;
  rating?: number;
  review?: string;
  startedAt?: string;
  finishedAt?: string;
  genres: string[];
  color: string;
  quotes?: Array<{ text: string; note?: string; position?: string }>;
}

/**
 * Demo content shown on first launch so no screen starts empty.
 * It lives only in memory until the user saves something; from then on
 * their own data replaces it. "Clear all data" restores the demo library.
 */
const SEED: SeedBook[] = [
  {
    id: 'demo-piranesi',
    title: 'Piranesi',
    author: 'Susanna Clarke',
    status: 'finished',
    totalPages: 245,
    currentPage: 245,
    rating: 5,
    review:
      'A strange, luminous book about a man cataloguing an infinite house. The voice is unlike anything else I have read, and the ending reframes the whole story.',
    startedAt: '2026-10-02',
    finishedAt: '2026-10-11',
    genres: ['Fantasy', 'Mystery'],
    color: '#3f6f71',
    quotes: [
      {
        text: 'The Beauty of the House is immeasurable; its Kindness infinite.',
        position: '38%',
      },
      {
        text: 'I realize that I have been walking in circles. Or rather: I have been walking in a labyrinth.',
        note: 'The moment the narrator starts to see the truth.',
        position: '52%',
      },
    ],
  },
  {
    id: 'demo-sirens',
    title: 'The Sirens',
    author: 'Emilia Hart',
    status: 'reading',
    totalPages: 342,
    currentPage: 187,
    startedAt: '2026-11-14',
    genres: ['Historical', 'Mystery'],
    color: '#5b6d8f',
    quotes: [
      {
        text: 'The sea does not forgive, but it does forget, and that is nearly the same thing.',
        position: '44%',
      },
    ],
  },
  {
    id: 'demo-tomorrow',
    title: 'Tomorrow, and Tomorrow, and Tomorrow',
    author: 'Gabrielle Zevin',
    status: 'finished',
    totalPages: 401,
    currentPage: 401,
    rating: 4,
    review:
      'About friendship and creative partnership more than games, which surprised me. Sagged a little in the middle, but the Massachusetts sections are perfect.',
    startedAt: '2026-08-19',
    finishedAt: '2026-09-07',
    genres: ['Literary fiction'],
    color: '#8f5b6d',
    quotes: [
      {
        text: 'To allow yourself to be known is an act of tremendous courage.',
        position: '71%',
      },
    ],
  },
  {
    id: 'demo-memory',
    title: 'The Memory Police',
    author: 'Yōko Ogawa',
    status: 'finished',
    totalPages: 274,
    currentPage: 274,
    rating: 4,
    review:
      'Quietly devastating. Read it in three evenings and thought about it for weeks.',
    startedAt: '2026-07-01',
    finishedAt: '2026-07-03',
    genres: ['Science fiction', 'Literary fiction'],
    color: '#6d7a5b',
  },
  {
    id: 'demo-circe',
    title: 'Circe',
    author: 'Madeline Miller',
    status: 'want-to-read',
    currentPage: 0,
    genres: ['Fantasy', 'Mythology'],
    color: '#a0703c',
  },
  {
    id: 'demo-tender',
    title: 'Tender Is the Flesh',
    author: 'Agustina Bazterrica',
    status: 'abandoned',
    totalPages: 209,
    currentPage: 64,
    startedAt: '2026-06-05',
    genres: ['Horror', 'Dystopia'],
    color: '#7a4a4a',
  },
];

export function sampleData() {
  const now = Date.now();
  const books: Book[] = [];
  const quotes: Quote[] = [];
  for (const seed of SEED) {
    books.push({
      id: seed.id,
      title: seed.title,
      author: seed.author,
      series: seed.series,
      seriesIndex: seed.seriesIndex,
      status: seed.status,
      totalPages: seed.totalPages,
      currentPage: seed.currentPage,
      rating: seed.rating,
      review: seed.review,
      startedAt: seed.startedAt,
      finishedAt: seed.finishedAt,
      genres: [...seed.genres],
      color: seed.color,
      createdAt: now,
    });
    for (const q of seed.quotes ?? []) {
      quotes.push({
        id: `demo-quote-${books.length}-${quotes.length}`,
        bookId: seed.id,
        text: q.text,
        note: q.note,
        position: q.position,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return { books, quotes };
}
