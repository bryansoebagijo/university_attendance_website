import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { route } from "../lib/http.js";
import { issueMissingPasswords, runTeacherSync, syncConfigured, toSyncDto, withoutPassword } from "../services/teacher-sync.js";

/** Teacher sync with the client's database, mounted at /api/admin/sync. */
export const syncRouter = Router();
syncRouter.use(requireAuth, requireRole("ADMIN"));

/** Is the sync set up, the last runs, and how many accounts still need a password. */
syncRouter.get(
  "/",
  route(async (_req, res) => {
    const [runs, needPassword, synced] = await Promise.all([
      prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
      prisma.user.count({ where: withoutPassword }),
      prisma.user.count({ where: { externalId: { not: null } } }),
    ]);
    res.json({
      configured: syncConfigured(),
      /** Where staff come from (for the admin): the HR server, or this app's own database server. */
      source: config.HR_DB_HOST ? `${config.HR_DB_HOST}${config.HR_DB_NAME ? `/${config.HR_DB_NAME}` : ""}` : config.TEACHER_SOURCE_QUERY ? "same-server" : null,
      photos: Boolean(config.HR_DB_HOST && config.HR_PHOTO_IMPORT),
      nightly: config.SYNC_NIGHTLY,
      syncedAccounts: synced,
      needPassword,
      runs: runs.map(toSyncDto),
    });
  }),
);

/** "Sinkronkan sekarang". force: skip the too-many-deactivations safety stop. */
syncRouter.post(
  "/",
  route(async (req, res) => {
    const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    res.json({ run: await runTeacherSync({ trigger: "MANUAL", actorId: req.user!.id, force }) });
  }),
);

/** One-time passwords for every active account that has none yet. Shown once; the admin downloads the list. */
syncRouter.post(
  "/passwords",
  route(async (req, res) => {
    res.json({ accounts: await issueMissingPasswords(req.user!.id) });
  }),
);
