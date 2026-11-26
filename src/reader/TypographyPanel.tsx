import { useEffect, useRef, useState } from 'react';
import type { Book } from '../types';
import {
  applyTextSpacingAA,
  LEADING_MAX,
  LEADING_MIN,
  MEASURE_MAX,
  MEASURE_MIN,
  MARGIN_MAX,
  PARA_MAX,
  PRESETS,
  SIZE_MAX,
  SIZE_MIN,
  WRITING_MARGIN_MAX,
  LETTER_MAX,
  WORD_MAX,
  clampTypography,
  type BookTypography,
  type ReaderSettings,
} from './typography';
import { Icon } from '../components/icons';

/**
 * The typography sheet (READER-TYPOGRAPHY §6.1). It sits beside the page,
 * never over it: customization is a visual task and the reader must see
 * the change land. Typography changes are debounced 150 ms before the
 * engine relayouts; theme, mode and columns apply immediately.
 */

const DEBOUNCE_MS = 150;

export function TypographyPanel({
  book,
  settings,
  onPatchSettings,
  onPatchTypography,
  onReset,
  onClose,
}: {
  book: Book;
  settings: ReaderSettings;
  onPatchSettings: (next: ReaderSettings) => void;
  onPatchTypography: (patch: Partial<BookTypography>, scopeAll: boolean) => void;
  onReset: (scopeAll: boolean) => void;
  onClose: () => void;
}) {
  const [scopeAll, setScopeAll] = useState(false);
  const [pending, setPending] = useState<BookTypography | null>(null);
  const debounceRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
  }, []);

  const shown = pending ?? (scopeAll ? settings.global : settings.perBook[book.id] ?? settings.global);

  const patch = (part: Partial<BookTypography>) => {
    setPending((current) => clampTypography({ ...(current ?? shown), ...part }));
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      onPatchTypography(part, scopeAll);
    }, DEBOUNCE_MS);
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setPending(null);
    onPatchTypography(preset.typography, scopeAll);
  };

  return (
    <aside className="reader-panel" role="dialog" aria-label="Typography" aria-modal="false">
      <div className="reader-panel-head">
        <h2>Typography</h2>
        <div className="reader-panel-head-actions">
          <button
            type="button"
            className="btn btn-quiet icon-btn"
            aria-label={scopeAll ? 'Settings apply to every book' : 'Settings apply to this book only'}
            aria-pressed={scopeAll}
            title={scopeAll ? 'Apply to every book' : 'Apply to this book only'}
            onClick={() => setScopeAll((v) => !v)}
          >
            <Icon name={scopeAll ? 'check' : 'unlock'} />
          </button>
          <button type="button" className="btn btn-quiet icon-btn" aria-label="Close typography settings" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </div>

      <div className="reader-panel-section" role="radiogroup" aria-label="Styling mode">
        <ModeOption
          label="Preserve the book"
          active={settings.mode === 'preserve'}
          description="Publisher fonts and layout survive"
          onClick={() => onPatchSettings({ ...settings, mode: 'preserve' })}
        />
        <ModeOption
          label="My page"
          active={settings.mode === 'own'}
          description="Font, alignment and indents are mine"
          onClick={() => onPatchSettings({ ...settings, mode: 'own' })}
        />
      </div>

      <div className="reader-panel-section">
        <SliderRow
          label="Font size"
          min={SIZE_MIN}
          max={SIZE_MAX}
          step={1}
          value={shown.fontSizePx}
          format={(v) => `${v} px`}
          onChange={(v) => patch({ fontSizePx: v })}
        />
        {settings.mode === 'own' && (
          <ChoiceRow
            label="Font"
            value={shown.fontFamily}
            options={[
              ['book', 'Book font'],
              ['serif', 'Serif'],
              ['sans', 'Sans'],
              ['dyslexic', 'Dyslexia-friendly'],
            ]}
            onChange={(value) => patch({ fontFamily: value as BookTypography['fontFamily'] })}
          />
        )}
        <SliderRow
          label="Measure"
          min={MEASURE_MIN}
          max={MEASURE_MAX}
          step={1}
          value={shown.measureCh}
          format={(v) => `${v} ch`}
          onChange={(v) => patch({ measureCh: v })}
        />
        <SliderRow
          label="Leading"
          min={LEADING_MIN}
          max={LEADING_MAX}
          step={0.05}
          value={shown.lineHeight}
          format={(v) => v.toFixed(2)}
          onChange={(v) => patch({ lineHeight: v })}
        />
        <SliderRow
          label="Letter spacing"
          min={-0.01}
          max={LETTER_MAX}
          step={0.01}
          value={shown.letterSpacingEm}
          format={(v) => `${v.toFixed(2)} em`}
          onChange={(v) => patch({ letterSpacingEm: v })}
        />
        <SliderRow
          label="Word spacing"
          min={0}
          max={WORD_MAX}
          step={0.02}
          value={shown.wordSpacingEm}
          format={(v) => `${v.toFixed(2)} em`}
          onChange={(v) => patch({ wordSpacingEm: v })}
        />
        <SliderRow
          label="Paragraph spacing"
          min={0}
          max={PARA_MAX}
          step={0.1}
          value={shown.paragraphSpacingEm}
          format={(v) => `${v.toFixed(1)} em`}
          onChange={(v) => patch({ paragraphSpacingEm: v })}
        />
        {settings.mode === 'own' && (
          <>
            <ChoiceRow
              label="Alignment"
              value={shown.alignment}
              options={[
                ['book', 'Book'],
                ['left', 'Left'],
                ['justify', 'Justified'],
              ]}
              onChange={(value) => patch({ alignment: value as BookTypography['alignment'] })}
            />
            <ChoiceRow
              label="Hyphenation"
              value={shown.hyphenation}
              options={[
                ['book', 'Book'],
                ['on', 'On'],
                ['off', 'Off'],
              ]}
              onChange={(value) => patch({ hyphenation: value as BookTypography['hyphenation'] })}
            />
            <SliderRow
              label="Indent"
              min={0}
              max={2}
              step={0.1}
              value={shown.indentEm}
              format={(v) => `${v.toFixed(1)} em`}
              onChange={(v) => patch({ indentEm: v })}
            />
          </>
        )}
      </div>

      <div className="reader-panel-section">
        <SliderRow
          label="Margins"
          min={0}
          max={MARGIN_MAX}
          step={1}
          value={shown.marginPercent}
          format={(v) => `${v} %`}
          onChange={(v) => patch({ marginPercent: v })}
        />
        <SliderRow
          label="Writing margin"
          min={0}
          max={WRITING_MARGIN_MAX}
          step={1}
          value={shown.writingMarginPercent}
          format={(v) => `${v} %`}
          onChange={(v) => patch({ writingMarginPercent: v })}
        />
        <ChoiceRow
          label="Columns"
          value={String(settings.columns)}
          options={[
            ['auto', 'Auto'],
            ['1', 'One'],
            ['2', 'Two'],
          ]}
          onChange={(value) => {
            const columns = value === '1' ? 1 : value === '2' ? 2 : 'auto';
            onPatchSettings({ ...settings, columns });
          }}
        />
      </div>

      <div className="reader-panel-section" role="radiogroup" aria-label="Theme">
        {(['paper', 'sepia', 'night'] as const).map((theme) => (
          <button
            key={theme}
            type="button"
            className={cx(`reader-swatch reader-swatch-${theme}`, settings.theme === theme && 'active')}
            aria-pressed={settings.theme === theme}
            onClick={() => onPatchSettings({ ...settings, theme })}
          >
            {theme[0].toUpperCase() + theme.slice(1)}
          </button>
        ))}
      </div>

      <div className="reader-panel-section">
        <h3 className="reader-panel-heading">Presets</h3>
        <div className="reader-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="reader-preset"
              title={preset.description}
              onClick={() => applyPreset(preset)}
            >
              <span className="reader-preset-name">{preset.name}</span>
              <span className="reader-preset-detail muted">{preset.description}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn reader-aa-action"
          title="Set line height, paragraph spacing, letter and word spacing at the WCAG AA minimums in one step"
          onClick={() => {
            if (debounceRef.current !== null) {
              window.clearTimeout(debounceRef.current);
              debounceRef.current = null;
            }
            setPending(null);
            onPatchTypography(applyTextSpacingAA(shown), scopeAll);
          }}
        >
          Text spacing (AA)
        </button>
        <button
          type="button"
          className="btn btn-quiet reader-reset"
          onClick={() => {
            setPending(null);
            onReset(scopeAll);
          }}
        >
          <Icon name="undo" size={14} /> Reset {scopeAll ? 'every book' : 'this book'}
        </button>
      </div>
    </aside>
  );
}

function ModeOption({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={cx('reader-mode-option', active && 'active')} aria-pressed={active} onClick={onClick}>
      <span className="reader-mode-name">{label}</span>
      <span className="reader-mode-desc muted">{description}</span>
    </button>
  );
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="reader-control">
      <span className="reader-control-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="reader-control-value numeric">{format(value)}</span>
    </label>
  );
}

function ChoiceRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="reader-control">
      <span className="reader-control-label">{label}</span>
      <select className="reader-control-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
