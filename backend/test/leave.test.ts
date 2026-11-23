import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { addDays, dateOnly, isWeekend, jakartaDate } from "../src/lib/time.js";
import { workdaysBetween } from "../src/services/leave.js";
import { app, sessionCookie } from "./helpers.js";

afterAll(() => prisma.$disconnect());

const today = jakartaDate();
/** The n-th weekday after today (n ≥ 1). */
function weekday(n: number) {
  let d = today;
  let k = 0;
  while (k < n) {
    d = addDays(d, 1);
    if (!isWeekend(d)) k++;
  }
  return d;
}
/** Next Saturday after today. */
function saturday() {
  let d = addDays(today, 1);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 6) d = addDays(d, 1);
  return d;
}

const RINA = "u5";
let rina: string;
let approver: string;

beforeEach(async () => {
  await prisma.leaveRequest.deleteMany({ where: { userId: RINA } });
  await prisma.attendance.deleteMany({ where: { userId: RINA, status: "DEDUCTED" } });
  await prisma.user.update({ where: { id: RINA }, data: { annualQuota: 12 } });
  rina ??= await sessionCookie("rina@ista.ac.id");
  approver ??= await sessionCookie("nuraini@ista.ac.id");
});

const create = (cookie: string, start: string, end: string, reason = "Keperluan keluarga di luar kota") =>
  request(app).post("/api/leave").set("Cookie", cookie).send({ start, end, reason });

describe("workdaysBetween", () => {
  it("counts Monday–Friday only, inclusive", () => {
    expect(workdaysBetween("2026-11-16", "2026-11-22")).toBe(5); // Mon–Sun
    expect(workdaysBetween("2026-11-21", "2026-11-22")).toBe(0); // weekend
    expect(workdaysBetween("2026-11-20", "2026-11-19")).toBe(0); // reversed
  });
});

describe("requesting leave", () => {
  it("creates a request and counts it as pending in the balance", async () => {
    const start = weekday(5);
    const end = weekday(7);
    const res = await create(rina, start, end);
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ start, end, days: workdaysBetween(start, end), status: "PENDING", user: { id: RINA } });

    const me = await request(app).get("/api/leave/me").set("Cookie", rina);
    expect(me.body.requests).toHaveLength(1);
    expect(me.body.balance).toMatchObject({ quota: 12, used: 0, pending: res.body.request.days, remaining: 12 });
    expect(me.body.balance.available).toBe(12 - res.body.request.days);
  });

  it("enforces the date rules", async () => {
    const err = async (start: string, end: string) => (await create(rina, start, end)).body.error;
    expect(await err(addDays(today, -1), addDays(today, -1))).toBe("START_IN_PAST");
    expect(await err(weekday(3), weekday(2))).toBe("INVALID_RANGE");
    expect(await err(saturday(), addDays(saturday(), 1))).toBe("NO_WORKDAYS");
    const y = Number(today.slice(0, 4));
    expect(await err(`${y}-12-30`, `${y + 1}-01-02`)).toBe("SPANS_YEARS");
  });

  it("refuses overlapping requests and anything over the available balance", async () => {
    expect((await create(rina, weekday(2), weekday(4))).status).toBe(201);
    expect((await create(rina, weekday(4), weekday(6))).body.error).toBe("OVERLAPS_EXISTING");

    await prisma.user.update({ where: { id: RINA }, data: { annualQuota: 4 } }); // 3 already pending → 1 available
    expect((await create(rina, weekday(10), weekday(11))).body.error).toBe("INSUFFICIENT_BALANCE");
    expect((await create(rina, weekday(10), weekday(10))).status).toBe(201);
  });

  it("subtracts attendance deductions from the balance", async () => {
    await prisma.attendance.deleteMany({ where: { userId: RINA, date: dateOnly(`${today.slice(0, 4)}-01-05`) } });
    await prisma.attendance.create({
      data: { userId: RINA, date: dateOnly(`${today.slice(0, 4)}-01-05`), clockIn: new Date(`${today.slice(0, 4)}-01-05T07:30:00+07:00`), inLocationId: "gedung-a", status: "DEDUCTED", deductedAt: new Date() },
    });
    const me = await request(app).get("/api/leave/me").set("Cookie", rina);
    expect(me.body.balance).toMatchObject({ deducted: 1, remaining: 11 });
  });

  it("lets the owner cancel a pending request, and nobody else", async () => {
    const id = (await create(rina, weekday(3), weekday(3))).body.request.id;
    const other = await sessionCookie("dewi@ista.ac.id");
    expect((await request(app).delete(`/api/leave/${id}`).set("Cookie", other)).status).toBe(409);
    expect((await request(app).delete(`/api/leave/${id}`).set("Cookie", rina)).status).toBe(204);
    expect(await prisma.leaveRequest.count({ where: { id } })).toBe(0);
  });
});

describe("approvals", () => {
  it("are for approvers and admins only", async () => {
    expect((await request(app).get("/api/leave/pending").set("Cookie", rina)).status).toBe(403);
    expect((await request(app).post("/api/leave/x/decision").set("Cookie", rina).send({ approve: true })).status).toBe(403);
    const admin = await sessionCookie("admin@ista.ac.id");
    expect((await request(app).get("/api/leave/pending").set("Cookie", admin)).status).toBe(200);
  });

  it("shows balance and overlaps, rejects need a note, approve moves days to used", async () => {
    const start = weekday(8);
    const created = (await create(rina, start, weekday(9))).body.request;

    const pending = await request(app).get("/api/leave/pending").set("Cookie", approver);
    const item = pending.body.requests.find((r: { id: string }) => r.id === created.id);
    expect(item.balance).toMatchObject({ remaining: 12, pending: created.days });
    expect(Array.isArray(item.overlaps)).toBe(true);

    const decide = (body: object) => request(app).post(`/api/leave/${created.id}/decision`).set("Cookie", approver).send(body);
    expect((await decide({ approve: false })).body.error).toBe("NOTE_REQUIRED");

    const ok = await decide({ approve: true, note: "Semoga lancar" });
    expect(ok.status).toBe(200);
    expect(ok.body.request).toMatchObject({ status: "APPROVED", decidedBy: { id: "a2" }, decisionNote: "Semoga lancar" });
    expect((await decide({ approve: false, note: "terlambat" })).body.error).toBe("NOT_PENDING");

    const me = await request(app).get("/api/leave/me").set("Cookie", rina);
    expect(me.body.balance).toMatchObject({ used: created.days, pending: 0, remaining: 12 - created.days });
  });

  it("re-checks the balance when approving", async () => {
    const created = (await create(rina, weekday(12), weekday(14))).body.request; // 3 days
    await prisma.user.update({ where: { id: RINA }, data: { annualQuota: 2 } });
    const res = await request(app).post(`/api/leave/${created.id}/decision`).set("Cookie", approver).send({ approve: true });
    expect(res.body.error).toBe("INSUFFICIENT_BALANCE");
    // Rejecting is still possible.
    const rej = await request(app).post(`/api/leave/${created.id}/decision`).set("Cookie", approver).send({ approve: false, note: "Sisa cuti tidak cukup" });
    expect(rej.body.request.status).toBe("REJECTED");
  });

  it("won't let an approver decide their own request", async () => {
    await prisma.leaveRequest.deleteMany({ where: { userId: "a2" } });
    const own = (await create(approver, weekday(6), weekday(6))).body.request;
    const res = await request(app).post(`/api/leave/${own.id}/decision`).set("Cookie", approver).send({ approve: true });
    expect(res.body.error).toBe("OWN_REQUEST");
    await prisma.leaveRequest.deleteMany({ where: { userId: "a2" } });
  });
});

describe("admin leave views", () => {
  it("lists all requests and everyone's balances", async () => {
    await create(rina, weekday(4), weekday(4));
    const admin = await sessionCookie("admin@ista.ac.id");
    const list = await request(app).get("/api/admin/leave?status=PENDING").set("Cookie", admin);
    expect(list.body.requests.some((r: { userId: string }) => r.userId === RINA)).toBe(true);
    const bal = await request(app).get("/api/admin/leave-balances").set("Cookie", admin);
    expect(bal.body.balances[RINA]).toMatchObject({ quota: 12, pending: 1 });
    const ov = await request(app).get("/api/admin/overview").set("Cookie", admin);
    expect(ov.body).toHaveProperty("onLeaveToday");
    expect(ov.body.pendingLeave).toBeGreaterThan(0);
  });
});
