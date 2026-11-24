import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { addDays, dateOnly, isWeekend, jakartaDate, jakartaInstant } from "../src/lib/time.js";
import { runDailyRules } from "../src/services/attendance.js";
import { app, sessionCookie } from "./helpers.js";

afterAll(() => prisma.$disconnect());

const today = jakartaDate();
/** The n-th weekday before today (n ≥ 1). */
function weekdayBack(n: number) {
  let d = today;
  let k = 0;
  while (k < n) {
    d = addDays(d, -1);
    if (!isWeekend(d)) k++;
  }
  return d;
}
/** The n-th weekday after today (n ≥ 1). */
function weekdayAhead(n: number) {
  let d = today;
  let k = 0;
  while (k < n) {
    d = addDays(d, 1);
    if (!isWeekend(d)) k++;
  }
  return d;
}

const RINA = "u5";
let rina: string;
let siti: string;
let approver: string;
let admin: string;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

beforeEach(async () => {
  await prisma.leaveRequest.deleteMany({ where: { userId: RINA } });
  await prisma.attendance.deleteMany({ where: { userId: RINA, status: "DEDUCTED" } });
  await prisma.user.update({ where: { id: RINA }, data: { annualQuota: 12 } });
  rina ??= await sessionCookie("rina@ista.ac.id");
  siti ??= await sessionCookie("siti@ista.ac.id");
  approver ??= await sessionCookie("nuraini@ista.ac.id");
  admin ??= await sessionCookie("admin@ista.ac.id");
});

const sick = (start: string, end: string, file?: { data: Buffer; name: string; type: string }) => {
  const r = request(app)
    .post("/api/leave")
    .set("Cookie", rina)
    .field("type", "SICK")
    .field("start", start)
    .field("end", end)
    .field("reason", "Demam tinggi, istirahat di rumah");
  return file ? r.attach("attachment", file.data, { filename: file.name, contentType: file.type }) : r;
};
const approve = (id: string) => request(app).post(`/api/leave/${id}/decision`).set("Cookie", approver).send({ approve: true });
const balance = async () => (await request(app).get("/api/leave/me").set("Cookie", rina)).body.balance;

describe("sick leave", () => {
  it("can be backdated and never touches the annual balance", async () => {
    const day = weekdayBack(1);
    const before = await balance();
    const res = await sick(day, day);
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ type: "SICK", start: day, days: 1, status: "PENDING", attachment: null });
    expect(await balance()).toMatchObject({ pending: before.pending, available: before.available, sickDays: 0 });

    expect((await approve(res.body.request.id)).status).toBe(200);
    expect(await balance()).toMatchObject({ used: before.used, remaining: before.remaining, sickDays: 1 });
  });

  it("is allowed with no annual leave left; annual leave is not", async () => {
    await prisma.user.update({ where: { id: RINA }, data: { annualQuota: 0 } });
    const day = weekdayAhead(3);
    expect((await sick(day, day)).status).toBe(201);
    const annual = await request(app)
      .post("/api/leave")
      .set("Cookie", rina)
      .send({ start: weekdayAhead(6), end: weekdayAhead(6), reason: "Keperluan keluarga" });
    expect(annual.body.error).toBe("INSUFFICIENT_BALANCE");
  });

  it("may start at most 7 days ago; annual leave still cannot start in the past", async () => {
    const tooOld = addDays(today, -8);
    expect((await sick(tooOld, tooOld)).body.error).toBe("SICK_TOO_LATE");
    const day = weekdayBack(1);
    const annual = await request(app).post("/api/leave").set("Cookie", rina).send({ start: day, end: day, reason: "Keperluan keluarga" });
    expect(annual.body.error).toBe("START_IN_PAST");
  });

  it("needs a doctor's note from 2 working days", async () => {
    const start = weekdayBack(2);
    const end = weekdayBack(1);
    const missing = await sick(start, end);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("SICK_NOTE_REQUIRED");

    const ok = await sick(start, end, { data: PDF, name: "surat dokter.pdf", type: "application/pdf" });
    expect(ok.status).toBe(201);
    expect(ok.body.request.attachment).toMatchObject({ mimeType: "application/pdf", fileName: "surat dokter.pdf" });
  });

  it("re-encodes image notes and rejects files that only claim to be PDFs", async () => {
    const day = weekdayAhead(2);
    const png = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const img = await sick(day, day, { data: png, name: "foto.png", type: "image/png" });
    expect(img.status).toBe(201);
    expect(img.body.request.attachment).toMatchObject({ mimeType: "image/jpeg", fileName: "foto.jpg" });
    const stored = await prisma.leaveAttachment.findUniqueOrThrow({ where: { requestId: img.body.request.id } });
    expect((await sharp(Buffer.from(stored.data)).metadata()).width).toBeLessThanOrEqual(2000);

    const other = weekdayAhead(4);
    const fake = await sick(other, other, { data: Buffer.from("not a pdf"), name: "x.pdf", type: "application/pdf" });
    expect(fake.status).toBe(415);
    const exe = await sick(other, other, { data: Buffer.from("MZ"), name: "x.exe", type: "application/octet-stream" });
    expect(exe.status).toBe(415);
  });

  it("does not accept attachments on annual leave", async () => {
    const day = weekdayAhead(5);
    const res = await request(app)
      .post("/api/leave")
      .set("Cookie", rina)
      .field("type", "ANNUAL")
      .field("start", day)
      .field("end", day)
      .field("reason", "Keperluan keluarga")
      .attach("attachment", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.body.error).toBe("ATTACHMENT_NOT_ALLOWED");
  });

  it("cannot overlap the person's annual leave", async () => {
    const day = weekdayAhead(8);
    const annual = await request(app).post("/api/leave").set("Cookie", rina).send({ start: day, end: day, reason: "Keperluan keluarga" });
    expect(annual.status).toBe(201);
    expect((await sick(day, day)).body.error).toBe("OVERLAPS_EXISTING");
  });

  it("shows the note to the requester, approvers and admins only", async () => {
    const day = weekdayBack(1);
    const { body } = await sick(day, day, { data: PDF, name: "surat.pdf", type: "application/pdf" });
    const url = `/api/leave/${body.request.id}/attachment`;
    for (const cookie of [rina, approver, admin]) {
      const res = await request(app).get(url).set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain('filename="surat.pdf"');
    }
    expect((await request(app).get(url).set("Cookie", siti)).status).toBe(404);
    expect((await request(app).get(url)).status).toBe(401);
  });

  it("appears in the approver queue and the admin list with its type", async () => {
    const day = weekdayBack(1);
    const { body } = await sick(day, day);
    const pending = await request(app).get("/api/leave/pending").set("Cookie", approver);
    expect(pending.body.requests.find((r: { id: string }) => r.id === body.request.id)).toMatchObject({ type: "SICK" });
    const list = await request(app).get("/api/admin/leave?type=SICK").set("Cookie", admin);
    expect(list.body.requests.every((r: { type: string }) => r.type === "SICK")).toBe(true);
    expect(list.body.requests.some((r: { id: string }) => r.id === body.request.id)).toBe(true);
  });
});

describe("sick leave in reports and the nightly job", () => {
  it("counts approved sick days as Sakit, not as absent", async () => {
    const day = weekdayBack(1);
    const month = day.slice(0, 7);
    await prisma.attendance.deleteMany({ where: { userId: RINA, date: dateOnly(day) } });
    const rowFor = async () =>
      (await request(app).get(`/api/admin/reports/monthly?month=${month}`).set("Cookie", admin)).body.rows.find(
        (r: { user: { id: string } }) => r.user.id === RINA,
      );

    const { body } = await sick(day, day);
    const pending = await rowFor();
    expect(pending.sick).toBe(0);

    await approve(body.request.id);
    const after = await rowFor();
    expect(after.sick).toBe(1);
    expect(after.absent).toBe(pending.absent - 1);
  });

  it("does not deduct a missing clock-out on an approved sick day", async () => {
    const old = addDays(today, -75);
    const other = addDays(today, -76);
    await prisma.attendance.deleteMany({ where: { userId: RINA, date: { in: [dateOnly(old), dateOnly(other)] } } });
    const loc = await prisma.location.findFirstOrThrow({ where: { active: true } });
    const row = (date: string) => ({ userId: RINA, date: dateOnly(date), clockIn: jakartaInstant(date, "07:30"), inLocationId: loc.id, status: "MISSING_CLOCK_OUT" as const });
    const covered = await prisma.attendance.create({ data: row(old) });
    const uncovered = await prisma.attendance.create({ data: row(other) });
    // Approved sick leave for the first day only (inserted directly: it is older than the API's 7-day window).
    await prisma.leaveRequest.create({
      data: { userId: RINA, type: "SICK", startDate: dateOnly(old), endDate: dateOnly(old), days: 1, reason: "Sakit", status: "APPROVED" },
    });

    const fix = await request(app).get("/api/attendance/me/corrections").set("Cookie", rina);
    expect(fix.body.missing.find((a: { id: string }) => a.id === covered.id)).toMatchObject({ sickExcused: true });
    expect(fix.body.missing.find((a: { id: string }) => a.id === uncovered.id)).toMatchObject({ sickExcused: false });

    await runDailyRules();
    expect((await prisma.attendance.findUniqueOrThrow({ where: { id: covered.id } })).status).toBe("MISSING_CLOCK_OUT");
    expect((await prisma.attendance.findUniqueOrThrow({ where: { id: uncovered.id } })).status).toBe("DEDUCTED");
    await prisma.attendance.deleteMany({ where: { id: { in: [covered.id, uncovered.id] } } });
  });
});
