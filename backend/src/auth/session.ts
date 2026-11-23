import type { Role } from "@prisma/client";
import type { CookieOptions } from "express";
import { jwtVerify, SignJWT } from "jose";
import { config, isProd } from "../config.js";

/** Same cookie name the frontend middleware reads. */
export const SESSION_COOKIE = "absen_session";
const key = new TextEncoder().encode(config.JWT_SECRET);

export interface SessionClaims {
  sub: string; // user id
  role: Role;
  /** Must equal user.sessionVersion; bumping that column revokes every older token. */
  ver: number;
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, ver: claims.ver })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${config.SESSION_HOURS}h`)
    .sign(key);
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const role = payload.role;
    if (!payload.sub || (role !== "USER" && role !== "APPROVER" && role !== "ADMIN")) return null;
    return { sub: payload.sub, role, ver: typeof payload.ver === "number" ? payload.ver : -1 };
  } catch {
    return null;
  }
}

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true, // not readable by page scripts
  sameSite: "lax",
  secure: isProd, // HTTPS only in production
  path: "/",
  maxAge: config.SESSION_HOURS * 60 * 60 * 1000,
};
