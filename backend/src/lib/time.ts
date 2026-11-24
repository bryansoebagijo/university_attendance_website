// Business dates and times are in Asia/Jakarta (WIB, UTC+7, no daylight saving).
export const TZ = "Asia/Jakarta";
const OFFSET = "+07:00";

/** A missing clock-out must be fixed within this many months, or 1 leave day is deducted. */
export const FIX_WINDOW_MONTHS = 2;

/** YYYY-MM-DD in Jakarta for an instant. */
export function jakartaDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** HH:mm in Jakarta for an instant. */
export function jakartaTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** The instant for a Jakarta date + HH:mm. */
export function jakartaInstant(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00${OFFSET}`);
}

/** Prisma @db.Date columns hold a UTC-midnight Date for the calendar day. */
export function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
export function fromDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
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

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function fixDeadline(date: string): string {
  return addMonths(date, FIX_WINDOW_MONTHS);
}

/** First and last day of a YYYY-MM month. */
export function monthRange(ym: string): { from: string; to: string } {
  const from = `${ym}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}
