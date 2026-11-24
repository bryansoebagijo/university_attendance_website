import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { addDays, dateOnly, isWeekend, jakartaDate } from "../src/lib/time.js";
import { app, sessionCookie } from "./helpers.js";

afterAll(() => prisma.$disconnect());

const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
const login = (email: string, password: string) => request(app).post("/api/auth/login").send({ email, password });

let admin: string;
beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: "@test.ista.ac.id" } } });
  admin = await sessionCookie("admin@ista.ac.id");
});

describe("staff management", () => {
  it("is admin-only", async () => {
    const teacher = await sessionCookie("siti@ista.ac.id");
    expect((await request(app).get("/api/admin/users").set("Cookie", teacher)).status).toBe(403);
    expect((await request(app).post("/api/admin/users").set("Cookie", teacher).send({})).status).toBe(403);
  });

  it("lists staff with their leave balance", async () => {
    const res = await request(app).get("/api/admin/users?q=siti").set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body.users[0]).toMatchObject({ id: "u1", balance: { quota: 12 } });
    expect(res.body.users[0].passwordHash).toBeUndefined();
  });

  it("creates an account with a one-time password the user must change", async () => {
    const created = await request(app)
      .post("/api/admin/users")
      .set("Cookie", admin)
      .send({ name: "Tari Wulandari, M.Sc.", email: "Tari@test.ista.ac.id", nip: "T-0001", unit: "Fisika", annualQuota: 14 });
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ email: "tari@test.ista.ac.id", role: "USER", mustChangePassword: true, annualQuota: 14 });
    const temp = created.body.tempPassword as string;
    expect(temp).toMatch(/^[A-Za-z0-9]{10}$/);

    // Duplicates are refused with a clear code.
    const dupEmail = await request(app).post("/api/admin/users").set("Cookie", admin).send({ name: "Lain", email: "tari@test.ista.ac.id", nip: "T-0002" });
    expect(dupEmail.body.error).toBe("EMAIL_TAKEN");
    const dupNip = await request(app).post("/api/admin/users").set("Cookie", admin).send({ name: "Lain", email: "lain@test.ista.ac.id", nip: "T-0001" });
    expect(dupNip.body.error).toBe("NIP_TAKEN");

    // First login: only the "me" routes work until the password is changed.
    const first = await login("tari@test.ista.ac.id", temp);
    expect(first.body.user.mustChangePassword).toBe(true);
    const c1 = cookieOf(first);
    expect((await request(app).get("/api/me").set("Cookie", c1)).status).toBe(200);
    const blocked = await request(app).get("/api/attendance/me/overview").set("Cookie", c1);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("PASSWORD_CHANGE_REQUIRED");

    const change = (cookie: string, currentPassword: string, newPassword: string) =>
      request(app).put("/api/me/password").set("Cookie", cookie).send({ currentPassword, newPassword });
    expect((await change(c1, "wrong", "Rahasia123")).body.error).toBe("WRONG_PASSWORD");
    expect((await change(c1, temp, "short1")).status).toBe(400);
    expect((await change(c1, temp, "onlyletters")).status).toBe(400);
    const ok = await change(c1, temp, "Rahasia123");
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);

    // The response carries a fresh session; the old one is revoked.
    const c2 = cookieOf(ok);
    expect((await request(app).get("/api/attendance/me/overview").set("Cookie", c2)).status).toBe(200);
    expect((await request(app).get("/api/me").set("Cookie", c1)).status).toBe(401);
    expect((await login("tari@test.ista.ac.id", temp)).status).toBe(401);
    expect((await login("tari@test.ista.ac.id", "Rahasia123")).status).toBe(200);
  });

  it("edits staff, and deactivating ends their sessions", async () => {
    const created = await request(app).post("/api/admin/users").set("Cookie", admin).send({ name: "Yoga Pratama", email: "yoga@test.ista.ac.id", nip: "T-0003" });
    const id = created.body.user.id;
    const c = cookieOf(await login("yoga@test.ista.ac.id", created.body.tempPassword));

    const edit = await request(app).patch(`/api/admin/users/${id}`).set("Cookie", admin).send({ role: "APPROVER", unit: "Kimia", annualQuota: 10 });
    expect(edit.body.user).toMatchObject({ role: "APPROVER", unit: "Kimia", annualQuota: 10 });

    await request(app).patch(`/api/admin/users/${id}`).set("Cookie", admin).send({ active: false });
    expect((await request(app).get("/api/me").set("Cookie", c)).status).toBe(401);
  });

  it("resets a password: old sessions end, the one-time password works", async () => {
    const created = await request(app).post("/api/admin/users").set("Cookie", admin).send({ name: "Wawan Setiawan", email: "wawan@test.ista.ac.id", nip: "T-0004" });
    const id = created.body.user.id;
    const c = cookieOf(await login("wawan@test.ista.ac.id", created.body.tempPassword));
    const reset = await request(app).post(`/api/admin/users/${id}/reset-password`).set("Cookie", admin);
    expect(reset.status).toBe(200);
    expect((await request(app).get("/api/me").set("Cookie", c)).status).toBe(401);
    expect((await login("wawan@test.ista.ac.id", reset.body.tempPassword)).body.user.mustChangePassword).toBe(true);
  });

  it("won't let admins change their own role, deactivate or reset themselves", async () => {
    const patch = (body: object) => request(app).patch("/api/admin/users/ad").set("Cookie", admin).send(body);
    expect((await patch({ role: "USER" })).body.error).toBe("SELF_CHANGE");
    expect((await patch({ active: false })).body.error).toBe("SELF_CHANGE");
    expect((await request(app).post("/api/admin/users/ad/reset-password").set("Cookie", admin)).body.error).toBe("SELF_CHANGE");
    // Other fields are fine.
    expect((await patch({ unit: "Biro SDM" })).status).toBe(200);
  });
});

describe("deleting staff", () => {
  it("deletes an account with no history, refuses one with history, never yourself", async () => {
    const created = await request(app).post("/api/admin/users").set("Cookie", admin).send({ name: "Salah Input", email: "salah@test.ista.ac.id", nip: "T-0099" });
    const id = created.body.user.id;
    expect((await request(app).delete(`/api/admin/users/${id}`).set("Cookie", admin)).status).toBe(204);
    expect(await prisma.user.count({ where: { id } })).toBe(0);
    expect((await request(app).delete(`/api/admin/users/${id}`).set("Cookie", admin)).status).toBe(404);

    const withHistory = await request(app).delete("/api/admin/users/u1").set("Cookie", admin);
    expect(withHistory.status).toBe(409);
    expect(withHistory.body.error).toBe("HAS_HISTORY");
    expect(withHistory.body.attendance).toBeGreaterThan(0);
    expect(await prisma.user.count({ where: { id: "u1" } })).toBe(1);

    expect((await request(app).delete("/api/admin/users/ad").set("Cookie", admin)).body.error).toBe("SELF_CHANGE");
    const teacher = await sessionCookie("siti@ista.ac.id");
    expect((await request(app).delete("/api/admin/users/u2").set("Cookie", teacher)).status).toBe(403);
  });
});

describe("holidays", () => {
  /** A weekday at least a week ahead, so it isn't today or in the past. */
  function futureWeekday() {
    let d = addDays(jakartaDate(), 8);
    while (isWeekend(d)) d = addDays(d, 1);
    return d;
  }

  it("are managed by admins, visible to everyone, and skipped when counting leave days", async () => {
    const day = futureWeekday();
    const teacher = await sessionCookie("ahmad@ista.ac.id"); // Mon–Fri default schedule
    expect((await request(app).put(`/api/admin/holidays/${day}`).set("Cookie", teacher).send({ name: "x" })).status).toBe(403);

    const put = await request(app).put(`/api/admin/holidays/${day}`).set("Cookie", admin).send({ name: "Libur kampus" });
    expect(put.body.holiday).toEqual({ date: day, name: "Libur kampus" });
    const list = await request(app).get(`/api/holidays?year=${day.slice(0, 4)}`).set("Cookie", teacher);
    expect(list.body.holidays).toContainEqual({ date: day, name: "Libur kampus" });

    // A one-day request on the holiday has no working days.
    await prisma.leaveRequest.deleteMany({ where: { userId: "u2" } });
    const leave = await request(app).post("/api/leave").set("Cookie", teacher).send({ start: day, end: day, reason: "Tes hari libur" });
    expect(leave.body.error).toBe("NO_WORKDAYS");

    expect((await request(app).delete(`/api/admin/holidays/${day}`).set("Cookie", admin)).status).toBe(204);
    const again = await request(app).post("/api/leave").set("Cookie", teacher).send({ start: day, end: day, reason: "Tes hari libur" });
    expect(again.body.request.days).toBe(1);
    await prisma.leaveRequest.deleteMany({ where: { userId: "u2" } });
  });
});

describe("monthly report", () => {
  it("summarises each active person's month", async () => {
    const month = jakartaDate().slice(0, 7);
    const res = await request(app).get(`/api/admin/reports/monthly?month=${month}`).set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body.month).toBe(month);
    expect(res.body.workdays).toBeGreaterThan(0);
    const row = res.body.rows.find((r: { user: { id: string } }) => r.user.id === "u2");
    const present = await prisma.attendance.count({
      where: { userId: "u2", date: { gte: dateOnly(`${month}-01`), lte: dateOnly(jakartaDate()) } },
    });
    expect(row.present).toBe(present);
    expect(row).not.toHaveProperty("late"); // no lateness rule: lecturers come when they teach
    expect(row).toHaveProperty("scheduled");
    expect(row).toHaveProperty("exempt");
    expect(row).toHaveProperty("absent");
    expect(res.body.rows.some((r: { user: { id: string } }) => r.user.id === "u6")).toBe(false); // inactive
  });
});
