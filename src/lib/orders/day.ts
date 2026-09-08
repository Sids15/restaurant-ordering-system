/**
 * The restaurant's calendar day, in the restaurant's timezone.
 *
 * This matters more than it looks. Vercel's functions run in UTC, so a naive
 * `new Date().setHours(0,0,0,0)` gives UTC midnight — 5:30am in Indore. Every
 * sitting between midnight and 5:30am would be filed under the previous day,
 * and the manager's takings would be quietly wrong for exactly the hours a
 * restaurant is busiest closing up.
 *
 * So the boundary is computed in `brand.timezone` and returned as UTC instants
 * for the query to compare against `timestamptz` columns.
 */
import { brand } from "../../data/brand";

/** A day's half-open range: `start <= t < end`, both UTC instants. */
export interface DayRange {
  start: Date;
  end: Date;
  /** The civil date this range covers, as YYYY-MM-DD in the restaurant's zone. */
  key: string;
}

/**
 * The offset (in minutes) between UTC and `timeZone` at a given instant. Derived
 * from Intl rather than hard-coded, so daylight saving is handled wherever the
 * restaurant is — India has none, but a white-label copy of this app might.
 */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  // `en-CA` gives an ISO-shaped date, which parses back predictably.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(at)) p[type] = value;
  // Interpret the zone's wall-clock reading as if it were UTC; the difference
  // from the real instant is the offset.
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour === "24" ? "0" : p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return (asUtc - at.getTime()) / 60000;
}

/** The civil date in the restaurant's zone at `at`, as YYYY-MM-DD. */
export function localDateKey(at: Date = new Date(), timeZone = brand.timezone): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Midnight-to-midnight for a given YYYY-MM-DD in the restaurant's zone,
 * expressed as UTC instants. Defaults to today.
 */
export function dayRange(dateKey?: string, timeZone = brand.timezone): DayRange {
  const key = dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : localDateKey(undefined, timeZone);
  const [y, m, d] = key.split("-").map(Number);

  // First guess: treat local midnight as UTC, then correct by the offset that
  // actually applies at that moment. One correction pass is enough for every
  // real zone — offsets are never more than a day out.
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const start = new Date(guess.getTime() - zoneOffsetMinutes(guess, timeZone) * 60000);
  const nextGuess = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  const end = new Date(nextGuess.getTime() - zoneOffsetMinutes(nextGuess, timeZone) * 60000);

  return { start, end, key };
}

/** Human label for a day key, e.g. "Sat, 7 Sep". "Today" when it is today. */
export function dayLabel(key: string, timeZone = brand.timezone): string {
  if (key === localDateKey(undefined, timeZone)) return "Today";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// --- Months (for the day picker) ---------------------------------------------

/** A month's half-open range: `start <= t < end`, both UTC instants. */
export interface MonthRange {
  start: Date;
  end: Date;
  /** YYYY-MM in the restaurant's zone. */
  key: string;
}

/** "2026-09-08" → "2026-09". */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** Move a YYYY-MM key by whole months. Handles the year boundary. */
export function shiftMonth(monthKey: string, by: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  // Date.UTC normalises month 0 → December of the previous year, and 12 → January
  // of the next, so December→January needs no special case.
  const at = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Midnight-to-midnight across a whole month, as UTC instants. */
export function monthRange(monthKey?: string, timeZone = brand.timezone): MonthRange {
  const key =
    monthKey && /^\d{4}-\d{2}$/.test(monthKey)
      ? monthKey
      : monthKeyOf(localDateKey(undefined, timeZone));
  const [y, m] = key.split("-").map(Number);
  const first = `${key}-01`;
  const nextFirst = `${shiftMonth(key, 1)}-01`;
  return {
    start: dayRange(first, timeZone).start,
    end: dayRange(nextFirst, timeZone).start,
    key,
  };
}

/** "September 2026". */
export function monthLabel(monthKey: string, timeZone = brand.timezone): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, 15, 12)));
}

/** One square in the picker. */
export interface DayCell {
  /** YYYY-MM-DD. */
  key: string;
  day: number;
  /** False for the leading/trailing days that belong to a neighbouring month. */
  inMonth: boolean;
  /** After today in the restaurant's zone — nothing to show, so not selectable. */
  future: boolean;
  today: boolean;
}

/**
 * The month as a grid of whole weeks, Monday first — so Saturday and Sunday sit
 * together at the end, which is how a restaurant reads its own week.
 *
 * Pure civil-date arithmetic: a calendar square is a date on a wall, not an
 * instant, so no timezone conversion happens here. The zone only decides which
 * day counts as "today".
 */
export function monthGrid(monthKey: string, timeZone = brand.timezone): DayCell[] {
  const [y, m] = monthKey.split("-").map(Number);
  const todayKey = localDateKey(undefined, timeZone);

  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  // getUTCDay is 0=Sunday; shift so 0=Monday.
  const lead = (firstOfMonth.getUTCDay() + 6) % 7;

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;

  const cells: DayCell[] = [];
  for (let i = 0; i < total; i++) {
    const at = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    const key = at.toISOString().slice(0, 10);
    cells.push({
      key,
      day: at.getUTCDate(),
      inMonth: at.getUTCMonth() === m - 1 && at.getUTCFullYear() === y,
      future: key > todayKey,
      today: key === todayKey,
    });
  }
  return cells;
}
