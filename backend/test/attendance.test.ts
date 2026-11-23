import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { makeToken, parseToken, SLOT_MS, verifyToken } from "../src/lib/qr.js";
import { addDays, addMonths, dateOnly, jakartaDate } from "../src/lib/time.js";
import { runDailyRules } from "../src/services/attendance.js";
import { app, sessionCookie } from "./helpers.js";

const SECRET = "test-secret";
afterAll(() => prisma.$disconnect());

async function secretOf(id: string) {
  return (await prisma.location.findUniqueOrThrow({ where: { id } })).qrSecret;
}
async function tokenFor(id: string, now = Date.now()) {
  return makeToken(id, await secretOf(id), now).token;
}

describe("QR tokens", () => {
  it("verifies its own and the previous slot only", () => {
    const now = 1_800_000_000_000;
    const t = parseToken(makeToken("gedung-a", SECRET, now).token)!;
    expect(verifyToken(t, SECRET, now)).toBe("ok");
    expect(verifyToken(t, SECRET, now + SLOT_MS)).toBe("ok");
    expect(verifyToken(t, SECRET, now + 2 * SLOT_MS)).toBe("expired");
  });

  it("rejects a wrong secret, a tampered location and junk", () => {
    const { token } = makeToken("gedung-a", SECRET);
    expect(verifyToken(parseToken(token)!, "other-secret")).toBe("invalid");
    expect(verifyToken(parseToken(token.replace("gedung-a", "gedung-b"))!, SECRET)).toBe("invalid");
    expect(parseToken("hello")).toBeNull();
    expect(parseToken("ISTA1.gedung-a.1.abc")).toBeNull();
  });
});

describe("POST /api/attendance/scan", () => {
  const today = jakartaDate();
  beforeEach(async () => {
    await prisma.attendance.deleteMany({ where: { userId: "u2", date: dateOnly(today) } });
  });

  it("clocks in, refuses a second clock-in, clocks out, then refuses again", async () => {
    const cookie = await sessionCookie("ahmad@ista.ac.id");
    const scan = async (action: "in" | "out") =>
      request(app).post("/api/attendance/scan").set("Cookie", cookie).send({ token: await tokenFor("gedung-a"), action });

    const outFirst = await scan("out");
    expect(outFirst.status).toBe(409);
    expect(outFirst.body.error).toBe("NOT_CLOCKED_IN");

    const inRes = await scan("in");
    expect(inRes.status).toBe(200);
    expect(inRes.body.record).toMatchObject({ date: today, status: "CLOCKED_IN", clockOut: null });
    expect(inRes.body.location).toEqual({ id: "gedung-a", name: "Lobi Gedung A" });

    expect((await scan("in")).body.error).toBe("ALREADY_CLOCKED_IN");

    const outRes = await scan("out");
    expect(outRes.status).toBe(200);
    expect(outRes.body.record.status).toBe("COMPLETE");
    expect(outRes.body.record.clockOut).not.toBeNull();

    expect((await scan("out")).body.error).toBe("ALREADY_DONE");
    expect((await scan("in")).body.error).toBe("ALREADY_DONE");
  });

  it("rejects expired, forged and inactive-location tokens", async () => {
    const cookie = await sessionCookie("ahmad@ista.ac.id");
    const post = (token: string) => request(app).post("/api/attendance/scan").set("Cookie", cookie).send({ token, action: "in" });

    expect((await post(await tokenFor("gedung-a", Date.now() - 3 * SLOT_MS))).body.error).toBe("EXPIRED_QR");
    expect((await post(makeToken("gedung-a", "guessed-secret").token)).body.error).toBe("INVALID_QR");
    expect((await post("ISTA2.nowhere.1.AAAAAAAAAAAAAAAAAAAAAA")).body.error).toBe("INVALID_QR");
    expect((await post(await tokenFor("lab-c"))).body.error).toBe("LOCATION_INACTIVE");
    expect((await post("not a token")).body.error).toBe("INVALID_QR");
    expect(await prisma.attendance.count({ where: { userId: "u2", date: dateOnly(today) } })).toBe(0);
  });

  it("records whether the QR came from the camera or an uploaded image", async () => {
    const cookie = await sessionCookie("ahmad@ista.ac.id");
    const inRes = await request(app)
      .post("/api/attendance/scan")
      .set("Cookie", cookie)
      .send({ token: await tokenFor("gedung-a"), action: "in", method: "upload" });
    expect(inRes.body.record).toMatchObject({ inMethod: "UPLOAD", outMethod: null });
    const outRes = await request(app).post("/api/attendance/scan").set("Cookie", cookie).send({ token: await tokenFor("gedung-a"), action: "out" });
    expect(outRes.body.record).toMatchObject({ inMethod: "UPLOAD", outMethod: "CAMERA" }); // default is camera

    const bad = await request(app).post("/api/attendance/scan").set("Cookie", cookie).send({ token: await tokenFor("gedung-a"), action: "in", method: "fax" });
    expect(bad.status).toBe(400);

    const admin = await sessionCookie("admin@ista.ac.id");
    const report = await request(app).get(`/api/admin/reports/monthly?month=${today.slice(0, 7)}`).set("Cookie", admin);
    expect(report.body.rows.find((r: { user: { id: string } }) => r.user.id === "u2").uploads).toBeGreaterThanOrEqual(1);
  });

  it("requires a session", async () => {
    const res = await request(app).post("/api/attendance/scan").send({ token: await tokenFor("gedung-a"), action: "in" });
    expect(res.status).toBe(401);
  });
});

describe("fixing a missing clock-out", () => {
  const today = jakartaDate();
  const recent = addDays(today, -3);

  async function makeMissing(userId: string, date: string) {
    await prisma.attendance.deleteMany({ where: { userId, date: dateOnly(date) } });
    return prisma.attendance.create({
      data: { userId, date: dateOnly(date), clockIn: new Date(`${date}T07:30:00+07:00`), inLocationId: "gedung-a", status: "MISSING_CLOCK_OUT" },
    });
  }

  it("lists it, validates input, then fixes it once", async () => {
    const rec = await makeMissing("u3", recent);
    const cookie = await sessionCookie("dewi@ista.ac.id");

    const list = await request(app).get("/api/attendance/me/corrections").set("Cookie", cookie);
    const item = list.body.missing.find((m: { id: string }) => m.id === rec.id);
    expect(item.fixDeadline).toBe(addMonths(recent, 2));

    const fix = (body: object) => request(app).patch(`/api/attendance/${rec.id}/fix`).set("Cookie", cookie).send(body);
    expect((await fix({ time: "16:00", reason: "short" })).status).toBe(400);
    expect((await fix({ time: "07:00", reason: "Lupa memindai, rapat sampai sore" })).body.error).toBe("CLOCK_OUT_BEFORE_IN");

    const ok = await fix({ time: "16:30", reason: "Lupa memindai, rapat sampai sore" });
    expect(ok.status).toBe(200);
    expect(ok.body.record).toMatchObject({ status: "FIXED", fixReason: "Lupa memindai, rapat sampai sore" });
    expect(ok.body.record.clockOut).toBe(new Date(`${recent}T16:30:00+07:00`).toISOString());

    expect((await fix({ time: "16:30", reason: "Lupa memindai, rapat sampai sore" })).body.error).toBe("NOT_FIXABLE");
  });

  it("won't let someone fix another person's record", async () => {
    const rec = await makeMissing("u3", addDays(today, -4));
    const other = await sessionCookie("rina@ista.ac.id");
    const res = await request(app).patch(`/api/attendance/${rec.id}/fix`).set("Cookie", other).send({ time: "16:00", reason: "Bukan milik saya sama sekali" });
    expect(res.status).toBe(404);
  });
});

describe("daily rules job", () => {
  it("closes stale clock-ins and deducts overdue missing clock-outs, idempotently", async () => {
    const now = new Date();
    const today = jakartaDate(now);
    const yesterday = addDays(today, -1);
    const old = addDays(addMonths(today, -2), -1); // deadline was yesterday
    const notYet = addDays(addMonths(today, -2), 1); // deadline is tomorrow
    await prisma.attendance.deleteMany({ where: { userId: "u5", date: { in: [yesterday, old, notYet].map(dateOnly) } } });
    const mk = (date: string, status: "CLOCKED_IN" | "MISSING_CLOCK_OUT") =>
      prisma.attendance.create({ data: { userId: "u5", date: dateOnly(date), clockIn: new Date(`${date}T07:30:00+07:00`), inLocationId: "gedung-a", status } });
    const [a, b, c] = [await mk(yesterday, "CLOCKED_IN"), await mk(old, "MISSING_CLOCK_OUT"), await mk(notYet, "MISSING_CLOCK_OUT")];

    await runDailyRules(now);
    const status = async (id: string) => (await prisma.attendance.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(a.id)).toBe("MISSING_CLOCK_OUT");
    expect(await status(b.id)).toBe("DEDUCTED");
    expect(await status(c.id)).toBe("MISSING_CLOCK_OUT");

    const again = await runDailyRules(now);
    expect(await status(b.id)).toBe("DEDUCTED");
    expect(again.deducted).toBe(0);
  });
});

describe("kiosk", () => {
  it("needs a valid kiosk key, and a new key replaces the old one", async () => {
    expect((await request(app).get("/api/kiosk/gedung-a/token")).status).toBe(401);

    const admin = await sessionCookie("admin@ista.ac.id");
    const key1 = (await request(app).post("/api/admin/locations/gedung-a/kiosk-key").set("Cookie", admin)).body.key as string;
    const res = await request(app).get("/api/kiosk/gedung-a/token").set("X-Kiosk-Key", key1);
    expect(res.status).toBe(200);
    expect(res.body.location.name).toBe("Lobi Gedung A");
    expect(res.body.secondsLeft).toBeGreaterThan(0);

    // The kiosk's token works for a real scan.
    await prisma.attendance.deleteMany({ where: { userId: "u2", date: dateOnly(jakartaDate()) } });
    const teacher = await sessionCookie("ahmad@ista.ac.id");
    const scan = await request(app).post("/api/attendance/scan").set("Cookie", teacher).send({ token: res.body.token, action: "in" });
    expect(scan.status).toBe(200);

    const key2 = (await request(app).post("/api/admin/locations/gedung-a/kiosk-key").set("Cookie", admin)).body.key as string;
    expect((await request(app).get("/api/kiosk/gedung-a/token").set("X-Kiosk-Key", key1)).status).toBe(401);
    expect((await request(app).get("/api/kiosk/gedung-a/token").set("X-Kiosk-Key", key2)).status).toBe(200);
    expect((await request(app).get("/api/kiosk/nowhere/token").set("X-Kiosk-Key", key2)).status).toBe(401);
  });
});

describe("downloading a location's current QR (admin)", () => {
  it("returns a working, short-lived code; admin-only; not for inactive locations", async () => {
    const teacher = await sessionCookie("ahmad@ista.ac.id");
    expect((await request(app).get("/api/admin/locations/gedung-a/qr").set("Cookie", teacher)).status).toBe(403);

    const admin = await sessionCookie("admin@ista.ac.id");
    const res = await request(app).get("/api/admin/locations/gedung-a/qr").set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body.location.name).toBe("Lobi Gedung A");
    expect(res.body.token).toMatch(/^ISTA2\.gedung-a\.\d+\./);
    const msLeft = new Date(res.body.validUntil).getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(30_000);
    expect(msLeft).toBeLessThanOrEqual(61_000);

    // The downloaded code works for a real scan.
    await prisma.attendance.deleteMany({ where: { userId: "u2", date: dateOnly(jakartaDate()) } });
    const scan = await request(app).post("/api/attendance/scan").set("Cookie", teacher).send({ token: res.body.token, action: "in", method: "upload" });
    expect(scan.status).toBe(200);

    expect((await request(app).get("/api/admin/locations/lab-c/qr").set("Cookie", admin)).body.error).toBe("LOCATION_INACTIVE");
    expect((await request(app).get("/api/admin/locations/nowhere/qr").set("Cookie", admin)).status).toBe(404);
  });
});

describe("admin routes", () => {
  it("are admin-only", async () => {
    const teacher = await sessionCookie("siti@ista.ac.id");
    const approver = await sessionCookie("bambang@ista.ac.id");
    for (const cookie of [teacher, approver]) {
      expect((await request(app).get("/api/admin/attendance").set("Cookie", cookie)).status).toBe(403);
      expect((await request(app).post("/api/admin/locations/gedung-a/kiosk-key").set("Cookie", cookie)).status).toBe(403);
    }
  });

  it("lists attendance with filters and manages locations", async () => {
    const admin = await sessionCookie("admin@ista.ac.id");
    const missing = await request(app).get("/api/admin/attendance?status=MISSING_CLOCK_OUT").set("Cookie", admin);
    expect(missing.status).toBe(200);
    expect(missing.body.records.every((r: { status: string }) => r.status === "MISSING_CLOCK_OUT")).toBe(true);
    expect(missing.body.records[0].user).toHaveProperty("name");

    const created = await request(app).post("/api/admin/locations").set("Cookie", admin).send({ name: "Perpustakaan Pusat", building: "Gedung D" });
    expect(created.status).toBe(201);
    expect(created.body.location).toMatchObject({ id: "perpustakaan-pusat", active: true, kioskPaired: false });
    expect(created.body.location.qrSecret).toBeUndefined();

    const off = await request(app).patch(`/api/admin/locations/${created.body.location.id}`).set("Cookie", admin).send({ active: false });
    expect(off.body.location.active).toBe(false);

    const list = await request(app).get("/api/admin/locations").set("Cookie", admin);
    expect(list.body.locations.map((l: { id: string }) => l.id)).toContain("perpustakaan-pusat");
  });
});
