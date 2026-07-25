/**
 * Inline SVG icons. Nothing is fetched at runtime — the extension ships no
 * remote assets and no icon font.
 *
 * Icons are always decorative here: every control that uses one carries its own
 * accessible name, so the `<svg>` is hidden from assistive technology.
 */

export type IconName =
  | 'plus'
  | 'close'
  | 'check'
  | 'chevronDown'
  | 'chevronLeft'
  | 'chevronRight'
  | 'arrowUp'
  | 'arrowDown'
  | 'trash'
  | 'copy'
  | 'search'
  | 'palette'
  | 'gear'
  | 'dots'
  | 'panelCollapse'
  | 'panelExpand'
  | 'externalLink'
  | 'help'
  | 'undo'
  | 'redo'
  | 'link'
  | 'linkOff'
  | 'listBullet'
  | 'listOrdered'
  | 'listCheck'
  | 'quote'
  | 'codeBlock'
  | 'clearFormat'
  | 'moveTo'
  | 'warning'
  | 'note';

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const PATHS: Record<IconName, React.ReactNode> = {
  plus: <path d="M8 3.5v9M3.5 8h9" {...STROKE} />,
  close: <path d="M4 4l8 8M12 4l-8 8" {...STROKE} />,
  check: <path d="M3.5 8.5l3 3 6-7" {...STROKE} />,
  chevronDown: <path d="M4 6.5l4 4 4-4" {...STROKE} />,
  chevronLeft: <path d="M9.5 4l-4 4 4 4" {...STROKE} />,
  chevronRight: <path d="M6.5 4l4 4-4 4" {...STROKE} />,
  arrowUp: <path d="M8 12.5v-9M4.5 7L8 3.5 11.5 7" {...STROKE} />,
  arrowDown: <path d="M8 3.5v9M4.5 9L8 12.5 11.5 9" {...STROKE} />,
  trash: (
    <>
      <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5" {...STROKE} />
      <path d="M4.5 4.5l.7 8h5.6l.7-8" {...STROKE} />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" {...STROKE} />
      <path d="M10 3.5H5A1.5 1.5 0 003.5 5v5" {...STROKE} />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="3.5" {...STROKE} />
      <path d="M9.8 9.8l2.7 2.7" {...STROKE} />
    </>
  ),
  palette: (
    <>
      <path
        d="M8 13.5a5.5 5.5 0 110-11c3 0 5.5 2 5.5 4.5S11 10 9.5 10h-1a1 1 0 00-.5 1.9"
        {...STROKE}
      />
      <circle cx="6" cy="6.5" r="0.9" fill="currentColor" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2" {...STROKE} />
      <path
        d="M8 2.5v1.2M8 12.3v1.2M3.6 5.4l1 .6M11.4 10l1 .6M3.6 10.6l1-.6M11.4 6l1-.6"
        {...STROKE}
      />
    </>
  ),
  dots: (
    <>
      <circle cx="4" cy="8" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="12" cy="8" r="1.15" fill="currentColor" />
    </>
  ),
  panelCollapse: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" {...STROKE} />
      <path d="M6.5 3v10M10.5 6.5L8.5 8l2 1.5" {...STROKE} />
    </>
  ),
  panelExpand: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" {...STROKE} />
      <path d="M6.5 3v10M8.5 6.5L10.5 8l-2 1.5" {...STROKE} />
    </>
  ),
  externalLink: (
    <>
      <path
        d="M12.5 9v3a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 12V5A1.5 1.5 0 014 3.5h3"
        {...STROKE}
      />
      <path d="M9.5 2.5h4v4M13.5 2.5L8 8" {...STROKE} />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="5.5" {...STROKE} />
      <path d="M6.5 6.3a1.6 1.6 0 113 .7c0 1-1.5 1.2-1.5 2.2" {...STROKE} />
      <circle cx="8" cy="11.4" r="0.75" fill="currentColor" />
    </>
  ),
  undo: (
    <>
      <path d="M3 7.5h6.5a3 3 0 010 6H7" {...STROKE} />
      <path d="M5.5 5L3 7.5 5.5 10" {...STROKE} />
    </>
  ),
  redo: (
    <>
      <path d="M13 7.5H6.5a3 3 0 000 6H9" {...STROKE} />
      <path d="M10.5 5L13 7.5 10.5 10" {...STROKE} />
    </>
  ),
  link: (
    <>
      <path d="M6.8 9.2a2.5 2.5 0 010-3.5l1.4-1.4a2.5 2.5 0 013.5 3.5l-.7.7" {...STROKE} />
      <path d="M9.2 6.8a2.5 2.5 0 010 3.5l-1.4 1.4a2.5 2.5 0 01-3.5-3.5l.7-.7" {...STROKE} />
    </>
  ),
  linkOff: (
    <>
      <path d="M7 9.5a2.5 2.5 0 01.3-3.2l1.4-1.4a2.5 2.5 0 013.5 3.5l-.7.7" {...STROKE} />
      <path d="M9 6.5a2.5 2.5 0 01-.3 3.2l-1.4 1.4a2.5 2.5 0 01-3.5-3.5" {...STROKE} />
      <path d="M2.5 2.5l11 11" {...STROKE} />
    </>
  ),
  listBullet: (
    <>
      <path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5" {...STROKE} />
      <circle cx="3.2" cy="4.5" r="1" fill="currentColor" />
      <circle cx="3.2" cy="8" r="1" fill="currentColor" />
      <circle cx="3.2" cy="11.5" r="1" fill="currentColor" />
    </>
  ),
  listOrdered: (
    <>
      <path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7" {...STROKE} />
      <text x="1.6" y="6" fontSize="5" fill="currentColor" stroke="none">
        1
      </text>
      <text x="1.6" y="13" fontSize="5" fill="currentColor" stroke="none">
        2
      </text>
    </>
  ),
  listCheck: (
    <>
      <path d="M7 4.5h6.5M7 11.5h6.5" {...STROKE} />
      <rect x="2" y="2.8" width="3.4" height="3.4" rx="0.8" {...STROKE} />
      <rect x="2" y="9.8" width="3.4" height="3.4" rx="0.8" {...STROKE} />
      <path d="M2.7 4.6l1 1 1.4-1.6" {...STROKE} strokeWidth={1.3} />
    </>
  ),
  quote: (
    <>
      <path d="M3.5 3.5v9" {...STROKE} strokeWidth={2} />
      <path d="M6.5 5.5h7M6.5 8.5h7M6.5 11.5h4" {...STROKE} />
    </>
  ),
  codeBlock: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" {...STROKE} />
      <path d="M6.5 6.5L5 8l1.5 1.5M9.5 6.5L11 8l-1.5 1.5" {...STROKE} />
    </>
  ),
  clearFormat: (
    <>
      <path d="M5 3.5h7.5M8.5 3.5L6.5 12.5" {...STROKE} />
      <path d="M9.5 9l3.5 3.5M13 9l-3.5 3.5" {...STROKE} strokeWidth={1.4} />
    </>
  ),
  moveTo: (
    <>
      <path d="M2.5 8h8" {...STROKE} />
      <path d="M8 5.5L10.5 8 8 10.5" {...STROKE} />
      <path d="M12 3.5v9" {...STROKE} />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.8l5.5 10H2.5z" {...STROKE} />
      <path d="M8 6.5v3" {...STROKE} />
      <circle cx="8" cy="11.3" r="0.7" fill="currentColor" />
    </>
  ),
  note: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" {...STROKE} />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" {...STROKE} />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
