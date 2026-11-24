import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { addDays, dateOnly, jakartaDate, jakartaInstant } from "../src/lib/time.js";
import { daysOn, isoWeekday, isScheduled, scheduledDates, type ScheduleHistory } from "../src/services/schedule.js";
import { app, sessionCookie } from "./helpers.js";

const RINA = "u5";
const today = jakartaDate();
let rina: string;
let admin: string;

/** The most recent date before today with this ISO weekday (1 = Mon). */
function lastWeekday(iso: number, before = today) {
  let d = addDays(before, -1);
  while (isoWeekday(d) !== iso) d = addDays(d, -1);
  return d;
}
/** The next date after `after` with this ISO weekday. */
function nextWeekday(iso: number, after = today) {
  let d = addDays(after, 1);
  while (isoWeekday(d) !== iso) d = addDays(d, 1);
  return d;
}

async function reset() {
  await prisma.workSchedule.deleteMany({ where: { userId: RINA } });
  await prisma.attendanceExemption.deleteMany({ where: { userId: RINA } });
  await prisma.leaveRequest.deleteMany({ where: { userId: RINA } });
}

beforeEach(async () => {
  await reset();
  rina ??= await sessionCookie("rina@ista.ac.id");
  admin ??= await sessionCookie("admin@ista.ac.id");
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

const setSchedule = (effectiveFrom: string, days: number[], cookie = admin) =>
  request(app).put(`/api/admin/users/${RINA}/schedules`).set("Cookie", cookie).send({ effectiveFrom, days });

describe("schedule rules", () => {
  const history: ScheduleHistory = [
    { id: "a", from: "2026-01-01", days: [2, 4] }, // Tue + Thu
    { id: "b", from: "2026-08-01", days: [1, 3, 5] }, // Mon + Wed + Fri
  ];
  it("uses Monday–Friday before the first schedule and the newest period after that", () => {
    expect(daysOn(history, "2025-12-31")).toEqual([1, 2, 3, 4, 5]);
    expect(daysOn(history, "2026-03-10")).toEqual([2, 4]);
    expect(daysOn(history, "2026-08-01")).toEqual([1, 3, 5]);
    expect(daysOn(undefined, "2026-03-10")).toEqual([1, 2, 3, 4, 5]);
  });
  it("counts scheduled days and skips holidays", () => {
    // 2026-03-09 is a Monday: the week has Tue 10 + Thu 12 scheduled.
    expect(scheduledDates(history, "2026-03-09", "2026-03-15")).toEqual(["2026-03-10", "2026-03-12"]);
    expect(scheduledDates(history, "2026-03-09", "2026-03-15", new Set(["2026-03-12"]))).toEqual(["2026-03-10"]);
    expect(isScheduled(history, "2026-03-09")).toBe(false);
  });
});

describe("work schedules (admin)", () => {
  it("only admins can set them; the teacher sees the current one and the next change", async () => {
    expect((await setSchedule("2026-01-01", [2, 4], rina)).status).toBe(403);
    const set = await setSchedule(addDays(today, -30), [2, 4]);
    expect(set.status).toBe(200);
    const future = addDays(today, 30);
    const next = await setSchedule(future, [1, 3, 5]);
    expect(next.body.schedule).toMatchObject({ current: { days: [2, 4], isDefault: false }, next: { from: future, days: [1, 3, 5] } });

    const overview = await request(app).get("/api/attendance/me/overview").set("Cookie", rina);
    expect(overview.body.schedule.current.days).toEqual([2, 4]);
    const staff = await request(app).get("/api/admin/users").set("Cookie", admin);
    expect(staff.body.users.find((u: { id: string }) => u.id === RINA).schedule).toMatchObject({ days: [2, 4], isDefault: false });

    const del = await request(app).delete(`/api/admin/users/${RINA}/schedules/${next.body.schedule.next.id}`).set("Cookie", admin);
    expect(del.body.schedule.next).toBeNull();
    expect(await prisma.adminAction.count({ where: { targetUserId: RINA, action: { in: ["SCHEDULE_SET", "SCHEDULE_DELETE"] } } })).toBeGreaterThanOrEqual(3);
  });

  it("leave only costs scheduled days", async () => {
    await setSchedule(addDays(today, -30), [2, 4]);
    const mon = nextWeekday(1, addDays(today, 7));
    const fri = addDays(mon, 4);
    const week = await request(app).post("/api/leave").set("Cookie", rina).send({ start: mon, end: fri, reason: "Keperluan keluarga" });
    expect(week.status).toBe(201);
    expect(week.body.request.days).toBe(2);
    const monday = addDays(mon, 7);
    const off = await request(app).post("/api/leave").set("Cookie", rina).send({ start: monday, end: monday, reason: "Keperluan keluarga" });
    expect(off.body.error).toBe("NO_WORKDAYS");
  });
});

describe("excusing a scheduled day", () => {
  it("removes the absence, shows in the teacher's history, and can be undone", async () => {
    const tue = lastWeekday(2);
    const month = tue.slice(0, 7);
    await setSchedule(`${month}-01`, [2]); // Tuesdays only
    await prisma.attendance.deleteMany({ where: { userId: RINA, date: dateOnly(tue) } });
    const rowFor = async () =>
      (await request(app).get(`/api/admin/reports/monthly?month=${month}`).set("Cookie", admin)).body.rows.find(
        (r: { user: { id: string } }) => r.user.id === RINA,
      );
    const before = await rowFor();

    expect((await request(app).post("/api/admin/exemptions").set("Cookie", rina).send({ userId: RINA, date: tue, reason: "Rapat di luar kampus" })).status).toBe(403);
    const monday = lastWeekday(1);
    const notScheduled = await request(app).post("/api/admin/exemptions").set("Cookie", admin).send({ userId: RINA, date: monday, reason: "Rapat di luar kampus" });
    expect(notScheduled.body.error).toBe("NOT_SCHEDULED");

    const ex = await request(app).post("/api/admin/exemptions").set("Cookie", admin).send({ userId: RINA, date: tue, reason: "Rapat di luar kampus" });
    expect(ex.status).toBe(201);
    const after = await rowFor();
    expect(after.absent).toBe(before.absent - 1);
    expect(after.exempt).toBe(before.exempt + 1);

    const day = await request(app).get(`/api/admin/day?date=${tue}`).set("Cookie", admin);
    expect(day.body.rows.find((r: { user: { id: string } }) => r.user.id === RINA)).toMatchObject({ state: "EXEMPT", scheduled: true });
    const mine = await request(app).get(`/api/attendance/me?month=${month}`).set("Cookie", rina);
    expect(mine.body.exemptions).toContainEqual(expect.objectContaining({ date: tue, reason: "Rapat di luar kampus" }));

    expect((await request(app).post("/api/admin/exemptions").set("Cookie", admin).send({ userId: RINA, date: tue, reason: "Rapat lain lagi" })).body.error).toBe("ALREADY_EXEMPT");
    expect((await request(app).delete(`/api/admin/exemptions/${ex.body.exemption.id}`).set("Cookie", admin)).status).toBe(204);
    expect((await rowFor()).absent).toBe(before.absent);
  });

  it("is refused when the person was present", async () => {
    const tue = lastWeekday(2);
    await setSchedule(`${tue.slice(0, 7)}-01`, [2]);
    const loc = await prisma.location.findFirstOrThrow({ where: { active: true } });
    await prisma.attendance.deleteMany({ where: { userId: RINA, date: dateOnly(tue) } });
    await prisma.attendance.create({ data: { userId: RINA, date: dateOnly(tue), clockIn: jakartaInstant(tue, "09:00"), clockOut: jakartaInstant(tue, "12:00"), inLocationId: loc.id, status: "COMPLETE" } });
    const res = await request(app).post("/api/admin/exemptions").set("Cookie", admin).send({ userId: RINA, date: tue, reason: "Rapat di luar kampus" });
    expect(res.body.error).toBe("HAS_ATTENDANCE");
  });
});

describe("admin attendance corrections", () => {
  const put = (date: string, body: object, cookie = admin) => request(app).put(`/api/admin/attendance/${RINA}/${date}`).set("Cookie", cookie).send(body);

  it("adds, edits and deletes records with a reason, and logs every change", async () => {
    const day = lastWeekday(3);
    await prisma.attendance.deleteMany({ where: { userId: RINA, date: dateOnly(day) } });
    expect((await put(day, { clockIn: "09:00", clockOut: "12:00", reason: "Lupa absen" }, rina)).status).toBe(403);
    expect((await put(day, { clockIn: "09:00", clockOut: "12:00" })).status).toBe(400); // reason required
    expect((await put(day, { clockIn: "12:00", clockOut: "09:00", reason: "Lupa memindai QR" })).body.error).toBe("CLOCK_OUT_BEFORE_IN");
    expect((await put(addDays(today, 1), { clockIn: "09:00", reason: "Lupa memindai QR" })).body.error).toBe("DATE_IN_FUTURE");

    const created = await put(day, { clockIn: "09:00", clockOut: "12:00", reason: "Ponsel rusak, hadir mengajar" });
    expect(created.status).toBe(200);
    expect(created.body.record).toMatchObject({ status: "COMPLETE", inMethod: "MANUAL", outMethod: "MANUAL", edit: { reason: "Ponsel rusak, hadir mengajar" } });
    expect(created.body.record).not.toHaveProperty("late");

    const edited = await put(day, { clockIn: "09:00", clockOut: "15:30", reason: "Koreksi jam pulang" });
    expect(edited.body.record.id).toBe(created.body.record.id);
    expect(edited.body.record.edit.reason).toBe("Koreksi jam pulang");

    const history = await request(app).get(`/api/attendance/me?month=${day.slice(0, 7)}`).set("Cookie", rina);
    expect(history.body.records.find((r: { id: string }) => r.id === created.body.record.id).edit.reason).toBe("Koreksi jam pulang");

    const noReason = await request(app).delete(`/api/admin/attendance/${created.body.record.id}`).set("Cookie", admin).send({});
    expect(noReason.status).toBe(400);
    const del = await request(app).delete(`/api/admin/attendance/${created.body.record.id}`).set("Cookie", admin).send({ reason: "Data ganda" });
    expect(del.status).toBe(204);
    const actions = await prisma.adminAction.findMany({ where: { targetUserId: RINA, date: dateOnly(day) }, orderBy: { createdAt: "asc" } });
    expect(actions.map((a) => a.action)).toEqual(["ATTENDANCE_CREATE", "ATTENDANCE_EDIT", "ATTENDANCE_DELETE"]);
    expect(actions[2].reason).toBe("Data ganda");
  });

  it("restores a deducted leave day when the admin fills in the clock-out", async () => {
    const day = addDays(today, -80);
    const loc = await prisma.location.findFirstOrThrow({ where: { active: true } });
    await prisma.attendance.deleteMany({ where: { userId: RINA, date: dateOnly(day) } });
    await prisma.attendance.create({ data: { userId: RINA, date: dateOnly(day), clockIn: jakartaInstant(day, "08:00"), inLocationId: loc.id, status: "DEDUCTED", deductedAt: new Date() } });
    const year = Number(day.slice(0, 4));
    const before = (await request(app).get("/api/admin/leave-balances").set("Cookie", admin)).body.balances[RINA];
    const res = await put(day, { clockIn: "08:00", clockOut: "14:00", reason: "Bukti hadir dari jadwal mengajar" });
    expect(res.body.record.status).toBe("COMPLETE");
    const after = (await request(app).get("/api/admin/leave-balances").set("Cookie", admin)).body.balances[RINA];
    if (year === Number(today.slice(0, 4))) expect(after.deducted).toBe(before.deducted - 1);
    await prisma.attendance.deleteMany({ where: { userId: RINA, date: dateOnly(day) } });
  });

  it("flags attendance outside the schedule instead of refusing it", async () => {
    const mon = lastWeekday(1);
    await setSchedule(`${mon.slice(0, 7)}-01`, [2, 4]);
    await prisma.attendance.deleteMany({ where: { userId: RINA, date: dateOnly(mon) } });
    await put(mon, { clockIn: "10:00", clockOut: "11:00", reason: "Rapat program studi" });
    const mine = await request(app).get(`/api/attendance/me?month=${mon.slice(0, 7)}`).set("Cookie", rina);
    expect(mine.body.records.find((r: { date: string }) => r.date === mon).scheduled).toBe(false);
    const report = await request(app).get(`/api/admin/reports/monthly?month=${mon.slice(0, 7)}`).set("Cookie", admin);
    expect(report.body.rows.find((r: { user: { id: string } }) => r.user.id === RINA).outsideSchedule).toBeGreaterThanOrEqual(1);
  });

  it("the dashboard counts only people scheduled today", async () => {
    const res = await request(app).get("/api/admin/overview").set("Cookie", admin);
    expect(res.body).toHaveProperty("expectedToday");
    expect(res.body).toHaveProperty("notYetToday");
    expect(res.body).not.toHaveProperty("lateToday");
    expect(res.body.expectedToday).toBeLessThanOrEqual(res.body.activeStaff);
  });
});
