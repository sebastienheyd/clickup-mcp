/**
 * Date parameters as tools receive them: an ISO date with a time of day
 * ("2026-10-02T18:00:00+02:00") or a bare date ("2026-10-02").
 */
export interface ParsedDateInput {
  /** Milliseconds since the epoch */
  timestamp: number;
  /** false for a bare date (YYYY-MM-DD), which stands for a whole local day */
  hasTime: boolean;
}

const LEADING_DATE = /^(\d{4})-(\d{2})-(\d{2})(.*)$/;

/**
 * Parse a date parameter, or throw an error that names the field.
 *
 * Two silent failures are turned into errors on purpose:
 * - an unparseable string gives NaN, which JSON.stringify sends as `null` - a
 *   due date would be cleared while the tool reports success;
 * - JavaScript rolls impossible days over instead of rejecting them, with or
 *   without a time ("2026-02-31" and "2026-02-31T10:00" both become March 3rd).
 *
 * A bare date is a whole LOCAL day: `new Date("2026-10-02")` would be UTC
 * midnight, i.e. the previous evening east of Greenwich. `bareDateAt` picks the
 * start (00:00:00.000) or the end (23:59:59.999) of that day.
 */
export function parseDateInput(
  value: string,
  field: string,
  bareDateAt: "start" | "end" = "start"
): ParsedDateInput {
  const trimmed = value.trim();
  const leading = LEADING_DATE.exec(trimmed);

  if (leading) {
    const [, yearText, monthText, dayText, rest] = leading;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const daysInMonth = month >= 1 && month <= 12 ? new Date(year, month, 0).getDate() : 0;
    if (day < 1 || day > daysInMonth) {
      throw new Error(
        `Invalid ${field} "${value}": ${yearText}-${monthText}-${dayText} is not a calendar date.`
      );
    }
    if (rest === "") {
      const timestamp = bareDateAt === "start"
        ? new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
        : new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
      return { timestamp, hasTime: false };
    }
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    throw new Error(
      `Invalid ${field} "${value}". Expected an ISO date with a time of day (e.g. 2026-10-02T18:00:00+02:00) or a bare date (YYYY-MM-DD).`
    );
  }
  return { timestamp, hasTime: true };
}
