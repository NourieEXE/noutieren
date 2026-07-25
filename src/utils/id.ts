/**
 * Stable UUIDs for tabs and notes.
 *
 * `crypto.randomUUID` is available in every Firefox version this extension
 * supports; the fallback exists only so the module stays usable in test
 * environments that provide a partial `crypto` implementation.
 */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 version 4 layout.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accepts canonical UUIDs and other reasonable opaque ids, so backups written
 * by future versions (or hand-edited files) are not rejected for cosmetic
 * reasons. Anything empty, oversized, or non-string is rejected.
 */
export function isValidId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (UUID_PATTERN.test(value)) return true;
  return value.length > 0 && value.length <= 128 && /^[\w.:-]+$/.test(value);
}
