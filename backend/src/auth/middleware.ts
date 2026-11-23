import type { Role } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { HttpError } from "../lib/http.js";
import { SESSION_COOKIE, verifySession } from "./session.js";

export interface AuthUser {
  id: string;
  role: Role;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Requires a valid session cookie AND an active user in the database.
 * The role comes from the database, so a role change or deactivation applies immediately,
 * and a password change/reset (which bumps sessionVersion) ends every older session.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    const claims = token ? await verifySession(token) : null;
    if (!claims) throw new HttpError(401, "UNAUTHENTICATED");
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, active: true, sessionVersion: true, mustChangePassword: true },
    });
    if (!user || !user.active || user.sessionVersion !== claims.ver) throw new HttpError(401, "UNAUTHENTICATED");
    // With a one-time password, only the "me" routes (profile + password change) are allowed.
    if (user.mustChangePassword && req.baseUrl !== "/api/me") throw new HttpError(403, "PASSWORD_CHANGE_REQUIRED");
    req.user = { id: user.id, role: user.role };
    next();
  } catch (e) {
    next(e);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "UNAUTHENTICATED"));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, "FORBIDDEN"));
    next();
  };
}
