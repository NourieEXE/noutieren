/**
 * URL handling for note links.
 *
 * Only http, https and mailto are allowed. This blocks `javascript:`,
 * `data:` and extension-internal schemes from ever reaching an anchor's href,
 * whether typed by the user or read from an imported backup.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Returns a safe absolute URL, or `null` if the input cannot be trusted. */
export function sanitizeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;

  // Bare domains typed by the user ("example.com/page") get https://.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (url.protocol !== 'mailto:' && url.hostname.length === 0) return null;
  return url.toString();
}

/** Shortens a URL for display in a link editor or tooltip. */
export function displayUrl(href: string, maxLength = 48): string {
  const stripped = href.replace(/^https?:\/\//, '');
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength - 1)}…` : stripped;
}
