import { useId } from 'react';
import { COLOR_PALETTE, normalizeColor, readableTextColor } from '../utils/colors';
import { Icon } from './Icons';

/**
 * Compact color picker: a preset palette plus a native color input.
 *
 * Built from real radio inputs so keyboard behaviour (arrow keys within the
 * group, Space to choose) is the browser's, not a re-implementation. The chosen
 * swatch shows a check mark and the value is printed as text, so selection is
 * never conveyed by color alone.
 */
export function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  const groupName = useId();
  const customId = useId();
  const current = normalizeColor(value);
  const isPreset = COLOR_PALETTE.some((entry) => entry.value === current);

  return (
    <fieldset className="color-picker">
      <legend className="color-picker__legend">{label}</legend>

      <div className="color-picker__grid">
        {COLOR_PALETTE.map((entry) => {
          const selected = entry.value === current;
          return (
            <label
              key={entry.value}
              className={`swatch${selected ? ' swatch--selected' : ''}`}
              style={{ ['--swatch-color' as string]: entry.value }}
            >
              <input
                type="radio"
                name={groupName}
                value={entry.value}
                checked={selected}
                onChange={() => onChange(entry.value)}
                className="swatch__input"
              />
              <span className="swatch__chip" aria-hidden="true">
                {selected ? (
                  <span className="swatch__check" style={{ color: readableTextColor(entry.value) }}>
                    <Icon name="check" size={12} />
                  </span>
                ) : null}
              </span>
              <span className="swatch__name">{entry.name}</span>
            </label>
          );
        })}
      </div>

      <div className="color-picker__custom">
        <label className="field__label" htmlFor={customId}>
          Custom color
        </label>
        <div className="color-picker__custom-row">
          <input
            id={customId}
            type="color"
            className="color-input"
            value={current}
            onChange={(event) => onChange(event.target.value)}
          />
          <output className="color-picker__value" htmlFor={customId}>
            {current}
            {isPreset ? '' : ' (custom)'}
          </output>
        </div>
      </div>
    </fieldset>
  );
}
