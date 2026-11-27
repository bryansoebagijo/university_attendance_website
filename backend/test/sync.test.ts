import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { checkSchemaVersion, REQUIRED_SCHEMA_VERSION } from "../src/lib/schema-version.js";
import { assertSelectQuery, normalizeRow, runTeacherSync } from "../src/services/teacher-sync.js";
import { app, sessionCookie } from "./helpers.js";

/**
 * A stand-in for the client's existing teacher table (same SQL works on PostgreSQL and MySQL).
 * The real one lives in another database on the client's MySQL server.
 */
const QUERY = "SELECT id AS externalId, nip, nama AS name, email, unit, aktif AS active FROM ext_guru";
const AHMAD_NIP = "1990051402"; // seeded account (u2) that the sync should link, not duplicate

async function setSource(rows: [string, string, string, string | null, string, number][]) {
  await prisma.$executeRawUnsafe("DELETE FROM ext_guru");
  // PostgreSQL uses $1… placeholders, MySQL uses ?.
  const mysql = (process.env.DATABASE_URL ?? "").startsWith("mysql");
  const values = mysql ? "?, ?, ?, ?, ?, ?" : "$1, $2, $3, $4, $5, $6";
  for (const r of rows) await prisma.$executeRawUnsafe(`INSERT INTO ext_guru (id, nip, nama, email, unit, aktif) VALUES (${values})`, ...r);
}

let admin: string;

beforeAll(async () => {
  await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS ext_guru");
  await prisma.$executeRawUnsafe(
    "CREATE TABLE ext_guru (id VARCHAR(20) PRIMARY KEY, nip VARCHAR(40), nama VARCHAR(120), email VARCHAR(200), unit VARCHAR(120), aktif SMALLINT)",
  );
  admin = await sessionCookie("admin@ista.ac.id");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { externalId: { startsWith: "G-" }, NOT: { nip: AHMAD_NIP } } });
  await prisma.user.update({ where: { nip: AHMAD_NIP }, data: { externalId: null, active: true, name: "Ahmad Fauzi, M.Kom.", unit: "Sistem Informasi" } });
  await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS ext_guru");
  await prisma.$disconnect();
});

describe("reading source rows", () => {
  it("maps columns case-insensitively and understands many ways of saying inactive", () => {
    expect(normalizeRow({ EXTERNALID: 7, NIP: " 123 ", Name: "Budi  Hartono", email: "BUDI@x.id", unit: null, active: 1 })).toEqual({
      externalId: "7",
      nip: "123",
      name: "Budi Hartono",
      email: "budi@x.id",
      unit: "",
      active: true,
      photoHash: null,
    });
    for (const off of [0, "0", "tidak", "Nonaktif", false, "N"]) expect((normalizeRow({ externalid: 1, nip: "1", name: "A", active: off }) as { active: boolean }).active).toBe(false);
    expect((normalizeRow({ externalid: 1, nip: "1", name: "A" }) as { active: boolean }).active).toBe(true);
    expect((normalizeRow({ externalid: 1, nip: "1", name: "A", email: "not-an-email" }) as { email: string | null }).email).toBeNull();
    expect(normalizeRow({ externalid: 1, name: "A" })).toMatchObject({ error: "MISSING_NIP" });
  });

  it("only runs plain SELECT statements", () => {
    expect(() => assertSelectQuery("DELETE FROM guru")).toThrow();
    expect(() => assertSelectQuery("SELECT 1; DROP TABLE x")).toThrow();
    expect(assertSelectQuery("select * from guru;")).toBe("select * from guru");
  });

  it("the test database has the required script version", async () => {
    expect(await checkSchemaVersion()).toBeGreaterThanOrEqual(REQUIRED_SCHEMA_VERSION);
  });
});

describe("teacher sync", () => {
  it("imports new teachers without a password, links an existing account by NIP, and never touches app-owned fields", async () => {
    await prisma.user.update({ where: { nip: AHMAD_NIP }, data: { role: "APPROVER", annualQuota: 15 } });
    await setSource([
      ["G-1", AHMAD_NIP, "Ahmad Fauzi, M.Kom., Ph.D.", "ahmad@ista.ac.id", "Sistem Informasi", 1],
      ["G-2", "2001010101", "Lina Marlina, M.Pd.", null, "Pendidikan Matematika", 1],
      ["G-3", "2001010102", "Yusuf Ramli, M.T.", "yusuf@ista.ac.id", "Teknik Sipil", 1],
    ]);
    const run = await runTeacherSync({ trigger: "MANUAL", query: QUERY });
    expect(run).toMatchObject({ status: "OK", sourceRows: 3, added: 2, updated: 1, deactivated: 0 });

    const ahmad = await prisma.user.findUniqueOrThrow({ where: { nip: AHMAD_NIP } });
    expect(ahmad).toMatchObject({ externalId: "G-1", name: "Ahmad Fauzi, M.Kom., Ph.D.", role: "APPROVER", annualQuota: 15 });
    const lina = await prisma.user.findUniqueOrThrow({ where: { nip: "2001010101" } });
    expect(lina).toMatchObject({ email: null, role: "USER", passwordHash: "", mustChangePassword: true, active: true });

    // No password yet → cannot log in, even with an empty password.
    const tryLogin = await request(app).post("/api/auth/login").send({ login: "2001010101", password: "x" });
    expect(tryLogin.status).toBe(401);
    await prisma.user.update({ where: { nip: AHMAD_NIP }, data: { role: "USER", annualQuota: 12 } });
  });

  it("issues one-time passwords in bulk; teachers log in with their NIP", async () => {
    const status = await request(app).get("/api/admin/sync").set("Cookie", admin);
    expect(status.body.needPassword).toBeGreaterThanOrEqual(2);
    const res = await request(app).post("/api/admin/sync/passwords").set("Cookie", admin);
    expect(res.status).toBe(200);
    const lina = res.body.accounts.find((a: { nip: string }) => a.nip === "2001010101");
    expect(lina.tempPassword).toMatch(/^[A-Za-z0-9]{10}$/);

    const login = await request(app).post("/api/auth/login").send({ login: "2001010101", password: lina.tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ nip: "2001010101", email: null, mustChangePassword: true, externalId: "G-2" });
    expect((await request(app).post("/api/admin/sync/passwords").set("Cookie", admin)).body.accounts).toEqual([]);
  });

  it("follows changes: renamed, switched off, removed (deactivated, never deleted)", async () => {
    await setSource([
      ["G-1", AHMAD_NIP, "Ahmad Fauzi, M.Kom., Ph.D.", "ahmad@ista.ac.id", "Sistem Informasi", 1],
      ["G-2", "2001010101", "Lina Marlina, M.Pd.", "lina@ista.ac.id", "Pendidikan Matematika", 0],
    ]);
    const run = await runTeacherSync({ trigger: "MANUAL", query: QUERY, force: true });
    expect(run).toMatchObject({ status: "OK", deactivated: 2, added: 0 });
    expect(await prisma.user.findUniqueOrThrow({ where: { nip: "2001010102" } })).toMatchObject({ active: false });
    expect(await prisma.user.findUniqueOrThrow({ where: { nip: "2001010101" } })).toMatchObject({ active: false, email: "lina@ista.ac.id" });

    await setSource([
      ["G-1", AHMAD_NIP, "Ahmad Fauzi, M.Kom., Ph.D.", "ahmad@ista.ac.id", "Sistem Informasi", 1],
      ["G-2", "2001010101", "Lina Marlina, M.Pd.", "lina@ista.ac.id", "Pendidikan Matematika", 1],
      ["G-3", "2001010102", "Yusuf Ramli, M.T.", "yusuf@ista.ac.id", "Teknik Sipil", 1],
    ]);
    expect(await runTeacherSync({ trigger: "MANUAL", query: QUERY })).toMatchObject({ status: "OK", reactivated: 2 });
  });

  it("stops instead of switching off most staff when the source looks wrong", async () => {
    await setSource([["G-9", "2009090909", "Orang Baru", null, "", 1]]);
    const stopped = await runTeacherSync({ trigger: "MANUAL", query: QUERY });
    expect(stopped.status).toBe("ABORTED");
    expect(await prisma.user.findUniqueOrThrow({ where: { nip: AHMAD_NIP } })).toMatchObject({ active: true });

    await prisma.$executeRawUnsafe("DELETE FROM ext_guru");
    expect((await runTeacherSync({ trigger: "MANUAL", query: QUERY })).status).toBe("ABORTED"); // empty source
  });

  it("reports bad rows instead of failing the run", async () => {
    await setSource([
      ["G-1", AHMAD_NIP, "Ahmad Fauzi, M.Kom., Ph.D.", "ahmad@ista.ac.id", "Sistem Informasi", 1],
      ["G-2", "2001010101", "Lina Marlina, M.Pd.", "lina@ista.ac.id", "Pendidikan Matematika", 1],
      ["G-3", "2001010102", "Yusuf Ramli, M.T.", "yusuf@ista.ac.id", "Teknik Sipil", 1],
      ["G-4", "1987031201", "Siti dari sistem lama", null, "", 1], // NIP of a hand-made account → linked, not duplicated
      ["G-5", AHMAD_NIP, "Duplikat", null, "", 1],
      ["G-6", "", "Tanpa NIP", null, "", 1],
    ]);
    const run = await runTeacherSync({ trigger: "MANUAL", query: QUERY });
    expect(run.status).toBe("OK");
    expect(run.problems.map((p) => p.error).sort()).toEqual(["DUPLICATE_NIP", "MISSING_NIP"]);
    // Siti's hand-made account got linked rather than duplicated; unlink again for other tests.
    await prisma.user.update({ where: { nip: "1987031201" }, data: { externalId: null, name: "Dr. Siti Rahmawati, M.T.", email: "siti@ista.ac.id", unit: "Teknik Informatika" } });
  });

  it("synced fields can't be edited in the app; app-owned ones can", async () => {
    const lina = await prisma.user.findUniqueOrThrow({ where: { nip: "2001010101" } });
    const rename = await request(app).patch(`/api/admin/users/${lina.id}`).set("Cookie", admin).send({ name: "Nama Lain" });
    expect(rename.body.error).toBe("SYNCED_FIELD");
    const quota = await request(app).patch(`/api/admin/users/${lina.id}`).set("Cookie", admin).send({ annualQuota: 14, name: lina.name });
    expect(quota.status).toBe(200);
    expect(quota.body.user.annualQuota).toBe(14);
  });

  it("is admin-only and explains when it isn't configured", async () => {
    const teacher = await sessionCookie("rina@ista.ac.id");
    expect((await request(app).post("/api/admin/sync").set("Cookie", teacher)).status).toBe(403);
    const res = await request(app).post("/api/admin/sync").set("Cookie", admin).send({});
    expect(res.body.error).toBe("SYNC_NOT_CONFIGURED");
    const status = await request(app).get("/api/admin/sync").set("Cookie", admin);
    expect(status.body).toMatchObject({ configured: false });
    expect(status.body.runs.length).toBeGreaterThan(0);
  });
});

describe("login", () => {
  it("accepts an email or a NIP", async () => {
    const byNip = await request(app).post("/api/auth/login").send({ login: "1992080105", password: process.env.SEED_PASSWORD ?? "demo123" });
    expect(byNip.status).toBe(200);
    expect(byNip.body.user.email).toBe("rina@ista.ac.id");
    const old = await request(app).post("/api/auth/login").send({ email: "rina@ista.ac.id", password: process.env.SEED_PASSWORD ?? "demo123" });
    expect(old.status).toBe(200);
  });
});
