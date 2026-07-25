/**
 * Color handling for tabs and notes.
 *
 * Every color that reaches the DOM goes through `normalizeColor` first, so a
 * malformed value in storage or in an imported backup can never be injected
 * into a style attribute.
 */

export interface PaletteEntry {
  value: string;
  name: string;
}

/**
 * Preset palette: ten hues plus two neutrals.
 *
 * Every entry reaches at least WCAG AA (4.5:1) against the better of the two
 * foregrounds `readableTextColor` can choose, which a test enforces. Indigo is
 * deliberately the 600-weight `#4f46e5` rather than the more common `#6366f1`,
 * which only manages 4.47:1 with white text.
 */
export const COLOR_PALETTE: readonly PaletteEntry[] = [
  { value: '#64748b', name: 'Slate' },
  { value: '#78716c', name: 'Stone' },
  { value: '#ef4444', name: 'Red' },
  { value: '#f97316', name: 'Orange' },
  { value: '#f59e0b', name: 'Amber' },
  { value: '#22c55e', name: 'Green' },
  { value: '#14b8a6', name: 'Teal' },
  { value: '#0ea5e9', name: 'Sky' },
  { value: '#4f46e5', name: 'Indigo' },
  { value: '#a855f7', name: 'Purple' },
  { value: '#ec4899', name: 'Pink' },
  { value: '#0f766e', name: 'Pine' },
];

export const DEFAULT_TAB_COLOR = '#64748b';
export const DEFAULT_NOTE_COLOR = '#64748b';

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for `#rgb` / `#rrggbb` strings only. */
export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_PATTERN.test(value.trim());
}

/** Expands shorthand hex and lowercases; returns `fallback` for bad input. */
export function normalizeColor(value: unknown, fallback = DEFAULT_TAB_COLOR): string {
  if (!isValidColor(value)) return fallback;
  const hex = value.trim().toLowerCase();
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

function toRgb(hex: string): [number, number, number] {
  const normalized = normalizeColor(hex);
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: string): number {
  const [r, g, b] = toRgb(color);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Picks near-black or near-white text for an arbitrary background, whichever
 * has more contrast — never renders text on a color without checking.
 */
export function readableTextColor(background: string): string {
  const dark = '#0f172a';
  const light = '#ffffff';
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

/** `rgba()` string for subtle tints (card backgrounds, hover states). */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = toRgb(color);
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

/** Human-readable name for a palette color, for accessible labels. */
export function colorName(value: string): string {
  const normalized = normalizeColor(value);
  return (
    COLOR_PALETTE.find((entry) => entry.value === normalized)?.name ?? `Custom (${normalized})`
  );
}
