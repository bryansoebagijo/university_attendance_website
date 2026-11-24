import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { route } from "../lib/http.js";
import { addDays, dateOnly, fromDateOnly, isWeekend, jakartaDate, jakartaTime, monthRange, WORK_START } from "../lib/time.js";
import { holidaysBetween } from "../services/leave.js";

/** Admin reports, mounted at /api/admin/reports. */
export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole("ADMIN"));

/**
 * Monthly recap per active staff member (the "Rekap Bulanan" from the design).
 * For the current month, only days up to today are counted.
 */
reportsRouter.get(
  "/monthly",
  route(async (req, res) => {
    const today = jakartaDate();
    const month = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .catch(today.slice(0, 7))
      .parse(req.query.month);
    const { from, to: monthEnd } = monthRange(month);
    const to = monthEnd < today ? monthEnd : today;

    const holidays = await holidaysBetween(from, monthEnd);
    const workdays: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d) && !holidays.has(d)) workdays.push(d);
    const workdaySet = new Set(workdays);

    const [users, attendance, leave] = await Promise.all([
      prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, nip: true, unit: true, createdAt: true } }),
      from <= to
        ? prisma.attendance.findMany({
            where: { date: { gte: dateOnly(from), lte: dateOnly(to) } },
            select: { userId: true, date: true, clockIn: true, status: true, inMethod: true, outMethod: true },
          })
        : Promise.resolve([]),
      prisma.leaveRequest.findMany({
        where: { status: "APPROVED", startDate: { lte: dateOnly(to) }, endDate: { gte: dateOnly(from) } },
        select: { userId: true, type: true, startDate: true, endDate: true },
      }),
    ]);

    const firstRecord = await prisma.attendance.groupBy({ by: ["userId"], _min: { date: true } });

    const rows = users.map(({ createdAt, ...u }) => {
      const mine = attendance.filter((a) => a.userId === u.id);
      // Count absences only from when the person joined (or their first record, if earlier).
      const first = firstRecord.find((r) => r.userId === u.id)?._min.date;
      const joined = [jakartaDate(createdAt), first ? fromDateOnly(first) : null].filter(Boolean).sort()[0] as string;
      const presentDays = new Set(mine.map((a) => fromDateOnly(a.date)));
      const leaveDays = new Set<string>();
      const sickDays = new Set<string>();
      for (const l of leave.filter((x) => x.userId === u.id)) {
        const target = l.type === "SICK" ? sickDays : leaveDays;
        for (let d = fromDateOnly(l.startDate); d <= fromDateOnly(l.endDate); d = addDays(d, 1)) if (workdaySet.has(d)) target.add(d);
      }
      // Approved leave of either type excuses the day; a rejected sick request leaves it as an absence.
      const absent = workdays.filter((d) => d >= joined && d < today && !presentDays.has(d) && !leaveDays.has(d) && !sickDays.has(d)).length;
      return {
        user: u,
        present: presentDays.size,
        late: mine.filter((a) => jakartaTime(a.clockIn) > WORK_START).length,
        leave: leaveDays.size,
        sick: sickDays.size,
        absent,
        missingClockOut: mine.filter((a) => a.status === "MISSING_CLOCK_OUT").length,
        fixed: mine.filter((a) => a.status === "FIXED").length,
        deducted: mine.filter((a) => a.status === "DEDUCTED").length,
        /** Days where the clock-in or clock-out came from an uploaded image instead of the camera. */
        uploads: mine.filter((a) => a.inMethod === "UPLOAD" || a.outMethod === "UPLOAD").length,
      };
    });

    res.json({ month, from, to, workdays: workdays.length, holidays: holidays.size, rows });
  }),
);
