import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import { HttpError, route } from "../lib/http.js";
import { kioskKeyMatches, makeToken } from "../lib/qr.js";

/**
 * Kiosk screens fetch the current QR token here. No user session: the screen proves itself
 * with the X-Kiosk-Key header (issued by an admin from the QR locations page).
 */
export const kioskRouter = Router();

kioskRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    handler: (_req, res) => {
      res.status(429).json({ error: "TOO_MANY_ATTEMPTS" });
    },
  }),
);

kioskRouter.get(
  "/:locationId/token",
  route(async (req, res) => {
    const key = req.get("x-kiosk-key") ?? "";
    const location = await prisma.location.findUnique({ where: { id: req.params.locationId } });
    // Same answer for unknown location and wrong key.
    if (!location || !key || !kioskKeyMatches(key, location.kioskKeyHash)) throw new HttpError(401, "KIOSK_NOT_PAIRED");
    res.setHeader("Cache-Control", "no-store");
    const loc = { id: location.id, name: location.name, building: location.building, active: location.active };
    if (!location.active) {
      res.json({ location: loc, token: null, secondsLeft: null });
      return;
    }
    res.json({ location: loc, ...makeToken(location.id, location.qrSecret) });
  }),
);
