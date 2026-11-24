import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError, route } from "../lib/http.js";
import { dateOnly, fromDateOnly, jakartaDate, jakartaInstant, jakartaTime } from "../lib/time.js";
import { photoUrl } from "../lib/user-dto.js";
import { attendanceInclude, toAttendanceDto } from "../services/attendance.js";
import { holidaysBetween } from "../services/leave.js";
import { formatDays, isScheduled, loadSchedule, loadSchedules, scheduleDto } from "../services/schedule.js";

/**
 * Admin corrections, mounted at /api/admin: work schedules, the day roster, adding/editing/deleting
 * attendance, and excusing scheduled days ("Bebaskan"). Every change is written to AdminAction.
 */
export const correctionsRouter = Router();
correctionsRouter.use(requireAuth, requireRole("ADMIN"));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const reason = z.string().trim().min(5).max(500);

type Tx = Prisma.TransactionClient;
function log(tx: Tx, actorId: string, targetUserId: string, action: string, data: { date?: string; reason?: string; details?: Prisma.InputJsonValue }) {
  return tx.adminAction.create({
    data: { actorId, targetUserId, action, date: data.date ? dateOnly(data.date) : null, reason: data.reason ?? null, details: data.details },
  });
}

async function userOr404(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!u) throw new HttpError(404, "NOT_FOUND");
}

const userBrief = { select: { id: true, name: true, nip: true, unit: true, photo: { select: { updatedAt: true } } } } as const;
const briefDto = (u: { id: string; name: string; nip: string; unit: string; photo: { updatedAt: Date } | null }) => ({
  id: u.id,
  name: u.name,
  nip: u.nip,
  unit: u.unit,
  photoUrl: u.photo ? photoUrl(u.id, u.photo.updatedAt) : null,
});

// ---- Work schedules ------------------------------------------------------------

correctionsRouter.get(
  "/users/:id/schedules",
  route(async (req, res) => {
    await userOr404(req.params.id);
    res.json({ schedule: scheduleDto(await loadSchedule(req.params.id), jakartaDate()) });
  }),
);

const scheduleSchema = z.object({
  effectiveFrom: isoDate,
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
});

/** Adds a schedule period (or replaces the one starting the same day). */
correctionsRouter.put(
  "/users/:id/schedules",
  route(async (req, res) => {
    const { effectiveFrom, days } = scheduleSchema.parse(req.body);
    const userId = req.params.id;
    await userOr404(userId);
    await prisma.$transaction(async (tx) => {
      await tx.workSchedule.upsert({
        where: { userId_effectiveFrom: { userId, effectiveFrom: dateOnly(effectiveFrom) } },
        create: { userId, effectiveFrom: dateOnly(effectiveFrom), days: formatDays(days), setById: req.user!.id },
        update: { days: formatDays(days), setById: req.user!.id },
      });
      await log(tx, req.user!.id, userId, "SCHEDULE_SET", { date: effectiveFrom, details: { days } });
    });
    res.json({ schedule: scheduleDto(await loadSchedule(userId), jakartaDate()) });
  }),
);

correctionsRouter.delete(
  "/users/:id/schedules/:scheduleId",
  route(async (req, res) => {
    const userId = req.params.id;
    await prisma.$transaction(async (tx) => {
      const row = await tx.workSchedule.findFirst({ where: { id: req.params.scheduleId, userId } });
      if (!row) throw new HttpError(404, "NOT_FOUND");
      await tx.workSchedule.delete({ where: { id: row.id } });
      await log(tx, req.user!.id, userId, "SCHEDULE_DELETE", { date: fromDateOnly(row.effectiveFrom), details: { days: row.days } });
    });
    res.json({ schedule: scheduleDto(await loadSchedule(userId), jakartaDate()) });
  }),
);

// ---- Day roster ------------------------------------------------------------------

/**
 * Everyone who matters on one date: scheduled active staff, plus anyone with a record or exemption.
 * state: PRESENT | LEAVE | SICK | EXEMPT | ABSENT (past day) | NOT_YET (today) | HOLIDAY_OR_OFF (not scheduled, record only)
 */
correctionsRouter.get(
  "/day",
  route(async (req, res) => {
    const today = jakartaDate();
    const date = isoDate.catch(today).parse(req.query.date);
    const d = dateOnly(date);
    const [users, records, exemptions, leave, holidays, schedules] = await Promise.all([
      prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, ...userBrief }),
      prisma.attendance.findMany({ where: { date: d }, include: { ...attendanceInclude, user: userBrief } }),
      prisma.attendanceExemption.findMany({ where: { date: d }, include: { createdBy: { select: { id: true, name: true } } } }),
      prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: d }, endDate: { gte: d } }, select: { id: true, userId: true, type: true } }),
      holidaysBetween(date, date),
      loadSchedules(),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const r of records) if (!byId.has(r.userId)) byId.set(r.userId, r.user); // inactive people with a record
    const rows = [...byId.values()]
      .map((u) => {
        const scheduled = isScheduled(schedules.get(u.id), date, holidays);
        const record = records.find((r) => r.userId === u.id);
        const exemption = exemptions.find((e) => e.userId === u.id);
        const lv = leave.find((l) => l.userId === u.id);
        if (!scheduled && !record && !exemption) return null;
        const state = record
          ? "PRESENT"
          : lv && scheduled
            ? lv.type === "SICK"
              ? "SICK"
              : "LEAVE"
            : exemption
              ? "EXEMPT"
              : date < today
                ? "ABSENT"
                : date === today
                  ? "NOT_YET"
                  : "UPCOMING";
        return {
          user: briefDto(u),
          scheduled,
          state,
          record: record ? toAttendanceDto(record) : null,
          exemption: exemption ? { id: exemption.id, reason: exemption.reason, by: exemption.createdBy, at: exemption.createdAt.toISOString() } : null,
          leave: lv ? { id: lv.id, type: lv.type } : null,
        };
      })
      .filter((r) => r !== null);
    res.json({ date, holiday: holidays.has(date), rows });
  }),
);

// ---- Add / edit / delete attendance -----------------------------------------------------

const upsertSchema = z.object({
  clockIn: hhmm,
  clockOut: hhmm.nullable().optional(),
  locationId: z.string().min(1).optional(),
  reason,
});

/** Creates or corrects one person's record for one date. */
correctionsRouter.put(
  "/attendance/:userId/:date",
  route(async (req, res) => {
    const { clockIn, clockOut, locationId, reason: why } = upsertSchema.parse(req.body);
    const date = isoDate.parse(req.params.date);
    const userId = req.params.userId;
    const now = new Date();
    const today = jakartaDate(now);
    if (date > today) throw new HttpError(400, "DATE_IN_FUTURE");
    await userOr404(userId);
    const inAt = jakartaInstant(date, clockIn);
    const outAt = clockOut ? jakartaInstant(date, clockOut) : null;
    if (inAt > now || (outAt && outAt > now)) throw new HttpError(400, "TIME_IN_FUTURE");
    if (outAt && outAt <= inAt) throw new HttpError(400, "CLOCK_OUT_BEFORE_IN");

    const record = await prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findUnique({ where: { userId_date: { userId, date: dateOnly(date) } } });
      const loc =
        (locationId && (await tx.location.findUnique({ where: { id: locationId } }))) ||
        (existing && (await tx.location.findUnique({ where: { id: existing.inLocationId } }))) ||
        (await tx.location.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }));
      if (!loc) throw new HttpError(400, "NO_LOCATION");
      if (locationId && loc.id !== locationId) throw new HttpError(404, "LOCATION_NOT_FOUND");
      const status = outAt ? "COMPLETE" : date < today ? "MISSING_CLOCK_OUT" : "CLOCKED_IN";
      const edit = { editedById: req.user!.id, editedAt: now, editReason: why };
      let row;
      if (existing) {
        const inChanged = existing.clockIn.getTime() !== inAt.getTime() || existing.inLocationId !== loc.id;
        const outChanged = (existing.clockOut?.getTime() ?? null) !== (outAt?.getTime() ?? null);
        row = await tx.attendance.update({
          where: { id: existing.id },
          data: {
            clockIn: inAt,
            clockOut: outAt,
            inLocationId: loc.id,
            outLocationId: outAt ? (existing.outLocationId ?? loc.id) : null,
            status,
            ...(inChanged && { inMethod: "MANUAL" as const }),
            ...(outChanged && { outMethod: outAt ? ("MANUAL" as const) : null }),
            deductedAt: null, // a corrected day is no longer deducted
            ...edit,
          },
          include: attendanceInclude,
        });
        await log(tx, req.user!.id, userId, "ATTENDANCE_EDIT", {
          date,
          reason: why,
          details: {
            before: { clockIn: jakartaTime(existing.clockIn), clockOut: existing.clockOut ? jakartaTime(existing.clockOut) : null, status: existing.status },
            after: { clockIn, clockOut: clockOut ?? null, status },
          },
        });
      } else {
        row = await tx.attendance.create({
          data: {
            userId,
            date: dateOnly(date),
            clockIn: inAt,
            clockOut: outAt,
            inLocationId: loc.id,
            outLocationId: outAt ? loc.id : null,
            status,
            inMethod: "MANUAL",
            outMethod: outAt ? "MANUAL" : null,
            ...edit,
          },
          include: attendanceInclude,
        });
        await log(tx, req.user!.id, userId, "ATTENDANCE_CREATE", { date, reason: why, details: { clockIn, clockOut: clockOut ?? null } });
      }
      // Present now, so an exemption for the same day no longer applies.
      await tx.attendanceExemption.deleteMany({ where: { userId, date: dateOnly(date) } });
      return row;
    });
    res.json({ record: toAttendanceDto(record) });
  }),
);

correctionsRouter.delete(
  "/attendance/:id",
  route(async (req, res) => {
    const { reason: why } = z.object({ reason }).parse(req.body ?? {});
    await prisma.$transaction(async (tx) => {
      const row = await tx.attendance.findUnique({ where: { id: req.params.id } });
      if (!row) throw new HttpError(404, "NOT_FOUND");
      await tx.attendance.delete({ where: { id: row.id } });
      await log(tx, req.user!.id, row.userId, "ATTENDANCE_DELETE", {
        date: fromDateOnly(row.date),
        reason: why,
        details: { clockIn: jakartaTime(row.clockIn), clockOut: row.clockOut ? jakartaTime(row.clockOut) : null, status: row.status },
      });
    });
    res.status(204).end();
  }),
);

// ---- Excuse a scheduled day ("Bebaskan") ----------------------------------------------

const exemptSchema = z.object({ userId: z.string().min(1), date: isoDate, reason });

correctionsRouter.post(
  "/exemptions",
  route(async (req, res) => {
    const { userId, date, reason: why } = exemptSchema.parse(req.body);
    await userOr404(userId);
    const holidays = await holidaysBetween(date, date);
    if (!isScheduled(await loadSchedule(userId), date, holidays)) throw new HttpError(400, "NOT_SCHEDULED");
    const created = await prisma.$transaction(async (tx) => {
      if (await tx.attendance.findUnique({ where: { userId_date: { userId, date: dateOnly(date) } }, select: { id: true } })) {
        throw new HttpError(409, "HAS_ATTENDANCE");
      }
      try {
        const row = await tx.attendanceExemption.create({
          data: { userId, date: dateOnly(date), reason: why, createdById: req.user!.id },
          include: { createdBy: { select: { id: true, name: true } } },
        });
        await log(tx, req.user!.id, userId, "EXEMPT", { date, reason: why });
        return row;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "ALREADY_EXEMPT");
        throw e;
      }
    });
    res.status(201).json({ exemption: { id: created.id, userId, date, reason: created.reason, by: created.createdBy, at: created.createdAt.toISOString() } });
  }),
);

/** Undo an exemption (e.g. made by mistake). */
correctionsRouter.delete(
  "/exemptions/:id",
  route(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const row = await tx.attendanceExemption.findUnique({ where: { id: req.params.id } });
      if (!row) throw new HttpError(404, "NOT_FOUND");
      await tx.attendanceExemption.delete({ where: { id: row.id } });
      await log(tx, req.user!.id, row.userId, "UNEXEMPT", { date: fromDateOnly(row.date), details: { reason: row.reason } });
    });
    res.status(204).end();
  }),
);
