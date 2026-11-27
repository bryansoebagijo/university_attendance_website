import { createPublicKey, verify } from "node:crypto";
import { addDays } from "./time.js";

/**
 * License files are issued by the developer (tools/license/issue.mjs) and signed with Ed25519.
 * The app checks the signature with the public key built into the code, so a license can't be edited
 * or made up. No internet needed.
 */
export interface LicensePayload {
  v: 1;
  id: string;
  customer: string;
  issuedAt: string; // YYYY-MM-DD
  expiresAt: string; // YYYY-MM-DD, last valid day (Asia/Jakarta)
  graceDays: number;
  note?: string;
  /** Optional binding (e.g. a domain or installation id) — reserved; this version supports none. */
  lock?: Record<string, unknown>;
}

/**
 * VALID      everything works
 * EXPIRING   ≤ WARN_DAYS left — administrators see a reminder
 * GRACE      expired, within the grace period — everyone sees a warning, everything still works
 * EXPIRED    grace period over — read-only
 * MISSING    no license installed — read-only
 * INVALID    damaged, edited or unknown license — read-only
 * CLOCK_BACK the server clock is earlier than data already stored — read-only (clock turned back)
 * DEV        development/test: not enforced
 */
export type LicenseState = "VALID" | "EXPIRING" | "GRACE" | "EXPIRED" | "MISSING" | "INVALID" | "CLOCK_BACK" | "DEV";
export const WARN_DAYS = 30;
/** Clock-back tolerance: stored data may be this far "in the future" before we call it tampering. */
export const CLOCK_TOLERANCE_MS = 36 * 3600 * 1000;

export interface LicenseStatus {
  state: LicenseState;
  readOnly: boolean;
  enforced: boolean;
  id: string | null;
  customer: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  graceUntil: string | null;
  /** Days until expiresAt (negative once expired). */
  daysLeft: number | null;
  /** Why it is MISSING/INVALID, for the administrator. */
  reason: string | null;
}

/** Finds the signed line (base64url.base64url) anywhere in the text: the readable header is ignored. */
export function extractToken(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}$/.test(t)) return t;
  }
  return null;
}

export type VerifyResult = { ok: true; payload: LicensePayload } | { ok: false; reason: string };

export function verifyLicense(text: string | null | undefined, publicKeyPem: string): VerifyResult {
  if (!text || !text.trim()) return { ok: false, reason: "NO_LICENSE" };
  const token = extractToken(text);
  if (!token) return { ok: false, reason: "NOT_A_LICENSE" };
  const [body, sig] = token.split(".");
  const bytes = Buffer.from(body, "base64url");
  let good = false;
  try {
    good = verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(sig, "base64url"));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "BAD_SIGNATURE" };
  let p: LicensePayload;
  try {
    p = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "BAD_CONTENT" };
  }
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (p.v !== 1 || !p.customer || !date.test(p.expiresAt) || !date.test(p.issuedAt) || !Number.isInteger(p.graceDays) || p.graceDays < 0) {
    return { ok: false, reason: "BAD_CONTENT" };
  }
  // A lock this version doesn't understand must not be silently ignored.
  if (p.lock && Object.keys(p.lock).length > 0) return { ok: false, reason: "UNSUPPORTED_LOCK" };
  return { ok: true, payload: p };
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * @param today      YYYY-MM-DD in Asia/Jakarta
 * @param now        the server clock
 * @param latestSeen the newest timestamp already stored in the database (clock-back check)
 */
export function evaluateLicense(v: VerifyResult, opts: { today: string; now: Date; latestSeen: Date | null; enforced: boolean }): LicenseStatus {
  const base: LicenseStatus = {
    state: "VALID",
    readOnly: false,
    enforced: opts.enforced,
    id: null,
    customer: null,
    issuedAt: null,
    expiresAt: null,
    graceUntil: null,
    daysLeft: null,
    reason: null,
  };
  if (v.ok) {
    const p = v.payload;
    Object.assign(base, { id: p.id, customer: p.customer, issuedAt: p.issuedAt, expiresAt: p.expiresAt, graceUntil: addDays(p.expiresAt, p.graceDays), daysLeft: daysBetween(opts.today, p.expiresAt) });
  }
  let state: LicenseState;
  if (!v.ok) {
    state = v.reason === "NO_LICENSE" ? "MISSING" : "INVALID";
    base.reason = v.reason;
  } else if (opts.latestSeen && opts.latestSeen.getTime() > opts.now.getTime() + CLOCK_TOLERANCE_MS) {
    state = "CLOCK_BACK";
    base.reason = `Stored data is dated ${opts.latestSeen.toISOString()}, later than the server clock.`;
  } else if (opts.today <= v.payload.expiresAt) {
    state = base.daysLeft! <= WARN_DAYS ? "EXPIRING" : "VALID";
  } else if (opts.today <= base.graceUntil!) {
    state = "GRACE";
  } else {
    state = "EXPIRED";
  }
  if (!opts.enforced) return { ...base, state: "DEV", readOnly: false, reason: base.reason ?? (v.ok ? null : v.reason) };
  return { ...base, state, readOnly: ["EXPIRED", "MISSING", "INVALID", "CLOCK_BACK"].includes(state) };
}
