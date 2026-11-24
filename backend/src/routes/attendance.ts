import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { route } from "../lib/http.js";
import { addMonths, dateOnly, jakartaDate, monthRange } from "../lib/time.js";
import { attendanceInclude, fixClockOut, scan, toAttendanceDto, sickCovered } from "../services/attendance.js";

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.NODE_ENV === "test" ? 1000 : 20,
  keyGenerator: (req) => req.user!.id,
  handler: (_req, res) => {
    res.status(429).json({ error: "TOO_MANY_ATTEMPTS" });
  },
});

const scanSchema = z.object({
  token: z.string().min(1).max(200),
  action: z.enum(["in", "out"]),
  /** How the app read the QR. Reported by the client, so it's a review aid, not proof. */
  method: z.enum(["camera", "upload"]).default("camera"),
});

attendanceRouter.post(
  "/scan",
  scanLimiter,
  route(async (req, res) => {
    const { token, action, method } = scanSchema.parse(req.body);
    res.json(await scan(req.user!.id, token, action, new Date(), method === "upload" ? "UPLOAD" : "CAMERA"));
  }),
);

/** Everything the dashboard needs in one call. */
attendanceRouter.get(
  "/me/overview",
  route(async (req, res) => {
    const userId = req.user!.id;
    const today = jakartaDate();
    const { from } = monthRange(today.slice(0, 7));
    const yearStart = dateOnly(`${today.slice(0, 4)}-01-01`);
    const [todayRec, recent, monthCount, missing, deductedThisYear] = await Promise.all([
      prisma.attendance.findUnique({ where: { userId_date: { userId, date: dateOnly(today) } }, include: attendanceInclude }),
      prisma.attendance.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 5, include: attendanceInclude }),
      prisma.attendance.count({ where: { userId, date: { gte: dateOnly(from), lte: dateOnly(today) } } }),
      prisma.attendance.findMany({ where: { userId, status: "MISSING_CLOCK_OUT" }, orderBy: { date: "asc" }, include: attendanceInclude }),
      prisma.attendance.count({ where: { userId, status: "DEDUCTED", date: { gte: yearStart } } }),
    ]);
    res.json({
      today: todayRec ? toAttendanceDto(todayRec) : null,
      recent: recent.map(toAttendanceDto),
      monthCount,
      missing: missing.map(toAttendanceDto),
      deductedThisYear,
    });
  }),
);

const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

/** One month of my attendance (default: this month). */
attendanceRouter.get(
  "/me",
  route(async (req, res) => {
    const month = monthSchema.parse(req.query).month ?? jakartaDate().slice(0, 7);
    const { from, to } = monthRange(month);
    const rows = await prisma.attendance.findMany({
      where: { userId: req.user!.id, date: { gte: dateOnly(from), lte: dateOnly(to) } },
      orderBy: { date: "desc" },
      include: attendanceInclude,
    });
    res.json({ month, records: rows.map(toAttendanceDto) });
  }),
);

/** Open missing clock-outs plus the last year of fixes and deductions. */
attendanceRouter.get(
  "/me/corrections",
  route(async (req, res) => {
    const userId = req.user!.id;
    const since = dateOnly(addMonths(jakartaDate(), -12));
    const [missing, past] = await Promise.all([
      prisma.attendance.findMany({ where: { userId, status: "MISSING_CLOCK_OUT" }, orderBy: { date: "asc" }, include: attendanceInclude }),
      prisma.attendance.findMany({
        where: { userId, status: { in: ["FIXED", "DEDUCTED"] }, date: { gte: since } },
        orderBy: { date: "desc" },
        include: attendanceInclude,
      }),
    ]);
    const excused = await sickCovered(missing);
    res.json({
      // sickExcused: the day has approved sick leave, so it will not be deducted (fixing it is still allowed).
      missing: missing.map((a) => ({ ...toAttendanceDto(a), sickExcused: excused.has(a.id) })),
      past: past.map(toAttendanceDto),
    });
  }),
);

const fixSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  reason: z.string().trim().min(10).max(500),
});

attendanceRouter.patch(
  "/:id/fix",
  route(async (req, res) => {
    const { time, reason } = fixSchema.parse(req.body);
    res.json({ record: await fixClockOut(req.user!.id, req.params.id, time, reason) });
  }),
);
