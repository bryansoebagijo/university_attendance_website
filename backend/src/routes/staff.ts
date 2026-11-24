import { Prisma, type Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { containsIgnoreCase } from "../lib/db-dialect.js";
import { HttpError, route } from "../lib/http.js";
import { hashPassword, temporaryPassword } from "../lib/password.js";
import { jakartaDate } from "../lib/time.js";
import { currentAndNext, loadSchedules } from "../services/schedule.js";
import { toUserDto, userSelect } from "../lib/user-dto.js";
import { getBalances } from "../services/leave.js";

/** Staff management (admin only), mounted at /api/admin/users. */
export const staffRouter = Router();
staffRouter.use(requireAuth, requireRole("ADMIN"));

const ROLES = ["USER", "APPROVER", "ADMIN"] as const;

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
});

staffRouter.get(
  "/",
  route(async (req, res) => {
    const { q, role } = listSchema.parse(req.query);
    const today = jakartaDate();
    const [users, balances, schedules] = await Promise.all([
      prisma.user.findMany({
        where: {
          ...(role ? { role } : {}),
          ...(q
            ? { OR: [{ name: containsIgnoreCase(q) }, { nip: { contains: q } }, { email: containsIgnoreCase(q) }] }
            : {}),
        },
        orderBy: [{ active: "desc" }, { name: "asc" }],
        select: userSelect,
      }),
      getBalances(Number(today.slice(0, 4))),
      loadSchedules(),
    ]);
    res.json({
      users: users.map((u) => {
        const { current, next } = currentAndNext(schedules.get(u.id) ?? [], today);
        return { ...toUserDto(u), balance: balances[u.id] ?? null, schedule: { days: current.days, isDefault: current.isDefault, next } };
      }),
    });
  }),
);

const userBody = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  nip: z.string().trim().min(3).max(40),
  role: z.enum(ROLES).default("USER"),
  unit: z.string().trim().max(120).default(""),
  annualQuota: z.number().int().min(0).max(60).default(12),
  active: z.boolean().default(true),
});

/** Unique-constraint errors → which field is taken. */
function uniqueError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    // PostgreSQL reports the fields (["nip"]); MySQL reports the index name ("User_nip_key").
    const raw = e.meta?.target;
    const target = (Array.isArray(raw) ? raw.join(",") : String(raw ?? "")).toLowerCase();
    throw new HttpError(409, target.includes("nip") ? "NIP_TAKEN" : "EMAIL_TAKEN");
  }
  throw e;
}

/** Creates the account with a one-time password, returned once so the admin can hand it over. */
staffRouter.post(
  "/",
  route(async (req, res) => {
    const body = userBody.parse(req.body);
    const tempPassword = temporaryPassword();
    const user = await prisma.user
      .create({ data: { ...body, passwordHash: await hashPassword(tempPassword), mustChangePassword: true }, select: userSelect })
      .catch(uniqueError);
    res.status(201).json({ user: toUserDto(user), tempPassword });
  }),
);

/** Refuses changes that would leave nobody able to administer the system. */
async function assertAnotherActiveAdmin(exceptId: string) {
  const others = await prisma.user.count({ where: { role: "ADMIN", active: true, id: { not: exceptId } } });
  if (others === 0) throw new HttpError(409, "LAST_ADMIN");
}

staffRouter.patch(
  "/:id",
  route(async (req, res) => {
    const body = userBody.partial().parse(req.body);
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true, active: true } });
    if (!target) throw new HttpError(404, "NOT_FOUND");

    const self = target.id === req.user!.id;
    const roleChanges = body.role !== undefined && body.role !== target.role;
    const deactivates = body.active === false && target.active;
    if (self && (roleChanges || deactivates)) throw new HttpError(409, "SELF_CHANGE");
    if (target.role === "ADMIN" && target.active && ((roleChanges && body.role !== ("ADMIN" as Role)) || deactivates)) {
      await assertAnotherActiveAdmin(target.id);
    }

    const user = await prisma.user
      .update({
        where: { id: target.id },
        // Deactivating also ends their sessions right away.
        data: { ...body, ...(deactivates ? { sessionVersion: { increment: 1 } } : {}) },
        select: userSelect,
      })
      .catch(uniqueError);
    res.json({ user: toUserDto(user) });
  }),
);

/** New one-time password; signs the user out everywhere and makes them choose a new one. */
staffRouter.post(
  "/:id/reset-password",
  route(async (req, res) => {
    if (req.params.id === req.user!.id) throw new HttpError(409, "SELF_CHANGE"); // use Settings instead
    const exists = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "NOT_FOUND");
    const tempPassword = temporaryPassword();
    await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true, sessionVersion: { increment: 1 } },
    });
    res.json({ tempPassword });
  }),
);

/**
 * Permanently delete an account. Only allowed when it has no attendance or leave history
 * (e.g. created by mistake); otherwise HAS_HISTORY, and the admin should deactivate instead,
 * which keeps past records and monthly recaps intact.
 */
staffRouter.delete(
  "/:id",
  route(async (req, res) => {
    if (req.params.id === req.user!.id) throw new HttpError(409, "SELF_CHANGE");
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) throw new HttpError(404, "NOT_FOUND");
    const [attendance, requests, decisions] = await Promise.all([
      prisma.attendance.count({ where: { userId: user.id } }),
      prisma.leaveRequest.count({ where: { userId: user.id } }),
      prisma.leaveRequest.count({ where: { decidedById: user.id } }),
    ]);
    if (attendance + requests + decisions > 0) {
      res.status(409).json({ error: "HAS_HISTORY", attendance, leaveRequests: requests, leaveDecisions: decisions });
      return;
    }
    await prisma.user.delete({ where: { id: user.id } }); // profile photo is removed with it (cascade)
    res.status(204).end();
  }),
);
