import type { AttendanceStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { containsIgnoreCase } from "../lib/db-dialect.js";
import { HttpError, route } from "../lib/http.js";
import { hashKioskKey, makeToken, newKioskKey, newSecret, SLOT_MS } from "../lib/qr.js";
import { dateOnly, fromDateOnly, jakartaDate } from "../lib/time.js";
import { photoUrl } from "../lib/user-dto.js";
import { attendanceInclude, toAttendanceDto } from "../services/attendance.js";
import { getBalances, holidaysBetween, leaveInclude, toLeaveDto } from "../services/leave.js";
import { isScheduled, loadSchedules, scheduledFlags } from "../services/schedule.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("ADMIN"));

// ---- Attendance -------------------------------------------------------------

const STATUSES = ["CLOCKED_IN", "COMPLETE", "MISSING_CLOCK_OUT", "FIXED", "DEDUCTED"] as const;
const listSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});

adminRouter.get(
  "/attendance",
  route(async (req, res) => {
    const { date, status, q } = listSchema.parse(req.query);
    const where: Prisma.AttendanceWhereInput = {
      ...(date ? { date: dateOnly(date) } : {}),
      ...(status ? { status: status as AttendanceStatus } : {}),
      ...(q
        ? { user: { OR: [{ name: containsIgnoreCase(q) }, { nip: { contains: q } }] } }
        : {}),
    };
    const rows = await prisma.attendance.findMany({
      where,
      orderBy: [{ date: "desc" }, { clockIn: "asc" }],
      take: 1000,
      include: {
        ...attendanceInclude,
        user: { select: { id: true, name: true, nip: true, unit: true, photo: { select: { updatedAt: true } } } },
      },
    });
    const dates = rows.map((r) => fromDateOnly(r.date)).sort();
    const holidays = dates.length ? await holidaysBetween(dates[0], dates[dates.length - 1]) : new Set<string>();
    const flags = await scheduledFlags(rows, holidays);
    res.json({
      records: rows.map((r) => ({
        ...toAttendanceDto(r),
        scheduled: flags.get(r.id) ?? true,
        user: {
          id: r.user.id,
          name: r.user.name,
          nip: r.user.nip,
          unit: r.user.unit,
          photoUrl: r.user.photo ? photoUrl(r.user.id, r.user.photo.updatedAt) : null,
        },
      })),
    });
  }),
);

/** Today's numbers for the admin dashboard. Leave figures arrive with the leave API (phase 4). */
adminRouter.get(
  "/overview",
  route(async (_req, res) => {
    const todayStr = jakartaDate();
    const today = dateOnly(todayStr);
    const [active, todayRows, missingCount, onLeaveToday, sickToday, pendingLeave, leaveToday, exemptToday, holidays, schedules] = await Promise.all([
      prisma.user.findMany({ where: { active: true }, select: { id: true } }),
      prisma.attendance.findMany({ where: { date: today }, select: { userId: true, clockIn: true, clockOut: true } }),
      prisma.attendance.count({ where: { status: "MISSING_CLOCK_OUT" } }),
      prisma.leaveRequest.count({ where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } } }),
      prisma.leaveRequest.count({ where: { type: "SICK", status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } } }),
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
      prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } }, select: { userId: true } }),
      prisma.attendanceExemption.findMany({ where: { date: today }, select: { userId: true } }),
      holidaysBetween(todayStr, todayStr),
      loadSchedules(),
    ]);
    // Expected today = active staff whose schedule includes today.
    const expected = active.filter((u) => isScheduled(schedules.get(u.id), todayStr, holidays)).map((u) => u.id);
    const present = new Set(todayRows.map((r) => r.userId));
    const excused = new Set([...leaveToday, ...exemptToday].map((r) => r.userId));
    res.json({
      activeStaff: active.length,
      /** Active staff scheduled today (0 on a holiday). */
      expectedToday: expected.length,
      /** Scheduled today, not here yet, and not on leave or excused. */
      notYetToday: expected.filter((id) => !present.has(id) && !excused.has(id)).length,
      exemptToday: exemptToday.length,
      presentToday: todayRows.length,
      doneToday: todayRows.filter((r) => r.clockOut).length,
      workingNow: todayRows.filter((r) => !r.clockOut).length,
      missingCount,
      /** All approved leave today (annual + sick); sickToday is the sick part of it. */
      onLeaveToday,
      sickToday,
      pendingLeave,
    });
  }),
);

// ---- Leave --------------------------------------------------------------------

const leaveListSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  type: z.enum(["ANNUAL", "SICK"]).optional(),
  q: z.string().trim().max(100).optional(),
});

adminRouter.get(
  "/leave",
  route(async (req, res) => {
    const { status, type, q } = leaveListSchema.parse(req.query);
    const rows = await prisma.leaveRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(q ? { user: { OR: [{ name: containsIgnoreCase(q) }, { nip: { contains: q } }] } } : {}),
      },
      orderBy: { startDate: "desc" },
      take: 1000,
      include: leaveInclude,
    });
    res.json({ requests: rows.map(toLeaveDto) });
  }),
);

/** This year's leave balance for every user, keyed by user id. */
adminRouter.get(
  "/leave-balances",
  route(async (_req, res) => {
    res.json({ balances: await getBalances(Number(jakartaDate().slice(0, 4))) });
  }),
);

// ---- QR locations -----------------------------------------------------------

const locationSelect = { id: true, name: true, building: true, active: true, kioskKeyHash: true } as const;

function toLocationDto(l: { id: string; name: string; building: string; active: boolean; kioskKeyHash: string | null }) {
  return { id: l.id, name: l.name, building: l.building, active: l.active, kioskPaired: !!l.kioskKeyHash };
}

adminRouter.get(
  "/locations",
  route(async (_req, res) => {
    const today = dateOnly(jakartaDate());
    const [locations, scans] = await Promise.all([
      prisma.location.findMany({ orderBy: { name: "asc" }, select: locationSelect }),
      prisma.attendance.findMany({ where: { date: today }, select: { inLocationId: true, outLocationId: true, clockIn: true, clockOut: true } }),
    ]);
    res.json({
      locations: locations.map((l) => {
        const times = scans.flatMap((s) => [
          ...(s.inLocationId === l.id ? [s.clockIn] : []),
          ...(s.outLocationId === l.id && s.clockOut ? [s.clockOut] : []),
        ]);
        return {
          ...toLocationDto(l),
          scansToday: times.length,
          lastScan: times.length ? new Date(Math.max(...times.map((t) => t.getTime()))).toISOString() : null,
        };
      }),
    });
  }),
);

const locationBody = z.object({
  name: z.string().trim().min(3).max(100),
  building: z.string().trim().max(100).default(""),
  active: z.boolean().default(true),
});

adminRouter.post(
  "/locations",
  route(async (req, res) => {
    const body = locationBody.parse(req.body);
    const base = body.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lokasi";
    let id = base;
    for (let i = 2; await prisma.location.findUnique({ where: { id } }); i++) id = `${base}-${i}`;
    const loc = await prisma.location.create({ data: { ...body, id, qrSecret: newSecret() }, select: locationSelect });
    res.status(201).json({ location: toLocationDto(loc) });
  }),
);

adminRouter.patch(
  "/locations/:id",
  route(async (req, res) => {
    const body = locationBody.partial().parse(req.body);
    const exists = await prisma.location.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "NOT_FOUND");
    const loc = await prisma.location.update({ where: { id: req.params.id }, data: body, select: locationSelect });
    res.json({ location: toLocationDto(loc) });
  }),
);

/**
 * The location's current rotating QR token, for an admin to download as an image.
 * It expires like any kiosk code (its 30-second slot + the next one), so it is only useful right away.
 */
adminRouter.get(
  "/locations/:id/qr",
  route(async (req, res) => {
    const location = await prisma.location.findUnique({ where: { id: req.params.id } });
    if (!location) throw new HttpError(404, "NOT_FOUND");
    if (!location.active) throw new HttpError(409, "LOCATION_INACTIVE");
    const now = Date.now();
    const { token, secondsLeft } = makeToken(location.id, location.qrSecret, now);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      location: { id: location.id, name: location.name, building: location.building },
      token,
      /** Seconds until the kiosk shows the next code. */
      secondsLeft,
      /** Last moment a scan of this code is accepted (end of the following slot). */
      validUntil: new Date(now + (secondsLeft + SLOT_MS / 1000) * 1000).toISOString(),
    });
  }),
);

/**
 * Issue a new kiosk key for a location (replaces the old one, so a previously paired screen stops working).
 * The plain key is returned once; only its hash is stored.
 */
adminRouter.post(
  "/locations/:id/kiosk-key",
  route(async (req, res) => {
    const exists = await prisma.location.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "NOT_FOUND");
    const key = newKioskKey();
    await prisma.location.update({ where: { id: req.params.id }, data: { kioskKeyHash: hashKioskKey(key) } });
    res.json({ key });
  }),
);
