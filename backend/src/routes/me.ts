import bcrypt from "bcryptjs";
import { Router } from "express";
import multer from "multer";
import { toProfileJpeg } from "../lib/photo.js";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "../auth/session.js";
import { prisma } from "../db.js";
import { HttpError, route } from "../lib/http.js";
import { hashPassword, newPasswordSchema } from "../lib/password.js";
import { toUserDto, userSelect } from "../lib/user-dto.js";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get(
  "/",
  route(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: userSelect });
    res.json({ user: toUserDto(user) });
  }),
);

const prefsSchema = z
  .object({ locale: z.enum(["id", "en"]).optional(), theme: z.enum(["light", "dark"]).optional() })
  .strict()
  .refine((v) => v.locale || v.theme, "Nothing to update");

meRouter.patch(
  "/preferences",
  route(async (req, res) => {
    const data = prefsSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data, select: userSelect });
    res.json({ user: toUserDto(user) });
  }),
);

// ---- Password -------------------------------------------------------------

const passwordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: newPasswordSchema });

/**
 * Change my password. Signs out every other session (sessionVersion + 1) and gives
 * this browser a fresh session cookie so the user stays signed in here.
 */
meRouter.put(
  "/password",
  route(async (req, res) => {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { passwordHash: true } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new HttpError(400, "WRONG_PASSWORD");
    if (await bcrypt.compare(newPassword, user.passwordHash)) throw new HttpError(400, "SAME_PASSWORD");

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, sessionVersion: { increment: 1 } },
      select: { ...userSelect, sessionVersion: true },
    });
    const { sessionVersion, ...rest } = updated;
    res.cookie(SESSION_COOKIE, await signSession({ sub: updated.id, role: updated.role, ver: sessionVersion }), sessionCookieOptions);
    res.json({ user: toUserDto(rest) });
  }),
);

// ---- Profile photo -------------------------------------------------------

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
});

meRouter.put(
  "/photo",
  upload.single("photo"),
  route(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, "PHOTO_REQUIRED");
    if (!ALLOWED.has(file.mimetype)) throw new HttpError(415, "UNSUPPORTED_IMAGE");

    // Re-encode on the server: square crop, 320 px, JPEG, EXIF stripped and rotation applied.
    // Also rejects files that only pretend to be images.
    let data: Buffer;
    try {
      data = await toProfileJpeg(file.buffer);
    } catch {
      throw new HttpError(415, "UNSUPPORTED_IMAGE");
    }

    const userId = req.user!.id;
    await prisma.userPhoto.upsert({
      where: { userId },
      // The person's own choice: the HR sync never replaces it.
      create: { userId, data, mimeType: "image/jpeg", size: data.length, source: "UPLOAD" },
      update: { data, mimeType: "image/jpeg", size: data.length, source: "UPLOAD", sourceHash: null },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect });
    res.json({ user: toUserDto(user) });
  }),
);

meRouter.delete(
  "/photo",
  route(async (req, res) => {
    await prisma.userPhoto.deleteMany({ where: { userId: req.user!.id } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: userSelect });
    res.json({ user: toUserDto(user) });
  }),
);
