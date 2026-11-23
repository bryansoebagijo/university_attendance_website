import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { HttpError, route } from "../lib/http.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

/** Profile photo bytes. Any signed-in user may view colleagues' photos (shown in approvals and lists). */
usersRouter.get(
  "/:id/photo",
  route(async (req, res) => {
    const photo = await prisma.userPhoto.findUnique({ where: { userId: req.params.id } });
    if (!photo) throw new HttpError(404, "NO_PHOTO");
    res.setHeader("Content-Type", photo.mimeType);
    res.setHeader("Content-Length", String(photo.size));
    // URLs carry ?v=<updatedAt>, so a long private cache is safe.
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(Buffer.from(photo.data));
  }),
);
