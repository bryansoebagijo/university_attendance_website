import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError, route } from "../lib/http.js";
import { dateOnly, fromDateOnly, jakartaDate } from "../lib/time.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** GET /api/holidays?year=YYYY — any signed-in user (the leave form uses it to count days). */
export const holidaysRouter = Router();
holidaysRouter.use(requireAuth);

holidaysRouter.get(
  "/",
  route(async (req, res) => {
    const year = z.coerce.number().int().min(2000).max(2100).catch(Number(jakartaDate().slice(0, 4))).parse(req.query.year);
    // Include next January so a December leave form can still see New Year.
    const rows = await prisma.holiday.findMany({
      where: { date: { gte: dateOnly(`${year}-01-01`), lte: dateOnly(`${year + 1}-01-31`) } },
      orderBy: { date: "asc" },
    });
    res.json({ holidays: rows.map((h) => ({ date: fromDateOnly(h.date), name: h.name })) });
  }),
);

/** Admin management, mounted at /api/admin/holidays. */
export const adminHolidaysRouter = Router();
adminHolidaysRouter.use(requireAuth, requireRole("ADMIN"));

adminHolidaysRouter.put(
  "/:date",
  route(async (req, res) => {
    const date = isoDate.parse(req.params.date);
    const { name } = z.object({ name: z.string().trim().min(2).max(120) }).parse(req.body);
    const h = await prisma.holiday.upsert({ where: { date: dateOnly(date) }, create: { date: dateOnly(date), name }, update: { name } });
    res.json({ holiday: { date: fromDateOnly(h.date), name: h.name } });
  }),
);

adminHolidaysRouter.delete(
  "/:date",
  route(async (req, res) => {
    const date = isoDate.parse(req.params.date);
    const { count } = await prisma.holiday.deleteMany({ where: { date: dateOnly(date) } });
    if (count === 0) throw new HttpError(404, "NOT_FOUND");
    res.status(204).end();
  }),
);
