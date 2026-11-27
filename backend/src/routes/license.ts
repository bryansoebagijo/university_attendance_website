import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { route } from "../lib/http.js";
import { licenseStatus, refreshLicense } from "../services/license.js";

/** License state for the banner (everyone) and the Lisensi card (administrators get the details). */
export const licenseRouter = Router();
licenseRouter.use(requireAuth);

licenseRouter.get(
  "/",
  route(async (req, res) => {
    // Admins may want to see a just-renewed file immediately.
    const s = req.user!.role === "ADMIN" && req.query.refresh ? await refreshLicense() : licenseStatus();
    const admin = req.user!.role === "ADMIN";
    res.json({
      state: s.state,
      readOnly: s.readOnly,
      enforced: s.enforced,
      expiresAt: s.expiresAt,
      graceUntil: s.graceUntil,
      daysLeft: s.daysLeft,
      ...(admin && { id: s.id, customer: s.customer, issuedAt: s.issuedAt, reason: s.reason }),
    });
  }),
);
