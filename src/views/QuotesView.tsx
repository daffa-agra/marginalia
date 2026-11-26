import type { JournalStore } from '../useJournal';
import { QuoteList } from '../components/QuoteList';
import { EmptyState } from '../components/EmptyState';

export function QuotesView({ store }: { store: JournalStore }) {
  const { data } = store;
  const titleById = new Map(data.books.map((b) => [b.id, b.title]));

  if (data.quotes.length === 0) {
    return (
      <section className="view" aria-labelledby="quotes-title">
        <div className="view-head">
          <h1 id="quotes-title">Quotes &amp; notes</h1>
        </div>
        <EmptyState
          icon="❝"
          title="No quotes collected yet"
          body="Save passages as you read, or import the notes you exported from Play Books."
        />
      </section>
    );
  }

  return (
    <section className="view" aria-labelledby="quotes-title">
      <div className="view-head">
        <div>
          <h1 id="quotes-title">Quotes &amp; notes</h1>
          <p className="muted">
            {data.quotes.length} quote{data.quotes.length === 1 ? '' : 's'} across your library.
          </p>
        </div>
      </div>
      <QuoteList
        quotes={data.quotes}
        store={store}
        showBookTitles
        titleById={titleById}
        emptyMessage=""
      />
    </section>
  );
}
