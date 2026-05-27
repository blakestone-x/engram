/** Date helpers. Everything in Engram speaks ISO `YYYY-MM-DD` for stored dates. */

const MS_PER_DAY = 86_400_000;

/** Today's date as `YYYY-MM-DD` (local). */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Current instant as a full ISO timestamp. */
export function nowISO(now: Date = new Date()): string {
  return now.toISOString();
}

/** Parse an ISO date string to a Date at UTC midnight; null on failure. */
export function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whole-and-fractional days between two dates (b - a), floored at 0 by callers
 * that need non-negative elapsed time.
 */
export function daysBetween(a: string | Date, b: string | Date): number {
  const da = a instanceof Date ? a : parseDate(a);
  const db = b instanceof Date ? b : parseDate(b);
  if (!da || !db) return 0;
  return (db.getTime() - da.getTime()) / MS_PER_DAY;
}

/** Days elapsed from `from` until `now`, never negative. */
export function elapsedDays(from: string | Date, now: Date = new Date()): number {
  return Math.max(0, daysBetween(from, now));
}
