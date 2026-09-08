/**
 * The period a back-of-house page is reporting on, resolved from the URL.
 *
 * Both the day view and the analytics page let a manager choose a day or a
 * range with the same calendar, so the URL grammar, the stepping, the presets
 * and the two-click range selection live here once rather than in each page.
 *
 *   ?date=YYYY-MM-DD          one day
 *   ?from=…&to=…              a range, inclusive of both days
 *   ?from=…&pick=range        a range with one end chosen, awaiting the other
 *   ?month=YYYY-MM            which month the calendar is showing
 *
 * Selection state lives entirely in the URL, which is what lets the picker work
 * with JavaScript switched off.
 */
import {
  dayRange,
  dayLabel,
  dateRange,
  rangeLabel,
  daysBetween,
  localDateKey,
  monthKeyOf,
  shiftMonth,
  type Period,
} from "./day";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

export interface Preset {
  label: string;
  from: string;
  to: string;
}

export interface PeriodSelection {
  /** What to report on. */
  period: Period;
  /** The equally-long span immediately before it, for comparison. */
  previous: Period;
  from: string;
  to: string;
  isRange: boolean;
  /** Whole days covered, inclusive. */
  span: number;
  /** Human label for the masthead: "Today", "3 Sept", "1 – 7 Sept". */
  label: string;
  today: string;
  /** True when the period runs up to today, so stepping forward is disabled. */
  atEnd: boolean;
  prevHref: string;
  nextHref: string;
  /** Which month the calendar shows. */
  viewMonth: string;
  thisMonth: string;
  /** The calendar is in range-selection mode. */
  picking: boolean;
  /** One end of a range is chosen and the other is awaited. */
  pendingFrom: string | null;
  dayHref: (key: string) => string;
  monthHref: (key: string) => string;
  presets: Preset[];
}

/** Shift a date key by whole days. */
export function shiftDay(key: string, by: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by, 12)).toISOString().slice(0, 10);
}

export interface ResolveOptions {
  /** With no parameters, look at this many days ending today. Omit for one day. */
  defaultDays?: number;
}

export function resolvePeriod(
  url: URL,
  basePath: string,
  options: ResolveOptions = {},
): PeriodSelection {
  const sp = url.searchParams;
  const today = localDateKey();
  const clamp = (key: string) => (key > today ? today : key);

  const rawFrom = sp.get("from");
  const rawTo = sp.get("to");
  const rawDate = sp.get("date");
  const hasRange = Boolean(rawFrom && rawTo && DATE.test(rawFrom) && DATE.test(rawTo));
  const hasDay = Boolean(rawDate && DATE.test(rawDate));

  // A page that reports on a span (analytics) opens on one; a page that reports
  // on a day (the day view) opens on today.
  const fallbackDays = options.defaultDays ?? 1;
  const isRange = hasRange || (!hasDay && fallbackDays > 1);

  let from: string;
  let to: string;
  if (hasRange) {
    const r = dateRange(clamp(rawFrom!), clamp(rawTo!));
    from = r.from;
    to = r.to;
  } else if (hasDay) {
    from = to = clamp(rawDate!);
  } else if (fallbackDays > 1) {
    from = shiftDay(today, -(fallbackDays - 1));
    to = today;
  } else {
    from = to = today;
  }

  const period: Period = isRange ? dateRange(from, to) : dayRange(from);
  const span = daysBetween(from, to);
  const previous: Period = dateRange(shiftDay(from, -span), shiftDay(to, -span));

  // Stepping moves by the width of what you are looking at, and stops at today.
  const step = (by: number) =>
    isRange
      ? `${basePath}?from=${clamp(shiftDay(from, by * span))}&to=${clamp(shiftDay(to, by * span))}`
      : `${basePath}?date=${clamp(shiftDay(from, by))}`;

  const picking = sp.get("pick") === "range";
  const pendingFrom = picking && rawFrom && DATE.test(rawFrom) && !rawTo ? rawFrom : null;

  const monthParam = sp.get("month");
  const viewMonth = monthParam && MONTH.test(monthParam) ? monthParam : monthKeyOf(to);
  const thisMonth = monthKeyOf(today);

  return {
    period,
    previous,
    from,
    to,
    isRange,
    span,
    label: isRange ? rangeLabel(from, to) : dayLabel(from),
    today,
    atEnd: to >= today,
    prevHref: step(-1),
    nextHref: step(1),
    viewMonth,
    thisMonth,
    picking,
    pendingFrom,

    // Two clicks make a range: the first lands ?from= alone, the second
    // completes it. dateRange() sorts the pair, so picking the earlier day
    // second still gives the span the manager plainly meant.
    dayHref: (key: string) =>
      pendingFrom
        ? `${basePath}?from=${pendingFrom}&to=${key}`
        : picking
          ? `${basePath}?from=${key}&pick=range&month=${viewMonth}`
          : `${basePath}?date=${key}`,

    // Paging the calendar keeps the period, or a half-finished selection.
    monthHref: (key: string) => {
      const state = pendingFrom
        ? `from=${pendingFrom}&pick=range`
        : isRange
          ? `from=${from}&to=${to}${picking ? "&pick=range" : ""}`
          : `date=${from}${picking ? "&pick=range" : ""}`;
      return `${basePath}?${state}&month=${key}`;
    },

    presets: [
      { label: "Last 7 days", from: shiftDay(today, -6), to: today },
      { label: "Last 30 days", from: shiftDay(today, -29), to: today },
      { label: "This month", from: `${thisMonth}-01`, to: today },
      {
        label: "Last month",
        from: `${shiftMonth(thisMonth, -1)}-01`,
        to: shiftDay(`${thisMonth}-01`, -1),
      },
    ],
  };
}
