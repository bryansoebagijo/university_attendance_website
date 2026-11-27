import type { NextFunction, Request, Response } from "express";
import { readFileSync } from "node:fs";
import { config, isProd } from "../config.js";
import { prisma } from "../db.js";
import { evaluateLicense, type LicenseStatus, verifyLicense } from "../lib/license.js";
import { LICENSE_PUBLIC_KEY } from "../lib/license-public-key.js";
import { jakartaDate } from "../lib/time.js";

/**
 * The installed license and its current state. Read from LICENSE (the text itself) or LICENSE_FILE
 * (a path; the Docker setup mounts config/license.key). Re-read every minute, so a renewed file takes
 * effect without a restart. Enforced only in production.
 */
let current: LicenseStatus | null = null;

function readLicenseText(): string | null {
  if (config.LICENSE) return config.LICENSE;
  if (!config.LICENSE_FILE) return null;
  try {
    return readFileSync(config.LICENSE_FILE, "utf8");
  } catch {
    return null;
  }
}

/** The newest timestamp the app itself has written: if the clock is earlier, it was turned back. */
async function latestStoredTimestamp(): Promise<Date | null> {
  const [a, l, s, x] = await Promise.all([
    prisma.attendance.aggregate({ _max: { updatedAt: true } }),
    prisma.leaveRequest.aggregate({ _max: { updatedAt: true } }),
    prisma.syncRun.aggregate({ _max: { startedAt: true } }),
    prisma.adminAction.aggregate({ _max: { createdAt: true } }),
  ]);
  const dates = [a._max.updatedAt, l._max.updatedAt, s._max.startedAt, x._max.createdAt].filter((d): d is Date => !!d);
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

export async function refreshLicense(enforced = isProd || config.LICENSE_ENFORCE): Promise<LicenseStatus> {
  const now = new Date();
  let latestSeen: Date | null = null;
  try {
    latestSeen = await latestStoredTimestamp();
  } catch {
    // Database briefly unreachable: keep the last known clock check.
  }
  current = evaluateLicense(verifyLicense(readLicenseText(), LICENSE_PUBLIC_KEY), { today: jakartaDate(now), now, latestSeen, enforced });
  return current;
}

export function licenseStatus(): LicenseStatus {
  if (!current) throw new Error("license not loaded yet");
  return current;
}

/** For tests: set the state directly. */
export function setLicenseStatusForTests(s: LicenseStatus | null) {
  current = s;
}

let timer: NodeJS.Timeout | null = null;
export async function startLicenseWatch() {
  const s = await refreshLicense();
  logStatus(s);
  timer ??= setInterval(async () => {
    const before = current?.state;
    const after = await refreshLicense();
    if (after.state !== before) logStatus(after);
  }, 60_000);
  timer.unref();
}

function logStatus(s: LicenseStatus) {
  const who = s.customer ? ` for ${s.customer} (${s.id}), valid until ${s.expiresAt}` : "";
  const msg = `[license] ${s.state}${who}${s.readOnly ? " — READ-ONLY MODE" : ""}${s.reason && s.state !== "VALID" ? ` — ${s.reason}` : ""}`;
  if (s.readOnly || s.state === "GRACE") console.warn(msg);
  else console.log(msg);
}

/** Requests that stay allowed in read-only mode: signing in/out and the user's own password and preferences. */
const ALLOWED_WHEN_READ_ONLY = [/^\/api\/auth\//, /^\/api\/me\/password$/, /^\/api\/me\/preferences$/];

/** Blocks every change (POST/PUT/PATCH/DELETE) while the license is in read-only mode. Reading always works. */
export function licenseGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const s = current;
  if (!s || !s.readOnly) return next();
  if (ALLOWED_WHEN_READ_ONLY.some((r) => r.test(req.path))) return next();
  res.status(403).json({ error: "LICENSE_READ_ONLY", state: s.state });
}
