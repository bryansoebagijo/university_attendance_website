/**
 * Development seed. Same people and ids as the frontend's phase-1 sample data,
 * so attendance/leave sample records (still mock until phases 3–4) stay linked.
 * Every account gets the dev password from SEED_PASSWORD (default "demo123").
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient, type AttendanceStatus, type Role } from "@prisma/client";
import { addDays, dateOnly, isWeekend, jakartaDate, jakartaInstant } from "../src/lib/time.js";
import { workdaysBetween } from "../src/services/leave.js";

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? "demo123";

const users: { id: string; name: string; email: string; nip: string; role: Role; unit: string; annualQuota: number; active: boolean }[] = [
  { id: "u1", name: "Dr. Siti Rahmawati, M.T.", email: "siti@ista.ac.id", nip: "1987031201", role: "USER", unit: "Teknik Informatika", annualQuota: 12, active: true },
  { id: "u2", name: "Ahmad Fauzi, M.Kom.", email: "ahmad@ista.ac.id", nip: "1990051402", role: "USER", unit: "Sistem Informasi", annualQuota: 12, active: true },
  { id: "u3", name: "Dewi Lestari, M.Si.", email: "dewi@ista.ac.id", nip: "1985110903", role: "USER", unit: "Biologi", annualQuota: 12, active: true },
  { id: "u4", name: "Budi Santoso, M.T.", email: "budi@ista.ac.id", nip: "1983020704", role: "USER", unit: "Teknik Mesin", annualQuota: 12, active: true },
  { id: "u5", name: "Rina Kartika, M.Pd.", email: "rina@ista.ac.id", nip: "1992080105", role: "USER", unit: "Matematika", annualQuota: 12, active: true },
  { id: "u6", name: "Hendra Wijaya, S.T.", email: "hendra@ista.ac.id", nip: "1995121206", role: "USER", unit: "Teknik Elektro", annualQuota: 12, active: false },
  { id: "a1", name: "Prof. Bambang Hartono", email: "bambang@ista.ac.id", nip: "1970060107", role: "APPROVER", unit: "Wakil Rektor II", annualQuota: 14, active: true },
  { id: "a2", name: "Nur Aini, M.M.", email: "nuraini@ista.ac.id", nip: "1980041508", role: "APPROVER", unit: "Kepala Biro SDM", annualQuota: 12, active: true },
  { id: "ad", name: "Sri Dewanti", email: "admin@ista.ac.id", nip: "1988092309", role: "ADMIN", unit: "Biro SDM", annualQuota: 12, active: true },
];

const locations = [
  { id: "gedung-a", name: "Lobi Gedung A", building: "Gedung Rektorat", active: true },
  { id: "gedung-b", name: "Ruang Dosen Gedung B", building: "Gedung Fakultas Teknik", active: true },
  { id: "lab-c", name: "Laboratorium Terpadu", building: "Gedung C", active: false },
];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { ...u },
      create: { ...u, passwordHash },
    });
  }
  for (const l of locations) {
    await prisma.location.upsert({
      where: { id: l.id },
      update: { name: l.name, building: l.building, active: l.active },
      create: { ...l, qrSecret: randomBytes(32).toString("hex") },
    });
  }
  const holidays = await seedHolidays();
  const attendance = await seedAttendance();
  const leave = await seedLeave();
  console.log(`Seeded ${users.length} users, ${locations.length} locations, ${attendance} attendance records, ${leave} leave requests, ${holidays} holidays.`);
}

/** Deterministic PRNG so the sample looks the same on every reseed. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/**
 * ~75 working days of sample history relative to today, plus a scripted story for the demo
 * lecturer (u1): two open missing clock-outs, one fixed, one old enough to be deducted by the job.
 * Skipped when the table already has rows, so real data is never touched.
 */
async function seedAttendance() {
  if ((await prisma.attendance.count()) > 0) return 0;
  const today = jakartaDate();
  const hourNow = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hour12: false }).format(new Date()));
  const rand = rng(42);
  const rows: {
    userId: string; date: string; inMin: number; outMin: number | null; loc: string; status: AttendanceStatus; fixReason?: string;
  }[] = [];
  const onLeave = (userId: string, date: string) => userId === "u4" && date >= addDays(today, -1) && date <= addDays(today, 2);

  for (const u of users.filter((x) => x.active)) {
    for (let back = 75; back >= 1; back--) {
      const date = addDays(today, -back);
      if (isWeekend(date) || onLeave(u.id, date) || rand() < 0.04) continue;
      const inMin = 7 * 60 + 10 + Math.floor(rand() * 75);
      const outMin = 15 * 60 + 30 + Math.floor(rand() * 120);
      const loc = rand() < 0.7 ? "gedung-a" : "gedung-b";
      const missing = u.id !== "u1" && rand() < 0.025;
      rows.push({ userId: u.id, date, inMin, outMin: missing ? null : outMin, loc, status: missing ? "MISSING_CLOCK_OUT" : "COMPLETE" });
    }
  }
  const u1 = (daysBack: number) => {
    let d = addDays(today, -daysBack);
    while (isWeekend(d)) d = addDays(d, -1);
    return rows.find((r) => r.userId === "u1" && r.date === d);
  };
  for (const back of [6, 45, 68]) {
    const r = u1(back);
    if (r) Object.assign(r, { outMin: null, status: "MISSING_CLOCK_OUT" });
  }
  const fixed = u1(20);
  if (fixed) Object.assign(fixed, { outMin: 16 * 60 + 45, status: "FIXED", fixReason: "Lupa memindai karena rapat program studi sampai sore." });

  if (!isWeekend(today) && hourNow >= 7) {
    for (const u of users.filter((x) => x.active && x.id !== "u1" && !onLeave(x.id, today))) {
      if (rand() < 0.15) continue;
      const inMin = 7 * 60 + 5 + Math.floor(rand() * 80);
      const done = hourNow >= 17 && rand() < 0.6;
      rows.push({ userId: u.id, date: today, inMin, outMin: done ? 16 * 60 + Math.floor(rand() * 60) : null, loc: "gedung-a", status: done ? "COMPLETE" : "CLOCKED_IN" });
    }
  }

  await prisma.attendance.createMany({
    data: rows.map((r) => ({
      userId: r.userId,
      date: dateOnly(r.date),
      clockIn: jakartaInstant(r.date, hhmm(r.inMin)),
      clockOut: r.outMin === null ? null : jakartaInstant(r.date, hhmm(r.outMin)),
      inLocationId: r.loc,
      outLocationId: r.outMin === null || r.status === "FIXED" ? null : r.loc,
      status: r.status,
      fixReason: r.fixReason,
      fixedAt: r.status === "FIXED" ? jakartaInstant(addDays(r.date, 2), "09:10") : null,
    })),
  });
  return rows.length;
}

/**
 * Indonesian national holidays with a FIXED date, for this year and next.
 * Moveable ones (Idul Fitri, Idul Adha, Nyepi, Waisak, Imlek, Isra Mi'raj, …) change every year
 * and must be added by an admin from the official SKB 3 Menteri list.
 */
async function seedHolidays() {
  const year = Number(jakartaDate().slice(0, 4));
  const fixed = [
    ["01-01", "Tahun Baru Masehi"],
    ["05-01", "Hari Buruh Internasional"],
    ["06-01", "Hari Lahir Pancasila"],
    ["08-17", "Hari Kemerdekaan Republik Indonesia"],
    ["12-25", "Hari Raya Natal"],
  ];
  let n = 0;
  for (const y of [year, year + 1]) {
    for (const [md, name] of fixed) {
      const date = dateOnly(`${y}-${md}`);
      await prisma.holiday.upsert({ where: { date }, create: { date, name }, update: {} });
      n++;
    }
  }
  return n;
}

const minDate = (a: string, b: string) => (a < b ? a : b);

/** Sample leave requests around today (same story as the phase-1 UI). Skipped if any exist. */
async function seedLeave() {
  if ((await prisma.leaveRequest.count()) > 0) return 0;
  const today = jakartaDate();
  const d = (n: number) => addDays(today, n);
  const items: { userId: string; start: string; end: string; reason: string; status: "PENDING" | "APPROVED" | "REJECTED"; by?: string; note?: string }[] = [
    { userId: "u1", start: d(-40), end: d(-39), reason: "Menghadiri pernikahan saudara di Bandung.", status: "APPROVED", by: "a1" },
    { userId: "u1", start: d(14), end: d(16), reason: "Mendampingi orang tua kontrol kesehatan.", status: "PENDING" },
    { userId: "u1", start: d(-25), end: d(-25), reason: "Urusan keluarga.", status: "REJECTED", by: "a2", note: "Bertepatan dengan ujian tengah semester. Mohon ajukan tanggal lain." },
    { userId: "u2", start: d(7), end: d(11), reason: "Liburan keluarga akhir tahun.", status: "PENDING" },
    { userId: "u3", start: d(15), end: d(15), reason: "Mengurus dokumen kependudukan.", status: "PENDING" },
    { userId: "u4", start: d(-1), end: d(2), reason: "Pemulihan pascaoperasi ringan.", status: "APPROVED", by: "a2" },
    { userId: "u5", start: d(-15), end: d(-14), reason: "Acara wisuda adik.", status: "APPROVED", by: "a1" },
  ];
  // Keep only items with working days that stay inside one year (the API's own rules).
  const valid = items
    .map((i) => ({ ...i, days: workdaysBetween(i.start, i.end) }))
    .filter((i) => i.days > 0 && i.start.slice(0, 4) === i.end.slice(0, 4));
  await prisma.leaveRequest.createMany({
    data: valid.map((i) => ({
      userId: i.userId,
      startDate: dateOnly(i.start),
      endDate: dateOnly(i.end),
      days: i.days,
      reason: i.reason,
      status: i.status,
      // Submitted 10 days before the start, but never in the future; decided 2 days later (also not in the future).
      createdAt: jakartaInstant(minDate(addDays(i.start, -10), addDays(today, -3)), "10:15"),
      decidedById: i.by ?? null,
      decidedAt: i.by ? jakartaInstant(minDate(addDays(i.start, -8), addDays(today, -1)), "13:30") : null,
      decisionNote: i.note ?? null,
    })),
  });
  return valid.length;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
