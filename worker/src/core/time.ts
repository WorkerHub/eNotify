/** Returns the current UTC time as an ISO 8601 string. */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Returns a Date whose year/month/day/hour/minute/second components match
 * the current wall-clock time in the given IANA timezone.
 *
 * Note: the underlying Date value is expressed as local (UTC in Workers), so
 * use getFullYear/getMonth/… (not getUTC*) to read the timezone-localised parts.
 */
export function nowInTimezone(timezone: string): Date {
  const now = new Date();

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(now);
  const get = (type: string): number =>
    parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);

  const year = get('year');
  const month = get('month') - 1; // Date constructor months are 0-indexed
  const day = get('day');
  const hour = get('hour') % 24; // guard against the rare "24:00" edge case
  const minute = get('minute');
  const second = get('second');

  return new Date(year, month, day, hour, minute, second);
}

/**
 * Add a calendar period to an ISO date string (YYYY-MM-DD or full ISO).
 * Returns YYYY-MM-DD of the resulting UTC date.
 */
export function addPeriod(date: string, value: number, unit: 'day' | 'month' | 'year'): string {
  const d = new Date(date);

  if (unit === 'day') {
    d.setUTCDate(d.getUTCDate() + value);
  } else if (unit === 'month') {
    const origDay = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + value);
    if (d.getUTCDate() !== origDay) {
      d.setUTCDate(0);
    }
  } else {
    const origDay = d.getUTCDate();
    d.setUTCFullYear(d.getUTCFullYear() + value);
    if (d.getUTCDate() !== origDay) {
      d.setUTCDate(0);
    }
  }

  return d.toISOString().slice(0, 10);
}

/**
 * Signed difference in fractional hours: (date2 − date1).
 * Positive when date2 is after date1.
 */
export function diffInHours(date1: string, date2: string): number {
  return (new Date(date2).getTime() - new Date(date1).getTime()) / 3_600_000;
}

/**
 * Signed difference in fractional days: (date2 − date1).
 * Positive when date2 is after date1.
 */
export function diffInDays(date1: string, date2: string): number {
  return (new Date(date2).getTime() - new Date(date1).getTime()) / 86_400_000;
}
