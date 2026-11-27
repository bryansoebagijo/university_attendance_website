import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { evaluateLicense, extractToken, verifyLicense, type LicensePayload, type VerifyResult } from "../src/lib/license.js";
import { setLicenseStatusForTests } from "../src/services/license.js";
import { app, sessionCookie } from "./helpers.js";

afterAll(() => prisma.$disconnect());
afterEach(() => setLicenseStatusForTests(null));

// A throwaway key pair, so the tests never touch the developer's real signing key.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" }).toString();

function issue(p: Partial<LicensePayload> = {}) {
  const payload = { v: 1, id: "LIC-TEST-1", customer: "ISTA Al-Kamal", issuedAt: "2026-11-26", expiresAt: "2027-12-31", graceDays: 14, ...p };
  const body = Buffer.from(JSON.stringify(payload));
  return `-----BEGIN ISTA PRESENSI LICENSE-----\nCustomer: x\n${body.toString("base64url")}.${sign(null, body, privateKey).toString("base64url")}\n-----END ISTA PRESENSI LICENSE-----\n`;
}
const at = (today: string, v: VerifyResult, latestSeen: Date | null = null) =>
  evaluateLicense(v, { today, now: new Date(`${today}T12:00:00+07:00`), latestSeen, enforced: true });

describe("license signature", () => {
  it("accepts a license signed with the matching key", () => {
    const v = verifyLicense(issue(), PUB);
    expect(v).toMatchObject({ ok: true, payload: { customer: "ISTA Al-Kamal", expiresAt: "2027-12-31" } });
  });

  it("rejects edited, foreign, empty and locked licenses", () => {
    const text = issue();
    const token = extractToken(text)!;
    const [body, sig] = token.split(".");
    const edited = JSON.parse(Buffer.from(body, "base64url").toString());
    edited.expiresAt = "2099-12-31"; // someone extends the date by hand
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${sig}`;
    expect(verifyLicense(forged, PUB)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });

    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyLicense(text, other)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyLicense("", PUB)).toEqual({ ok: false, reason: "NO_LICENSE" });
    expect(verifyLicense("hello world", PUB)).toEqual({ ok: false, reason: "NOT_A_LICENSE" });
    expect(verifyLicense(issue({ lock: { domain: "x.ac.id" } }), PUB)).toEqual({ ok: false, reason: "UNSUPPORTED_LOCK" });
  });

  it("only reads the signed line, so the readable header and Windows line endings don't matter", () => {
    expect(verifyLicense(issue().replace(/\n/g, "\r\n").replace("Customer: x", "Customer: anything"), PUB).ok).toBe(true);
  });
});

describe("license states", () => {
  const v = verifyLicense(issue({ expiresAt: "2027-12-31", graceDays: 14 }), PUB);
  it("valid → reminder 30 days before → grace → read-only", () => {
    expect(at("2027-06-01", v)).toMatchObject({ state: "VALID", readOnly: false });
    expect(at("2027-12-01", v)).toMatchObject({ state: "EXPIRING", readOnly: false, daysLeft: 30 });
    expect(at("2027-12-31", v)).toMatchObject({ state: "EXPIRING", readOnly: false, daysLeft: 0 });
    expect(at("2028-01-01", v)).toMatchObject({ state: "GRACE", readOnly: false, graceUntil: "2028-01-14" });
    expect(at("2028-01-14", v)).toMatchObject({ state: "GRACE", readOnly: false });
    expect(at("2028-01-15", v)).toMatchObject({ state: "EXPIRED", readOnly: true });
  });

  it("missing or invalid → read-only; not enforced outside production", () => {
    expect(at("2027-06-01", { ok: false, reason: "NO_LICENSE" })).toMatchObject({ state: "MISSING", readOnly: true });
    expect(at("2027-06-01", { ok: false, reason: "BAD_SIGNATURE" })).toMatchObject({ state: "INVALID", readOnly: true });
    expect(evaluateLicense({ ok: false, reason: "NO_LICENSE" }, { today: "2027-06-01", now: new Date(), latestSeen: null, enforced: false })).toMatchObject({
      state: "DEV",
      readOnly: false,
    });
  });

  it("notices a clock turned back (stored data newer than the clock)", () => {
    expect(at("2027-06-01", v, new Date("2027-06-01T10:00:00+07:00"))).toMatchObject({ state: "VALID" });
    expect(at("2027-06-01", v, new Date("2028-03-01T10:00:00+07:00"))).toMatchObject({ state: "CLOCK_BACK", readOnly: true });
  });
});

describe("read-only mode", () => {
  const readOnly = () => setLicenseStatusForTests({ ...at("2028-02-01", verifyLicense(issue(), PUB)) });

  it("blocks changes but keeps reading, signing in and changing one's own password", async () => {
    const rina = await sessionCookie("rina@ista.ac.id");
    readOnly();
    const scan = await request(app).post("/api/attendance/scan").set("Cookie", rina).send({ token: "x", action: "in" });
    expect(scan.status).toBe(403);
    expect(scan.body).toMatchObject({ error: "LICENSE_READ_ONLY", state: "EXPIRED" });
    expect((await request(app).post("/api/leave").set("Cookie", rina).send({})).body.error).toBe("LICENSE_READ_ONLY");
    expect((await request(app).get("/api/attendance/me").set("Cookie", rina)).status).toBe(200);
    expect((await request(app).get("/api/leave/me").set("Cookie", rina)).status).toBe(200);
    // Allowed: login and own password/preferences.
    const login = await request(app).post("/api/auth/login").send({ login: "rina@ista.ac.id", password: process.env.SEED_PASSWORD ?? "demo123" });
    expect(login.status).toBe(200);
    expect((await request(app).put("/api/me/password").set("Cookie", rina).send({ currentPassword: "wrong", newPassword: "x" })).body.error).not.toBe("LICENSE_READ_ONLY");
  });

  it("tells the app about the license; details only for administrators", async () => {
    readOnly();
    const teacher = await request(app).get("/api/license").set("Cookie", await sessionCookie("rina@ista.ac.id"));
    expect(teacher.body).toMatchObject({ state: "EXPIRED", readOnly: true, expiresAt: "2027-12-31" });
    expect(teacher.body).not.toHaveProperty("customer");
    const admin = await request(app).get("/api/license").set("Cookie", await sessionCookie("admin@ista.ac.id"));
    expect(admin.body).toMatchObject({ customer: "ISTA Al-Kamal", id: "LIC-TEST-1" });
  });

  it("is off when the license is fine", async () => {
    setLicenseStatusForTests(at("2027-06-01", verifyLicense(issue(), PUB)));
    const rina = await sessionCookie("rina@ista.ac.id");
    const scan = await request(app).post("/api/attendance/scan").set("Cookie", rina).send({ token: "x", action: "in" });
    expect(scan.body.error).not.toBe("LICENSE_READ_ONLY");
  });
});

describe("the issuing tool", () => {
  it("writes a license the app accepts (with the matching public key)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lic-"));
    try {
      const keyFile = path.join(dir, "private.pem");
      writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
      const out = path.join(dir, "license.key");
      execFileSync(process.execPath, [path.join(__dirname, "..", "..", "tools", "license", "issue.mjs"), "--customer", "ISTA Al-Kamal", "--expires", "2027-12-31", "--private", keyFile, "--out", out], {
        stdio: "ignore",
      });
      const text = readFileSync(out, "utf8");
      expect(text).toContain("Customer:  ISTA Al-Kamal");
      expect(verifyLicense(text, PUB)).toMatchObject({ ok: true, payload: { customer: "ISTA Al-Kamal", expiresAt: "2027-12-31", graceDays: 14 } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
