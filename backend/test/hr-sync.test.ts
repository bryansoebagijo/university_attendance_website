import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { runTeacherSync, type SyncSource } from "../src/services/teacher-sync.js";

/**
 * The HR source as the offline release uses it: its own connection (here a stand-in object) returning
 * hr_staff_info rows plus photos. Covers the photo import and an unreachable HR database.
 */
const IDS = ["H-1", "H-2", "H-3", "H-4"];
let jpeg: Buffer;
let png: Buffer;
const bmp = Buffer.concat([Buffer.from("BM"), Buffer.alloc(60, 1)]); // what some fingerprint software stores

beforeAll(async () => {
  jpeg = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#2f7b46" } }).jpeg().toBuffer();
  png = await sharp({ create: { width: 300, height: 300, channels: 4, background: "#d8b757" } }).png().toBuffer();
  await cleanup();
});
afterEach(() => {
  config.HR_PHOTO_IMPORT = true;
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
async function cleanup() {
  await prisma.user.deleteMany({ where: { externalId: { in: IDS } } });
}

function hrSource(rows: Record<string, unknown>[], photos: Record<string, Buffer | null>, calls: string[] = []): SyncSource {
  return {
    describe: "HR database test:3306",
    rows: async () => rows,
    photo: async (id) => {
      calls.push(id);
      return photos[id] ?? null;
    },
    close: async () => {},
  };
}
const row = (id: string, nip: string, name: string, photoHash: string | null, active = 1) => ({ externalId: id, nip, name, unit: "Dosen Tetap", active, photoHash });

describe("HR sync with photos", () => {
  it("imports staff and their JPEG/PNG photos; reports a BMP photo instead of failing", async () => {
    const rows = [row("H-1", "HR-0001", "Ani Jpeg", "hash-a"), row("H-2", "HR-0002", "Budi Png", "hash-b"), row("H-3", "HR-0003", "Cici Bmp", "hash-c"), row("H-4", "HR-0004", "Dedi Tanpa Foto", null)];
    const run = await runTeacherSync({ trigger: "MANUAL", source: hrSource(rows, { "H-1": jpeg, "H-2": png, "H-3": bmp }) });
    expect(run).toMatchObject({ status: "OK", added: 4, photos: 2 });
    expect(run.problems).toEqual([{ externalId: "H-3", nip: "HR-0003", error: "PHOTO_FORMAT_BMP" }]);

    const ani = await prisma.user.findUniqueOrThrow({ where: { externalId: "H-1" }, include: { photo: true } });
    expect(ani.photo).toMatchObject({ source: "HR", sourceHash: "hash-a", mimeType: "image/jpeg" });
    const meta = await sharp(Buffer.from(ani.photo!.data)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 320, 320]); // squared + shrunk like uploads
    expect((await prisma.user.findUniqueOrThrow({ where: { externalId: "H-4" }, include: { photo: true } })).photo).toBeNull();
  });

  it("doesn't fetch unchanged photos again, and replaces an HR photo when HR changes it", async () => {
    const calls: string[] = [];
    const rows = [row("H-1", "HR-0001", "Ani Jpeg", "hash-a"), row("H-2", "HR-0002", "Budi Png", "hash-b2")];
    const run = await runTeacherSync({ trigger: "MANUAL", source: hrSource(rows, { "H-1": jpeg, "H-2": jpeg }, calls), force: true });
    expect(calls).toEqual(["H-2"]); // H-1 unchanged → not read again
    expect(run.photos).toBe(1);
    const budi = await prisma.user.findUniqueOrThrow({ where: { externalId: "H-2" }, include: { photo: true } });
    expect(budi.photo).toMatchObject({ source: "HR", sourceHash: "hash-b2" });
  });

  it("never replaces a photo the person uploaded themselves", async () => {
    const ani = await prisma.user.findUniqueOrThrow({ where: { externalId: "H-1" } });
    await prisma.userPhoto.update({ where: { userId: ani.id }, data: { source: "UPLOAD", sourceHash: null } });
    const calls: string[] = [];
    await runTeacherSync({ trigger: "MANUAL", source: hrSource([row("H-1", "HR-0001", "Ani Jpeg", "hash-new")], { "H-1": png }, calls), force: true });
    expect(calls).toEqual([]);
    expect((await prisma.userPhoto.findUniqueOrThrow({ where: { userId: ani.id } })).source).toBe("UPLOAD");
  });

  it("can be switched off (HR_PHOTO_IMPORT=false)", async () => {
    config.HR_PHOTO_IMPORT = false;
    const calls: string[] = [];
    const run = await runTeacherSync({ trigger: "MANUAL", source: hrSource([row("H-4", "HR-0004", "Dedi Tanpa Foto", "hash-d")], { "H-4": jpeg }, calls), force: true });
    expect(calls).toEqual([]);
    expect(run.photos).toBe(0);
  });
});

describe("HR database unreachable", () => {
  it("records the error and changes nothing", async () => {
    const before = await prisma.user.count();
    const broken: SyncSource = {
      describe: "HR database 10.0.0.99:3306",
      rows: async () => {
        throw new Error("connect ETIMEDOUT");
      },
      close: async () => {},
    };
    const run = await runTeacherSync({ trigger: "STARTUP", source: broken });
    expect(run.status).toBe("ERROR");
    expect(run.message).toContain("HR database 10.0.0.99:3306");
    expect(run.message).toContain("ETIMEDOUT");
    expect(await prisma.user.count()).toBe(before);
  });

  it("explains a real connection failure (no server listening)", async () => {
    const saved = { host: config.HR_DB_HOST, port: config.HR_DB_PORT, q: config.TEACHER_SOURCE_QUERY };
    Object.assign(config, { HR_DB_HOST: "127.0.0.1", HR_DB_PORT: 1, TEACHER_SOURCE_QUERY: "" });
    try {
      const run = await runTeacherSync({ trigger: "MANUAL" });
      expect(run.status).toBe("ERROR");
      expect(run.message).toMatch(/Cannot connect to the HR database at 127\.0\.0\.1:1/);
    } finally {
      Object.assign(config, { HR_DB_HOST: saved.host, HR_DB_PORT: saved.port, TEACHER_SOURCE_QUERY: saved.q });
    }
  });
});
