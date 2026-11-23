import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { route } from "../lib/http.js";
import { jakartaDate } from "../lib/time.js";
import { cancelRequest, createRequest, decide, getBalance, leaveInclude, overlapsFor, toLeaveDto } from "../services/leave.js";

export const leaveRouter = Router();
leaveRouter.use(requireAuth);

const thisYear = () => Number(jakartaDate().slice(0, 4));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---- My leave ---------------------------------------------------------------

leaveRouter.get(
  "/me",
  route(async (req, res) => {
    const userId = req.user!.id;
    const [rows, balance] = await Promise.all([
      prisma.leaveRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100, include: leaveInclude }),
      getBalance(userId, thisYear()),
    ]);
    res.json({ requests: rows.map(toLeaveDto), balance });
  }),
);

const createSchema = z.object({ start: isoDate, end: isoDate, reason: z.string().trim().min(5).max(500) });

leaveRouter.post(
  "/",
  route(async (req, res) => {
    const { start, end, reason } = createSchema.parse(req.body);
    res.status(201).json({ request: await createRequest(req.user!.id, start, end, reason) });
  }),
);

leaveRouter.delete(
  "/:id",
  route(async (req, res) => {
    await cancelRequest(req.user!.id, req.params.id);
    res.status(204).end();
  }),
);

// ---- Approvals (approver or admin) -------------------------------------------

const approvers = requireRole("APPROVER", "ADMIN");

/** Waiting requests, oldest start first, each with the person's balance and overlapping leave. */
leaveRouter.get(
  "/pending",
  approvers,
  route(async (_req, res) => {
    const rows = await prisma.leaveRequest.findMany({ where: { status: "PENDING" }, orderBy: { startDate: "asc" }, include: leaveInclude });
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...toLeaveDto(r),
        balance: await getBalance(r.userId, r.startDate.getUTCFullYear()),
        overlaps: await overlapsFor(r),
      })),
    );
    res.json({ requests: items });
  }),
);

leaveRouter.get(
  "/decided",
  approvers,
  route(async (_req, res) => {
    const rows = await prisma.leaveRequest.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { decidedAt: "desc" },
      take: 100,
      include: leaveInclude,
    });
    res.json({ requests: rows.map(toLeaveDto) });
  }),
);

const decisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() });

leaveRouter.post(
  "/:id/decision",
  approvers,
  route(async (req, res) => {
    const { approve, note } = decisionSchema.parse(req.body);
    res.json({ request: await decide(req.user!.id, req.params.id, approve, note || undefined) });
  }),
);
