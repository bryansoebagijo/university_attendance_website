/**
 * Rotating QR tokens for kiosk screens.
 *
 * Format: ISTA2.<locationId>.<slot>.<sig>
 *   slot = floor(unixMillis / 30 s)
 *   sig  = first 16 bytes of HMAC-SHA256(location.qrSecret, "<locationId>.<slot>"), base64url
 *
 * The secret never leaves the server. A token is accepted for its own slot and the next one,
 * so a code is valid for at most ~60 s after it appears on screen.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SLOT_MS = 30_000;
const PREFIX = "ISTA2";

export function slotOf(now: number) {
  return Math.floor(now / SLOT_MS);
}

function sign(secret: string, locationId: string, slot: number) {
  return createHmac("sha256", secret).update(`${locationId}.${slot}`).digest().subarray(0, 16).toString("base64url");
}

export function makeToken(locationId: string, secret: string, now = Date.now()) {
  const slot = slotOf(now);
  return {
    token: `${PREFIX}.${locationId}.${slot}.${sign(secret, locationId, slot)}`,
    /** Seconds until this token is replaced on screen. */
    secondsLeft: Math.ceil((SLOT_MS - (now % SLOT_MS)) / 1000),
  };
}

export type ParsedToken = { locationId: string; slot: number; sig: string };

/** Structure only; the signature is checked by verifyToken once the location's secret is known. */
export function parseToken(token: unknown): ParsedToken | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, locationId, slotStr, sig] = parts;
  const slot = Number(slotStr);
  if (!locationId || !Number.isSafeInteger(slot) || !/^[A-Za-z0-9_-]{22}$/.test(sig)) return null;
  return { locationId, slot, sig };
}

export function verifyToken(t: ParsedToken, secret: string, now = Date.now()): "ok" | "invalid" | "expired" {
  const expected = Buffer.from(sign(secret, t.locationId, t.slot));
  const given = Buffer.from(t.sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  const cur = slotOf(now);
  if (t.slot === cur || t.slot === cur - 1) return "ok";
  return "expired";
}

export function newSecret() {
  return randomBytes(32).toString("hex");
}

// ---- Kiosk device keys ------------------------------------------------------
// A kiosk screen proves it may fetch tokens with a random key that an admin issues.
// Only the SHA-256 hash is stored.

export function newKioskKey() {
  return randomBytes(24).toString("base64url");
}

export function hashKioskKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export function kioskKeyMatches(key: string, storedHash: string | null) {
  if (!storedHash) return false;
  const a = Buffer.from(hashKioskKey(key), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
