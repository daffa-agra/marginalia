import { STATUS_ORDER } from '../types';
import type { ReadStatus } from '../types';
import { STATUS_META } from '../types';

export function SearchFilterBar({
  query,
  onQuery,
  status,
  onStatus,
  genre,
  genres,
  onGenre,
  sort,
  onSort,
  counts,
  total,
}: {
  query: string;
  onQuery: (v: string) => void;
  status: ReadStatus | 'all';
  onStatus: (s: ReadStatus | 'all') => void;
  genre: string;
  genres: string[];
  onGenre: (g: string) => void;
  sort: string;
  onSort: (s: 'recent' | 'title' | 'author' | 'rating' | 'progress') => void;
  counts: Map<ReadStatus, number>;
  total: number;
}) {
  const statusTabs: Array<{ value: ReadStatus | 'all'; label: string; count: number }> = [
    { value: 'all', label: 'All', count: total },
    ...STATUS_ORDER.map((s) => ({
      value: s,
      label: STATUS_META[s].plural,
      count: counts.get(s) ?? 0,
    })),
  ];

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <div className="status-tabs" role="tablist" aria-label="Filter by status">
          {statusTabs.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={status === t.value}
              className={status === t.value ? 'tab active' : 'tab'}
              onClick={() => onStatus(t.value)}
            >
              {t.label}
              <span className="tab-count">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="filter-controls">
          <label className="visually-hidden" htmlFor="library-search">
            Search books
          </label>
          <input
            id="library-search"
            type="search"
            className="input search-input"
            placeholder="Search title, author, series…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          <label className="visually-hidden" htmlFor="genre-filter">
            Filter by genre
          </label>
          <select
            id="genre-filter"
            className="input select"
            value={genre}
            onChange={(e) => onGenre(e.target.value)}
          >
            <option value="all">All genres</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <label className="visually-hidden" htmlFor="sort-select">
            Sort books
          </label>
          <select
            id="sort-select"
            className="input select"
            value={sort}
            onChange={(e) => onSort(e.target.value as 'recent' | 'title' | 'author' | 'rating' | 'progress')}
          >
            <option value="recent">Recently added</option>
            <option value="title">Title A–Z</option>
            <option value="author">Author A–Z</option>
            <option value="rating">Highest rated</option>
            <option value="progress">Progress</option>
          </select>
        </div>
      </div>
    </div>
  );
}
