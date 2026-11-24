import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { addDays, fromDateOnly } from "../lib/time.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** Monday–Friday: applies to anyone without a schedule (or before their first one). */
export const DEFAULT_DAYS = [1, 2, 3, 4, 5] as const;

/** One schedule period: these ISO weekdays (1 = Mon … 7 = Sun) from `from` on. */
export interface SchedulePeriod {
  id: string | null;
  from: string; // YYYY-MM-DD
  days: number[];
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export const parseDays = (s: string) =>
  [...new Set(s.split("").map(Number))].filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
export const formatDays = (days: readonly number[]) => [...new Set(days)].sort((a, b) => a - b).join("");

/** A person's schedule history, oldest first. */
export type ScheduleHistory = SchedulePeriod[];

/** Schedule histories for these users (all users when omitted). */
export async function loadSchedules(userIds?: string[], db: Db = prisma): Promise<Map<string, ScheduleHistory>> {
  const rows = await db.workSchedule.findMany({
    where: userIds ? { userId: { in: userIds } } : {},
    orderBy: { effectiveFrom: "asc" },
  });
  const map = new Map<string, ScheduleHistory>();
  for (const r of rows) {
    const list = map.get(r.userId) ?? [];
    list.push({ id: r.id, from: fromDateOnly(r.effectiveFrom), days: parseDays(r.days) });
    map.set(r.userId, list);
  }
  return map;
}

export async function loadSchedule(userId: string, db: Db = prisma): Promise<ScheduleHistory> {
  return (await loadSchedules([userId], db)).get(userId) ?? [];
}

/** The weekdays that apply on a date. */
export function daysOn(history: ScheduleHistory | undefined, date: string): number[] {
  let days: readonly number[] = DEFAULT_DAYS;
  for (const p of history ?? []) {
    if (p.from <= date) days = p.days;
    else break;
  }
  return [...days];
}

/** Is the person expected on campus that date? (Holidays are excluded separately.) */
export function isScheduled(history: ScheduleHistory | undefined, date: string, holidays?: ReadonlySet<string>): boolean {
  if (holidays?.has(date)) return false;
  return daysOn(history, date).includes(isoWeekday(date));
}

/** Scheduled, non-holiday dates between two dates, inclusive. */
export function scheduledDates(history: ScheduleHistory | undefined, start: string, end: string, holidays: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (isScheduled(history, d, holidays)) out.push(d);
  return out;
}

/** The current period plus the next upcoming change, for display. */
export function currentAndNext(history: ScheduleHistory, today: string) {
  const current = [...history].reverse().find((p) => p.from <= today) ?? { id: null, from: null, days: [...DEFAULT_DAYS] };
  const next = history.find((p) => p.from > today) ?? null;
  return { current: { ...current, isDefault: current.id === null }, next };
}

export const scheduleDto = (history: ScheduleHistory, today: string) => ({ ...currentAndNext(history, today), history });

/** For attendance lists: was each record on a scheduled day? */
export async function scheduledFlags(rows: { id: string; userId: string; date: Date }[], holidays: ReadonlySet<string>): Promise<Map<string, boolean>> {
  const schedules = await loadSchedules([...new Set(rows.map((r) => r.userId))]);
  return new Map(rows.map((r) => [r.id, isScheduled(schedules.get(r.userId), fromDateOnly(r.date), holidays)]));
}
