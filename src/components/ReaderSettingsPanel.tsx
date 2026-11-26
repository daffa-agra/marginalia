import type { ReaderSettingsStore } from '../lib/useReaderSettings';
import { PRESETS, LIMITS } from '../lib/readerSettings';
import type { BookTypography } from '../lib/readerSettings';
import { Icon } from './icons';

/**
 * The typography sheet. A right-hand panel rather than a modal, so the page
 * stays visible and every change is seen live — customization is a visual
 * task, and covering the text defeats it.
 */
export function ReaderSettingsPanel({
  store,
  onClose,
}: {
  store: ReaderSettingsStore;
  onClose: () => void;
}) {
  const { typography: t, settings } = store;

  const slider = (
    label: string,
    key: keyof Pick<
      BookTypography,
      | 'fontSizePx'
      | 'measureCh'
      | 'lineHeight'
      | 'letterSpacingEm'
      | 'wordSpacingEm'
      | 'paragraphSpacingEm'
      | 'indentEm'
      | 'marginPercent'
      | 'writingMarginPercent'
    >,
    step: number,
    format?: (v: number) => string,
  ) => {
    const [min, max] = LIMITS[key];
    return (
      <label className="reader-control" key={key}>
        <span className="reader-control-head">
          <span>{label}</span>
          <span className="reader-control-value numeric">{format ? format(t[key]) : t[key]}</span>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={t[key]}
          aria-label={label}
          onChange={(e) => store.update({ [key]: Number(e.target.value) } as Partial<BookTypography>)}
        />
      </label>
    );
  };

  const choice = <T extends string>(label: string, options: Array<{ value: T; label: string }>, current: T, onPick: (v: T) => void) => (
    <div className="reader-control">
      <span className="reader-control-label">{label}</span>
      <div className="reader-choice" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === current ? 'reader-choice-btn active' : 'reader-choice-btn'}
            aria-pressed={o.value === current}
            onClick={() => onPick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <aside className="reader-settings" aria-label="Reading settings">
      <div className="reader-settings-head">
        <h2>Reading settings</h2>
        <button type="button" className="reader-icon-btn" aria-label="Close settings" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <p className="reader-settings-scope">
        {store.hasOverride ? 'This book only' : 'Using your default'}
        <button type="button" className="reader-link-btn" onClick={store.useForAll}>
          Use for all books
        </button>
        {store.hasOverride && (
          <button type="button" className="reader-link-btn" onClick={store.resetThisBook}>
            Reset
          </button>
        )}
      </p>

      {choice<'preserve' | 'own'>(
        'Publisher styling',
        [
          { value: 'preserve', label: 'Preserve the book' },
          { value: 'own', label: 'My page' },
        ],
        settings.mode,
        store.setMode,
      )}

      {choice<'paper' | 'sepia' | 'night'>(
        'Theme',
        [
          { value: 'paper', label: 'Paper' },
          { value: 'sepia', label: 'Sepia' },
          { value: 'night', label: 'Night' },
        ],
        settings.theme,
        store.setTheme,
      )}

      <div className="reader-settings-group">
        <h3>Text</h3>
        {slider('Font size', 'fontSizePx', 1, (v) => `${v}px`)}
        {settings.mode === 'own' &&
          choice<BookTypography['fontFamily']>(
            'Font',
            [
              { value: 'book', label: 'Book' },
              { value: 'serif', label: 'Serif' },
              { value: 'sans', label: 'Sans' },
              { value: 'dyslexic', label: 'Dyslexic' },
            ],
            t.fontFamily,
            (v) => store.update({ fontFamily: v }),
          )}
        {slider('Line length', 'measureCh', 1, (v) => `${v} characters`)}
        {slider('Line height', 'lineHeight', 0.05, (v) => v.toFixed(2))}
      </div>

      <div className="reader-settings-group">
        <h3>Spacing</h3>
        {slider('Letter spacing', 'letterSpacingEm', 0.01, (v) => `${v.toFixed(2)}em`)}
        {slider('Word spacing', 'wordSpacingEm', 0.01, (v) => `${v.toFixed(2)}em`)}
        {slider('Paragraph spacing', 'paragraphSpacingEm', 0.1, (v) => `${v.toFixed(1)}em`)}
        {settings.mode === 'own' && slider('First-line indent', 'indentEm', 0.1, (v) => `${v.toFixed(1)}em`)}
        <button type="button" className="btn btn-small" onClick={store.applyAaSpacing}>
          Text spacing (AA)
        </button>
      </div>

      <div className="reader-settings-group">
        <h3>Alignment</h3>
        {choice<BookTypography['alignment']>(
          'Alignment',
          [
            { value: 'book', label: 'Book' },
            { value: 'left', label: 'Left' },
            { value: 'justify', label: 'Justify' },
          ],
          t.alignment,
          (v) => store.update({ alignment: v }),
        )}
        {choice<BookTypography['hyphenation']>(
          'Hyphenation',
          [
            { value: 'book', label: 'Book' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
          t.hyphenation,
          (v) => store.update({ hyphenation: v }),
        )}
      </div>

      <div className="reader-settings-group">
        <h3>Page</h3>
        {slider('Margins', 'marginPercent', 1, (v) => `${v}%`)}
        {slider('Writing margin', 'writingMarginPercent', 1, (v) => `${v}%`)}
        {choice<ReaderColumns>(
          'Columns',
          [
            { value: 'auto', label: 'Auto' },
            { value: '1', label: 'One' },
            { value: '2', label: 'Two' },
          ],
          String(settings.columns) as ReaderColumns,
          (v) => store.setColumns(v === 'auto' ? 'auto' : (Number(v) as 1 | 2)),
        )}
      </div>

      <div className="reader-settings-group">
        <h3>Presets</h3>
        <div className="reader-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="btn btn-small"
              onClick={() => store.applyPreset(preset.id)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

type ReaderColumns = 'auto' | '1' | '2';

