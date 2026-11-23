import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError, route } from "../lib/http.js";
import { makeToken } from "../lib/qr.js";

/**
 * DEVELOPMENT ONLY — never mounted when NODE_ENV=production (see app.ts).
 * Gives a signed-in user a valid QR token so the scan flow can be tried without a camera.
 */
export const devRouter = Router();
devRouter.use(requireAuth);

devRouter.get(
  "/qr/:locationId?",
  route(async (req, res) => {
    const location = req.params.locationId
      ? await prisma.location.findUnique({ where: { id: req.params.locationId } })
      : await prisma.location.findFirst({ where: { active: true }, orderBy: { name: "asc" } });
    if (!location) throw new HttpError(404, "NOT_FOUND");
    res.json({ locationId: location.id, ...makeToken(location.id, location.qrSecret) });
  }),
);
