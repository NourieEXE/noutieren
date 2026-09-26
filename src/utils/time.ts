/** Formats a timestamp as a short relative string ("just now", "4 min ago"). */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'never';

  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Full timestamp for tooltips and `<time>` titles. */
export function formatAbsoluteTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown';
  return new Date(timestamp).toLocaleString();
}

/** `YYYY-MM-DD` for export filenames. */
export function isoDateStamp(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** True for plausible millisecond timestamps (1990 → +50 years from now). */
export function isValidTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 631152000000 &&
    value < Date.now() + 1000 * 60 * 60 * 24 * 365 * 50
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** When a reminder is due, from the reader's point of view: "Today, 18:00", "Tomorrow, 09:00", "Mon, 09:00". */
export function formatReminderTime(timestamp: number, now = Date.now()): string {
  const time = new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const days = Math.round((startOfDay(timestamp) - startOfDay(now)) / DAY_MS);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;
  const date = new Date(timestamp);
  const day =
    days > 1 && days < 7
      ? date.toLocaleDateString(undefined, { weekday: 'short' })
      : date.toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
        });
  return `${day}, ${time}`;
}

/** The `YYYY-MM-DDTHH:mm` a `datetime-local` input reads and writes, in local time. */
export function toDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
