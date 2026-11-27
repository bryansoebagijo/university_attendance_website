import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "../auth/session.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { HttpError, route } from "../lib/http.js";
import { toUserDto, userSelect } from "../lib/user-dto.js";

export const authRouter = Router();

// Compared against when the email doesn't exist, so response time doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.NODE_ENV === "test" ? 1000 : 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Per account + IP, so one person's typos don't lock out a whole campus network.
  keyGenerator: (req) => `${req.ip}|${String(req.body?.login ?? req.body?.email ?? "").toLowerCase()}`,
  handler: (_req, res) => {
    res.status(429).json({ error: "TOO_MANY_ATTEMPTS" });
  },
});

/** `login` is an email address or a NIP (`email` is accepted too, for older clients). */
const loginSchema = z
  .object({
    login: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().min(1).max(200).optional(),
    password: z.string().min(1).max(200),
  })
  .refine((b) => b.login || b.email, { message: "login required" })
  .transform((b) => ({ login: (b.login ?? b.email)!, password: b.password }));

authRouter.post(
  "/login",
  loginLimiter,
  route(async (req, res) => {
    const { login, password } = loginSchema.parse(req.body);
    const select = { ...userSelect, passwordHash: true, sessionVersion: true };
    const user = login.includes("@")
      ? await prisma.user.findUnique({ where: { email: login.toLowerCase() }, select })
      : await prisma.user.findUnique({ where: { nip: login }, select });
    // Accounts without a password yet (just imported) can't log in; compare anyway so timing stays the same.
    const ok = (await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH)) && !!user?.passwordHash;
    if (!user || !ok || !user.active) throw new HttpError(401, "INVALID_CREDENTIALS");

    const token = await signSession({ sub: user.id, role: user.role, ver: user.sessionVersion });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions);
    const { passwordHash: _omit, sessionVersion: _v, ...rest } = user;
    res.json({ user: toUserDto(rest) });
  }),
);

authRouter.post("/logout", (_req, res) => {
  const { maxAge: _m, ...opts } = sessionCookieOptions;
  res.clearCookie(SESSION_COOKIE, opts);
  res.status(204).end();
});
