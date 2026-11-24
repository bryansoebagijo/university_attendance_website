// Date helpers. All business dates are in Asia/Jakarta (WIB, UTC+7).
import type { Locale } from "./i18n";

export const TZ = "Asia/Jakarta";
const intlLocale = (l: Locale) => (l === "id" ? "id-ID" : "en-GB");

/** YYYY-MM-DD for the given instant in Jakarta. */
export function jakartaDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Build an ISO instant from a Jakarta date + HH:mm. */
export function jakartaInstant(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00+07:00`).toISOString();
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  );
}

export function fmtDate(date: string, locale: Locale, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = new Date(`${date}T12:00:00+07:00`);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...opts,
  }).format(d);
}

export function fmtDateLong(date: string, locale: Locale): string {
  return fmtDate(date, locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function fmtWeekday(date: string, locale: Locale): string {
  return fmtDate(date, locale, { weekday: "short", day: undefined, month: undefined, year: undefined });
}

export function fmtMonth(ym: string, locale: Locale): string {
  return fmtDate(`${ym}-15`, locale, { day: undefined, month: "long", year: "numeric" });
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86400000);
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Working days (Mon–Fri, minus holidays) between two dates, inclusive. Mirrors the backend's count. */
export function workdaysBetween(start: string, end: string, holidays: ReadonlySet<string> = new Set()): number {
  if (!start || !end || end < start) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!isWeekend(d) && !holidays.has(d)) n++;
  return n;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}

/** Weekdays that apply on a date: the newest period starting on or before it, else Monday–Friday. Mirrors the backend. */
export function scheduleDaysOn(history: { from: string | null; days: number[] }[] | undefined, date: string): number[] {
  let days = [1, 2, 3, 4, 5];
  for (const p of history ?? []) if (p.from && p.from <= date) days = p.days;
  return days;
}

/** Scheduled days (minus holidays) between two dates, inclusive: how leave is counted. */
export function scheduledDaysBetween(
  start: string,
  end: string,
  history: { from: string | null; days: number[] }[] | undefined,
  holidays: ReadonlySet<string> = new Set(),
): number {
  if (!start || !end || end < start) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!holidays.has(d) && scheduleDaysOn(history, d).includes(isoWeekday(d))) n++;
  return n;
}

export function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

export function fmtDuration(mins: number, locale: Locale): string {
  const h = Math.floor(mins / 60);
  const m = String(mins % 60).padStart(2, "0");
  return locale === "id" ? `${h} jam ${m} mnt` : `${h}h ${m}m`;
}

export function jakartaHour(d: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d));
}

/** Missing clock-outs must be fixed within 2 months of the attendance date. */
export const FIX_WINDOW_MONTHS = 2;
export function fixDeadline(date: string): string {
  return addMonths(date, FIX_WINDOW_MONTHS);
}
