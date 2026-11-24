import { Prisma, type Attendance, type Location, type ScanMethod } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpError } from "../lib/http.js";
import { parseToken, verifyToken } from "../lib/qr.js";
import { addDays, dateOnly, fixDeadline, fromDateOnly, jakartaDate, jakartaInstant, jakartaTime, WORK_START } from "../lib/time.js";

type Row = Attendance & { inLocation: Pick<Location, "id" | "name">; outLocation: Pick<Location, "id" | "name"> | null };

export const attendanceInclude = {
  inLocation: { select: { id: true, name: true } },
  outLocation: { select: { id: true, name: true } },
} satisfies Prisma.AttendanceInclude;

export function toAttendanceDto(a: Row) {
  const date = fromDateOnly(a.date);
  return {
    id: a.id,
    userId: a.userId,
    date,
    clockIn: a.clockIn.toISOString(),
    clockOut: a.clockOut?.toISOString() ?? null,
    inLocation: a.inLocation,
    outLocation: a.outLocation,
    status: a.status,
    inMethod: a.inMethod,
    outMethod: a.outMethod,
    late: jakartaTime(a.clockIn) > WORK_START,
    fixReason: a.fixReason,
    fixedAt: a.fixedAt?.toISOString() ?? null,
    deductedAt: a.deductedAt?.toISOString() ?? null,
    fixDeadline: a.status === "MISSING_CLOCK_OUT" ? fixDeadline(date) : null,
  };
}
export type AttendanceDto = ReturnType<typeof toAttendanceDto>;

// ---- Scan ------------------------------------------------------------------

export type ScanAction = "in" | "out";

/**
 * Clock in or out with a kiosk QR token. Time and date come from the server clock,
 * never from the client. Error codes map 1:1 to messages in the frontend.
 */
export async function scan(userId: string, token: string, action: ScanAction, now = new Date(), method: ScanMethod = "CAMERA") {
  const parsed = parseToken(token);
  if (!parsed) throw new HttpError(400, "INVALID_QR");
  const location = await prisma.location.findUnique({ where: { id: parsed.locationId } });
  if (!location) throw new HttpError(400, "INVALID_QR");
  const check = verifyToken(parsed, location.qrSecret, now.getTime());
  if (check === "invalid") throw new HttpError(400, "INVALID_QR");
  if (check === "expired") throw new HttpError(400, "EXPIRED_QR");
  if (!location.active) throw new HttpError(400, "LOCATION_INACTIVE");

  const date = dateOnly(jakartaDate(now));
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId, date } } });

  let record: Row;
  if (action === "in") {
    if (existing) throw new HttpError(409, existing.clockOut ? "ALREADY_DONE" : "ALREADY_CLOCKED_IN");
    try {
      record = await prisma.attendance.create({
        data: { userId, date, clockIn: now, inLocationId: location.id, status: "CLOCKED_IN", inMethod: method },
        include: attendanceInclude,
      });
    } catch (e) {
      // Two scans at the same moment: the unique (userId, date) index lets only one through.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "ALREADY_CLOCKED_IN");
      throw e;
    }
  } else {
    if (!existing) throw new HttpError(409, "NOT_CLOCKED_IN");
    // Conditional update so a double scan can't overwrite the first clock-out.
    const { count } = await prisma.attendance.updateMany({
      where: { id: existing.id, clockOut: null, status: "CLOCKED_IN" },
      data: { clockOut: now, outLocationId: location.id, status: "COMPLETE", outMethod: method },
    });
    if (count === 0) throw new HttpError(409, "ALREADY_DONE");
    record = await prisma.attendance.findUniqueOrThrow({ where: { id: existing.id }, include: attendanceInclude });
  }
  return { record: toAttendanceDto(record), location: { id: location.id, name: location.name } };
}

// ---- Fix a missing clock-out ------------------------------------------------

export async function fixClockOut(userId: string, attendanceId: string, hhmm: string, reason: string, now = new Date()) {
  const a = await prisma.attendance.findUnique({ where: { id: attendanceId } });
  if (!a || a.userId !== userId) throw new HttpError(404, "NOT_FOUND");
  if (a.status !== "MISSING_CLOCK_OUT") throw new HttpError(409, "NOT_FIXABLE");
  const date = fromDateOnly(a.date);
  if (fixDeadline(date) < jakartaDate(now)) throw new HttpError(409, "FIX_WINDOW_CLOSED");
  const clockOut = jakartaInstant(date, hhmm);
  if (clockOut <= a.clockIn) throw new HttpError(400, "CLOCK_OUT_BEFORE_IN");
  if (clockOut > now) throw new HttpError(400, "CLOCK_OUT_IN_FUTURE");

  const { count } = await prisma.attendance.updateMany({
    where: { id: a.id, status: "MISSING_CLOCK_OUT" },
    data: { clockOut, status: "FIXED", fixReason: reason, fixedAt: now },
  });
  if (count === 0) throw new HttpError(409, "NOT_FIXABLE");
  return toAttendanceDto(await prisma.attendance.findUniqueOrThrow({ where: { id: a.id }, include: attendanceInclude }));
}

// ---- Sick-leave cover --------------------------------------------------------

/**
 * Which of these attendance rows fall on a day covered by the same person's APPROVED sick leave.
 * Such days are never deducted from annual leave (e.g. clocked in, then went home sick).
 */
export async function sickCovered(rows: { id: string; userId: string; date: Date }[]): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const dates = rows.map((r) => r.date.getTime());
  const sick = await prisma.leaveRequest.findMany({
    where: {
      type: "SICK",
      status: "APPROVED",
      userId: { in: [...new Set(rows.map((r) => r.userId))] },
      startDate: { lte: new Date(Math.max(...dates)) },
      endDate: { gte: new Date(Math.min(...dates)) },
    },
    select: { userId: true, startDate: true, endDate: true },
  });
  return new Set(
    rows.filter((r) => sick.some((l) => l.userId === r.userId && l.startDate <= r.date && l.endDate >= r.date)).map((r) => r.id),
  );
}

// ---- Daily rules (scheduled job) -------------------------------------------

/**
 * 1. Any day before today still CLOCKED_IN → MISSING_CLOCK_OUT.
 * 2. MISSING_CLOCK_OUT past its 2-month fix deadline → DEDUCTED (1 annual-leave day),
 *    unless that day is covered by approved sick leave.
 * Safe to run any number of times.
 */
export async function runDailyRules(now = new Date()) {
  const today = jakartaDate(now);
  const closed = await prisma.attendance.updateMany({
    where: { status: "CLOCKED_IN", date: { lt: dateOnly(today) } },
    data: { status: "MISSING_CLOCK_OUT" },
  });

  // Candidates are at least ~59 days old; the exact month arithmetic is checked per row.
  const candidates = await prisma.attendance.findMany({
    where: { status: "MISSING_CLOCK_OUT", date: { lte: dateOnly(addDays(today, -59)) } },
    select: { id: true, userId: true, date: true },
  });
  const late = candidates.filter((c) => fixDeadline(fromDateOnly(c.date)) < today);
  const excused = await sickCovered(late);
  const overdue = late.filter((c) => !excused.has(c.id)).map((c) => c.id);
  const deducted = overdue.length
    ? await prisma.attendance.updateMany({
        where: { id: { in: overdue }, status: "MISSING_CLOCK_OUT" },
        data: { status: "DEDUCTED", deductedAt: now },
      })
    : { count: 0 };

  return { markedMissing: closed.count, deducted: deducted.count };
}
