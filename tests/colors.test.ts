import { describe, expect, it } from 'vitest';
import {
  COLOR_PALETTE,
  colorName,
  contrastRatio,
  isValidColor,
  normalizeColor,
  readableTextColor,
  withAlpha,
} from '../src/utils/colors';

describe('color validation', () => {
  it('accepts three- and six-digit hex values', () => {
    expect(isValidColor('#fff')).toBe(true);
    expect(isValidColor('#A1B2C3')).toBe(true);
  });

  it('rejects anything that is not a hex color', () => {
    for (const value of [
      'red',
      'rgb(1,2,3)',
      '#12',
      '#1234567',
      'javascript:alert(1)',
      'url(x)',
      '',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isValidColor(value)).toBe(false);
    }
  });

  it('expands shorthand and falls back for invalid input', () => {
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeColor('  #FF8800 ')).toBe('#ff8800');
    expect(normalizeColor('not a color', '#123456')).toBe('#123456');
    expect(normalizeColor(undefined)).toBe('#64748b');
  });
});

describe('contrast', () => {
  it('computes known WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('picks the foreground with more contrast', () => {
    expect(readableTextColor('#ffffff')).toBe('#0f172a');
    expect(readableTextColor('#000000')).toBe('#ffffff');
  });

  it('gives every palette color a foreground that meets WCAG AA for UI text', () => {
    for (const entry of COLOR_PALETTE) {
      const foreground = readableTextColor(entry.value);
      // 4.5:1 is the AA threshold for normal-sized text.
      expect(
        contrastRatio(entry.value, foreground),
        `${entry.name} (${entry.value}) on ${foreground}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('helpers', () => {
  it('builds rgba strings and clamps alpha', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(withAlpha('#ff0000', 5)).toBe('rgba(255, 0, 0, 1)');
    expect(withAlpha('#ff0000', -1)).toBe('rgba(255, 0, 0, 0)');
  });

  it('names palette colors and marks others as custom', () => {
    expect(colorName('#ef4444')).toBe('Red');
    expect(colorName('#123456')).toContain('Custom');
  });

  it('offers between ten and twelve presets including neutrals', () => {
    expect(COLOR_PALETTE.length).toBeGreaterThanOrEqual(10);
    expect(COLOR_PALETTE.length).toBeLessThanOrEqual(12);
    expect(COLOR_PALETTE.map((entry) => entry.name)).toContain('Slate');
  });
});
