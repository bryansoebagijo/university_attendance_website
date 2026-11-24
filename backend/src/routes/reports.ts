import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { route } from "../lib/http.js";
import { addDays, dateOnly, fromDateOnly, isWeekend, jakartaDate, monthRange } from "../lib/time.js";
import { holidaysBetween } from "../services/leave.js";
import { isScheduled, loadSchedules } from "../services/schedule.js";

/** Admin reports, mounted at /api/admin/reports. */
export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole("ADMIN"));

/**
 * Monthly recap per active staff member (the "Rekap Bulanan" from the design).
 * Each person is measured against their own work schedule. For the current month,
 * only days up to today are counted.
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
    // Mon–Fri working days of the period (general information; each person has their own schedule).
    const workdays: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d) && !holidays.has(d)) workdays.push(d);
    const range = { gte: dateOnly(from), lte: dateOnly(to) };

    const [users, attendance, leave, exemptions, schedules, firstRecord] = await Promise.all([
      prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, nip: true, unit: true, createdAt: true } }),
      from <= to
        ? prisma.attendance.findMany({ where: { date: range }, select: { userId: true, date: true, status: true, inMethod: true, outMethod: true, editedAt: true } })
        : Promise.resolve([]),
      prisma.leaveRequest.findMany({
        where: { status: "APPROVED", startDate: { lte: dateOnly(to) }, endDate: { gte: dateOnly(from) } },
        select: { userId: true, type: true, startDate: true, endDate: true },
      }),
      from <= to ? prisma.attendanceExemption.findMany({ where: { date: range }, select: { userId: true, date: true } }) : Promise.resolve([]),
      loadSchedules(),
      prisma.attendance.groupBy({ by: ["userId"], _min: { date: true } }),
    ]);

    const rows = users.map(({ createdAt, ...u }) => {
      const sched = schedules.get(u.id);
      const days: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) if (isScheduled(sched, d, holidays)) days.push(d);
      const daySet = new Set(days);
      const mine = attendance.filter((a) => a.userId === u.id);
      const presentDays = new Set(mine.map((a) => fromDateOnly(a.date)));
      // Leave and exemptions only matter on scheduled days.
      const leaveDays = new Set<string>();
      const sickDays = new Set<string>();
      for (const l of leave.filter((x) => x.userId === u.id)) {
        const target = l.type === "SICK" ? sickDays : leaveDays;
        for (let d = fromDateOnly(l.startDate); d <= fromDateOnly(l.endDate); d = addDays(d, 1)) if (daySet.has(d)) target.add(d);
      }
      const exempt = new Set(exemptions.filter((e) => e.userId === u.id).map((e) => fromDateOnly(e.date)).filter((d) => daySet.has(d)));
      // Count absences only from when the person joined (or their first record, if earlier).
      const first = firstRecord.find((r) => r.userId === u.id)?._min.date;
      const joined = [jakartaDate(createdAt), first ? fromDateOnly(first) : null].filter(Boolean).sort()[0] as string;
      const absent = days.filter((d) => d >= joined && d < today && !presentDays.has(d) && !leaveDays.has(d) && !sickDays.has(d) && !exempt.has(d)).length;
      return {
        user: u,
        /** Scheduled days in the period (minus holidays). */
        scheduled: days.length,
        present: presentDays.size,
        /** Attendance on days outside the person's schedule (or on holidays). */
        outsideSchedule: [...presentDays].filter((d) => !daySet.has(d)).length,
        leave: leaveDays.size,
        sick: sickDays.size,
        /** Scheduled days an admin excused. */
        exempt: exempt.size,
        absent,
        missingClockOut: mine.filter((a) => a.status === "MISSING_CLOCK_OUT").length,
        fixed: mine.filter((a) => a.status === "FIXED").length,
        deducted: mine.filter((a) => a.status === "DEDUCTED").length,
        /** Days where the clock-in or clock-out came from an uploaded image instead of the camera. */
        uploads: mine.filter((a) => a.inMethod === "UPLOAD" || a.outMethod === "UPLOAD").length,
        /** Records an admin added or changed. */
        adminEdited: mine.filter((a) => a.editedAt).length,
      };
    });

    res.json({ month, from, to, workdays: workdays.length, holidays: holidays.size, rows });
  }),
);
