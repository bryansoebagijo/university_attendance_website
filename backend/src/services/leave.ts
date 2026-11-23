import { Prisma, type LeaveRequest } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError } from "../lib/http.js";
import { addDays, dateOnly, fromDateOnly, isWeekend, jakartaDate } from "../lib/time.js";
import { photoUrl } from "../lib/user-dto.js";

/** Working days (Mon–Fri, minus holidays) between two dates, inclusive. */
export function workdaysBetween(start: string, end: string, holidays: ReadonlySet<string> = new Set()): number {
  if (end < start) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (!isWeekend(d) && !holidays.has(d)) n++;
  return n;
}

/** Holiday dates (YYYY-MM-DD) between two dates, inclusive. */
export async function holidaysBetween(start: string, end: string, db: Db = prisma): Promise<Set<string>> {
  const rows = await db.holiday.findMany({ where: { date: { gte: dateOnly(start), lte: dateOnly(end) } }, select: { date: true } });
  return new Set(rows.map((r) => fromDateOnly(r.date)));
}

type Db = Prisma.TransactionClient | typeof prisma;

const yearBounds = (year: number) => ({ gte: dateOnly(`${year}-01-01`), lte: dateOnly(`${year}-12-31`) });

export interface Balance {
  year: number;
  quota: number;
  /** Approved leave days. */
  used: number;
  /** Days deducted for missing clock-outs not fixed in time. */
  deducted: number;
  /** Days in requests still waiting for a decision. */
  pending: number;
  /** quota − used − deducted (can go below 0 through deductions). */
  remaining: number;
  /** What can still be requested: remaining − pending. */
  available: number;
}

export async function getBalance(userId: string, year: number, db: Db = prisma): Promise<Balance> {
  const [user, approved, pending, deducted] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { annualQuota: true } }),
    db.leaveRequest.aggregate({ where: { userId, status: "APPROVED", startDate: yearBounds(year) }, _sum: { days: true } }),
    db.leaveRequest.aggregate({ where: { userId, status: "PENDING", startDate: yearBounds(year) }, _sum: { days: true } }),
    db.attendance.count({ where: { userId, status: "DEDUCTED", date: yearBounds(year) } }),
  ]);
  const used = approved._sum.days ?? 0;
  const pend = pending._sum.days ?? 0;
  const remaining = user.annualQuota - used - deducted;
  return { year, quota: user.annualQuota, used, deducted, pending: pend, remaining, available: remaining - pend };
}

/** Balances for many people at once (staff list). */
export async function getBalances(year: number) {
  const [users, approved, pending, deducted] = await Promise.all([
    prisma.user.findMany({ select: { id: true, annualQuota: true } }),
    prisma.leaveRequest.groupBy({ by: ["userId"], where: { status: "APPROVED", startDate: yearBounds(year) }, _sum: { days: true } }),
    prisma.leaveRequest.groupBy({ by: ["userId"], where: { status: "PENDING", startDate: yearBounds(year) }, _sum: { days: true } }),
    prisma.attendance.groupBy({ by: ["userId"], where: { status: "DEDUCTED", date: yearBounds(year) }, _count: { _all: true } }),
  ]);
  const sum = (rows: { userId: string; _sum: { days: number | null } }[], id: string) => rows.find((r) => r.userId === id)?._sum.days ?? 0;
  return Object.fromEntries(
    users.map((u) => {
      const used = sum(approved, u.id);
      const pend = sum(pending, u.id);
      const ded = deducted.find((r) => r.userId === u.id)?._count._all ?? 0;
      const remaining = u.annualQuota - used - ded;
      return [u.id, { year, quota: u.annualQuota, used, deducted: ded, pending: pend, remaining, available: remaining - pend } satisfies Balance];
    }),
  );
}

// ---- DTOs -------------------------------------------------------------------

export const leaveInclude = {
  decidedBy: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, nip: true, unit: true, photo: { select: { updatedAt: true } } } },
} satisfies Prisma.LeaveRequestInclude;

type Row = Prisma.LeaveRequestGetPayload<{ include: typeof leaveInclude }>;

export function toLeaveDto(l: Row) {
  return {
    id: l.id,
    userId: l.userId,
    start: fromDateOnly(l.startDate),
    end: fromDateOnly(l.endDate),
    days: l.days,
    reason: l.reason,
    status: l.status,
    createdAt: l.createdAt.toISOString(),
    decidedAt: l.decidedAt?.toISOString() ?? null,
    decisionNote: l.decisionNote,
    decidedBy: l.decidedBy,
    user: {
      id: l.user.id,
      name: l.user.name,
      nip: l.user.nip,
      unit: l.user.unit,
      photoUrl: l.user.photo ? photoUrl(l.user.id, l.user.photo.updatedAt) : null,
    },
  };
}

// ---- Rules ------------------------------------------------------------------

/** Other people's PENDING/APPROVED leave overlapping this period (helps approvers spot clashes). */
export async function overlapsFor(l: Pick<LeaveRequest, "id" | "startDate" | "endDate">) {
  const rows = await prisma.leaveRequest.findMany({
    where: { id: { not: l.id }, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: l.endDate }, endDate: { gte: l.startDate } },
    select: { id: true, startDate: true, endDate: true, status: true, user: { select: { name: true } } },
    orderBy: { startDate: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.user.name, start: fromDateOnly(r.startDate), end: fromDateOnly(r.endDate), status: r.status }));
}

export async function createRequest(userId: string, start: string, end: string, reason: string, now = new Date()) {
  const today = jakartaDate(now);
  if (end < start) throw new HttpError(400, "INVALID_RANGE");
  if (start < today) throw new HttpError(400, "START_IN_PAST");
  if (start.slice(0, 4) !== end.slice(0, 4)) throw new HttpError(400, "SPANS_YEARS");
  // Holidays count at the time of the request; adding a holiday later doesn't change existing requests.
  const days = workdaysBetween(start, end, await holidaysBetween(start, end));
  if (days === 0) throw new HttpError(400, "NO_WORKDAYS");

  // Serializable: two requests submitted at once can't both pass the balance check.
  return prisma.$transaction(
    async (tx) => {
      const clash = await tx.leaveRequest.findFirst({
        where: { userId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: dateOnly(end) }, endDate: { gte: dateOnly(start) } },
        select: { id: true },
      });
      if (clash) throw new HttpError(409, "OVERLAPS_EXISTING");
      const bal = await getBalance(userId, Number(start.slice(0, 4)), tx);
      if (days > bal.available) throw new HttpError(409, "INSUFFICIENT_BALANCE");
      const row = await tx.leaveRequest.create({
        data: { userId, startDate: dateOnly(start), endDate: dateOnly(end), days, reason },
        include: leaveInclude,
      });
      return toLeaveDto(row);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function cancelRequest(userId: string, id: string) {
  const { count } = await prisma.leaveRequest.deleteMany({ where: { id, userId, status: "PENDING" } });
  if (count === 0) throw new HttpError(409, "NOT_PENDING");
}

export async function decide(approverId: string, id: string, approve: boolean, note: string | undefined, now = new Date()) {
  if (!approve && !note) throw new HttpError(400, "NOTE_REQUIRED");
  return prisma.$transaction(
    async (tx) => {
      const req = await tx.leaveRequest.findUnique({ where: { id } });
      if (!req) throw new HttpError(404, "NOT_FOUND");
      if (req.status !== "PENDING") throw new HttpError(409, "NOT_PENDING");
      if (req.userId === approverId) throw new HttpError(403, "OWN_REQUEST");
      if (approve) {
        // Re-check at decision time: deductions may have landed since the request was made.
        const bal = await getBalance(req.userId, req.startDate.getUTCFullYear(), tx);
        // \`remaining\` still counts this request as pending, not used.
        if (req.days > bal.remaining) throw new HttpError(409, "INSUFFICIENT_BALANCE");
      }
      const row = await tx.leaveRequest.update({
        where: { id },
        data: { status: approve ? "APPROVED" : "REJECTED", decidedById: approverId, decidedAt: now, decisionNote: note || null },
        include: leaveInclude,
      });
      return toLeaveDto(row);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
