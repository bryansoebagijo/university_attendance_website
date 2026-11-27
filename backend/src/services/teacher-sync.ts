import { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { HttpError } from "../lib/http.js";
import mysql from "mysql2/promise";
import { hashPassword, temporaryPassword } from "../lib/password.js";
import { sniffImage, toProfileJpeg } from "../lib/photo.js";

/**
 * Teacher sync: reads the client's existing teacher table (read-only, via TEACHER_SOURCE_QUERY) and keeps
 * this app's User rows in line with it.
 *
 * Owned by the source (overwritten on every run): name, NIP, unit, email, active.
 * Owned by this app (never touched by the sync): role, leave quota, password, photo, language, theme, schedule.
 * Accounts without externalId (created by hand in this app) are left alone.
 */

export interface SourceTeacher {
  externalId: string;
  nip: string;
  name: string;
  email: string | null;
  unit: string;
  active: boolean;
  /** Fingerprint of the HR photo (e.g. MD5(PHOTO)); null = no photo. */
  photoHash: string | null;
}

export interface SyncProblem {
  externalId?: string;
  nip?: string;
  error: string;
}

export interface SyncSummary {
  id: string;
  status: "OK" | "ERROR" | "ABORTED";
  trigger: string;
  sourceRows: number;
  added: number;
  updated: number;
  deactivated: number;
  reactivated: number;
  skipped: number;
  photos: number;
  message: string | null;
  problems: SyncProblem[];
  startedAt: string;
  finishedAt: string;
}

const FALSE_WORDS = new Set(["0", "false", "f", "n", "no", "tidak", "nonaktif", "non-aktif", "inactive", "keluar", "off"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Buffer.isBuffer(v)) return v.toString("utf8").trim();
  return String(v).trim();
};

/** Column names are matched case-insensitively (PostgreSQL lowercases unquoted aliases). */
export function normalizeRow(raw: Record<string, unknown>): SourceTeacher | SyncProblem {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) row[k.toLowerCase()] = v;
  const externalId = text(row.externalid).slice(0, 100);
  const nip = text(row.nip).slice(0, 40);
  const name = text(row.name).replace(/\s+/g, " ").slice(0, 120);
  if (!externalId) return { nip: nip || undefined, error: "MISSING_EXTERNAL_ID" };
  if (!nip) return { externalId, error: "MISSING_NIP" };
  if (!name) return { externalId, nip, error: "MISSING_NAME" };
  const emailRaw = text(row.email).toLowerCase();
  const email = emailRaw && EMAIL.test(emailRaw) && emailRaw.length <= 200 ? emailRaw : null;
  const activeRaw = row.active;
  const active =
    activeRaw === undefined || activeRaw === null
      ? true
      : typeof activeRaw === "boolean"
        ? activeRaw
        : typeof activeRaw === "number" || typeof activeRaw === "bigint"
          ? Number(activeRaw) !== 0
          : !FALSE_WORDS.has(text(activeRaw).toLowerCase());
  return { externalId, nip, name, email, unit: text(row.unit).slice(0, 120), active, photoHash: text(row.photohash) || null };
}

const isProblem = (r: SourceTeacher | SyncProblem): r is SyncProblem => "error" in r;

/** Only plain SELECT statements; the app's database user should also have SELECT-only rights on the source. */
export function assertSelectQuery(query: string) {
  const q = query.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\s/i.test(q) || q.includes(";")) throw new HttpError(400, "SYNC_QUERY_NOT_SELECT");
  return q;
}

let running = false;

/** The campus HR table hr_staff_info (fingerprint-machine software): FID = link, NIK = login ID. */
export const DEFAULT_HR_QUERY =
  "SELECT CAST(FID AS UNSIGNED) AS externalId, NIK AS nip, Nama AS name, DEPT_NAME AS unit, " +
  "CASE WHEN tgL_Keluar IS NULL OR TRIM(tgL_Keluar) IN ('', '0', '-', '0000-00-00') THEN 1 ELSE 0 END AS active, " +
  "MD5(PHOTO) AS photoHash FROM hr_staff_info";

/** Where staff data comes from: the HR database (own connection) or a query on this app's own server. */
export interface SyncSource {
  describe: string;
  rows(): Promise<Record<string, unknown>[]>;
  /** One person's photo bytes, if the source has photos. */
  photo?(externalId: string): Promise<Buffer | null>;
  close(): Promise<void>;
}

/** Is any staff source set up? (HR connection, or a query on this app's own database server.) */
export const syncConfigured = () => Boolean(config.HR_DB_HOST || config.TEACHER_SOURCE_QUERY);

const firstLine = (e: unknown) => ((e as Error).message ?? String(e)).split("\n").filter(Boolean).pop() ?? "unknown error";

async function openSource(): Promise<SyncSource> {
  if (!config.HR_DB_HOST) {
    const sql = assertSelectQuery(config.TEACHER_SOURCE_QUERY);
    return { describe: "this app's database server", rows: () => prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql), close: async () => {} };
  }
  const sql = assertSelectQuery(config.TEACHER_SOURCE_QUERY || DEFAULT_HR_QUERY);
  const where = `${config.HR_DB_HOST}:${config.HR_DB_PORT}`;
  let conn: mysql.Connection;
  try {
    conn = await mysql.createConnection({
      host: config.HR_DB_HOST,
      port: config.HR_DB_PORT,
      user: config.HR_DB_USER,
      password: config.HR_DB_PASSWORD,
      database: config.HR_DB_NAME || undefined,
      connectTimeout: 10_000,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
      charset: "utf8mb4",
    });
  } catch (e) {
    throw new SyncAbort("ERROR", `Cannot connect to the HR database at ${where}: ${firstLine(e)}`);
  }
  return {
    describe: `HR database ${where}`,
    rows: async () => (await conn.query(sql))[0] as Record<string, unknown>[],
    photo: async (externalId) => {
      const [rows] = (await conn.execute(config.HR_PHOTO_QUERY, [externalId])) as unknown as [Record<string, unknown>[]];
      const v = rows[0] ? (rows[0].photo ?? Object.values(rows[0])[0]) : null;
      return v ? Buffer.from(v as Buffer) : null;
    },
    close: async () => {
      await conn.end().catch(() => {});
    },
  };
}

export interface SyncOptions {
  trigger: "NIGHTLY" | "MANUAL" | "STARTUP";
  actorId?: string;
  /** Skip the "too many deactivations" safety stop. */
  force?: boolean;
  /** Tests: read from this query on the app's own database instead of the configured source. */
  query?: string;
  /** Tests: a ready-made source. */
  source?: SyncSource;
}

export async function runTeacherSync(opts: SyncOptions): Promise<SyncSummary> {
  if (opts.query !== undefined) assertSelectQuery(opts.query);
  else if (!opts.source && !syncConfigured()) throw new HttpError(400, "SYNC_NOT_CONFIGURED");
  else if (!opts.source && !config.HR_DB_HOST) assertSelectQuery(config.TEACHER_SOURCE_QUERY);
  if (running) throw new HttpError(409, "SYNC_RUNNING");
  running = true;
  const run = await prisma.syncRun.create({ data: { trigger: opts.trigger, actorId: opts.actorId ?? null, status: "RUNNING" } });
  const counts = { sourceRows: 0, added: 0, updated: 0, deactivated: 0, reactivated: 0, skipped: 0, photos: 0 };
  const problems: SyncProblem[] = [];
  let status: SyncSummary["status"] = "OK";
  let message: string | null = null;
  let src: SyncSource | null = null;

  try {
    // 1. Read the source. Nothing in this app changes if it can't be reached.
    src =
      opts.source ??
      (opts.query !== undefined
        ? { describe: "test query", rows: () => prisma.$queryRawUnsafe<Record<string, unknown>[]>(assertSelectQuery(opts.query!)), close: async () => {} }
        : await openSource());
    let rawRows: Record<string, unknown>[];
    try {
      rawRows = await src.rows();
    } catch (e) {
      throw new SyncAbort("ERROR", `Reading staff from the ${src.describe} failed: ${firstLine(e)}`);
    }
    counts.sourceRows = rawRows.length;
    if (rawRows.length === 0) throw new SyncAbort("ABORTED", "The source returned no teachers; nothing was changed (check TEACHER_SOURCE_QUERY).");

    const source: SourceTeacher[] = [];
    const seenId = new Set<string>();
    const seenNip = new Set<string>();
    for (const raw of rawRows) {
      const r = normalizeRow(raw);
      if (isProblem(r)) {
        problems.push(r);
        counts.skipped++;
      } else if (seenId.has(r.externalId)) {
        problems.push({ externalId: r.externalId, nip: r.nip, error: "DUPLICATE_EXTERNAL_ID" });
        counts.skipped++;
      } else if (seenNip.has(r.nip)) {
        problems.push({ externalId: r.externalId, nip: r.nip, error: "DUPLICATE_NIP" });
        counts.skipped++;
      } else {
        seenId.add(r.externalId);
        seenNip.add(r.nip);
        source.push(r);
      }
    }

    // 2. Compare with this app's users.
    const users = await prisma.user.findMany({
      select: { id: true, externalId: true, nip: true, email: true, name: true, unit: true, active: true },
    });
    const byExternal = new Map(users.filter((u) => u.externalId).map((u) => [u.externalId!, u]));
    const byNip = new Map(users.map((u) => [u.nip, u]));
    const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email!, u]));
    const sourceIds = new Set(source.map((s) => s.externalId));

    type Op =
      | { kind: "create"; data: Prisma.UserCreateInput }
      | { kind: "update"; id: string; data: Prisma.UserUpdateInput; deactivate: boolean; reactivate: boolean; changed: boolean };
    const ops: Op[] = [];
    const now = new Date();

    for (const s of source) {
      // Match on externalId; otherwise link an existing hand-made account with the same NIP.
      let user = byExternal.get(s.externalId);
      if (!user) {
        const sameNip = byNip.get(s.nip);
        if (sameNip && !sameNip.externalId) user = sameNip;
        else if (sameNip) {
          problems.push({ externalId: s.externalId, nip: s.nip, error: "NIP_USED_BY_OTHER_SYNCED_ACCOUNT" });
          counts.skipped++;
          continue;
        }
      }
      const nipOwner = byNip.get(s.nip);
      if (user && nipOwner && nipOwner.id !== user.id) {
        problems.push({ externalId: s.externalId, nip: s.nip, error: "NIP_USED_BY_OTHER_ACCOUNT" });
        counts.skipped++;
        continue;
      }
      // An email that already belongs to someone else is not copied (the person can still log in with the NIP).
      const emailOwner = s.email ? byEmail.get(s.email) : undefined;
      let email = s.email;
      if (email && emailOwner && emailOwner.id !== user?.id) {
        problems.push({ externalId: s.externalId, nip: s.nip, error: "EMAIL_USED_BY_OTHER_ACCOUNT" });
        email = user?.email ?? null;
      }

      if (!user) {
        ops.push({
          kind: "create",
          data: {
            externalId: s.externalId,
            nip: s.nip,
            name: s.name,
            email,
            unit: s.unit,
            active: s.active,
            role: "USER",
            annualQuota: config.SYNC_DEFAULT_QUOTA,
            passwordHash: "", // no password until an admin issues one
            mustChangePassword: true,
            lastSyncedAt: now,
          },
        });
        byNip.set(s.nip, { id: `new:${s.externalId}`, externalId: s.externalId, nip: s.nip, email, name: s.name, unit: s.unit, active: s.active });
        if (email) byEmail.set(email, byNip.get(s.nip)!);
        continue;
      }
      const changed = user.name !== s.name || user.nip !== s.nip || user.unit !== s.unit || (user.email ?? null) !== email || user.externalId !== s.externalId;
      const deactivate = user.active && !s.active;
      const reactivate = !user.active && s.active;
      ops.push({
        kind: "update",
        id: user.id,
        changed,
        deactivate,
        reactivate,
        data: {
          externalId: s.externalId,
          name: s.name,
          nip: s.nip,
          unit: s.unit,
          email,
          active: s.active,
          lastSyncedAt: now,
          ...(deactivate && { sessionVersion: { increment: 1 } }),
        },
      });
    }
    // Synced accounts that are no longer in the source: deactivate (never delete; their history stays).
    for (const u of users) {
      if (u.externalId && !sourceIds.has(u.externalId) && u.active) {
        ops.push({ kind: "update", id: u.id, changed: false, deactivate: true, reactivate: false, data: { active: false, sessionVersion: { increment: 1 }, lastSyncedAt: now } });
      }
    }

    // 3. Safety stop against a broken query switching everyone off.
    const deactivations = ops.filter((o) => o.kind === "update" && o.deactivate).length;
    const activeSynced = users.filter((u) => u.externalId && u.active).length;
    if (!opts.force && activeSynced > 0 && deactivations > Math.max(2, (activeSynced * config.SYNC_MAX_DEACTIVATE_PERCENT) / 100)) {
      throw new SyncAbort(
        "ABORTED",
        `Stopped: this run would deactivate ${deactivations} of ${activeSynced} synced accounts (limit ${config.SYNC_MAX_DEACTIVATE_PERCENT}%). Check the source, or run it again with "force".`,
      );
    }

    // 4. Apply.
    await prisma.$transaction(
      async (tx) => {
        for (const op of ops) {
          if (op.kind === "create") {
            await tx.user.create({ data: op.data });
            counts.added++;
          } else {
            await tx.user.update({ where: { id: op.id }, data: op.data });
            if (op.deactivate) counts.deactivated++;
            else if (op.reactivate) counts.reactivated++;
            else if (op.changed) counts.updated++;
          }
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    // 5. Photos from HR — only for people without a photo of their own, and only when HR's photo changed.
    if (config.HR_PHOTO_IMPORT && src.photo) {
      const withPhoto = source.filter((r) => r.photoHash);
      const accounts = withPhoto.length
        ? await prisma.user.findMany({
            where: { externalId: { in: withPhoto.map((r) => r.externalId) } },
            select: { id: true, externalId: true, photo: { select: { source: true, sourceHash: true } } },
          })
        : [];
      const byExt = new Map(accounts.map((a) => [a.externalId!, a]));
      for (const r of withPhoto) {
        const u = byExt.get(r.externalId);
        if (!u || (u.photo && (u.photo.source !== "HR" || u.photo.sourceHash === r.photoHash))) continue;
        let raw: Buffer | null;
        try {
          raw = await src.photo(r.externalId);
        } catch {
          problems.push({ externalId: r.externalId, nip: r.nip, error: "PHOTO_READ_FAILED" });
          continue;
        }
        if (!raw?.length) continue;
        let data: Buffer;
        try {
          data = await toProfileJpeg(raw);
        } catch {
          const fmt = sniffImage(raw);
          problems.push({ externalId: r.externalId, nip: r.nip, error: `PHOTO_FORMAT_${fmt.startsWith("unknown") ? "UNKNOWN" : fmt.toUpperCase()}` });
          continue;
        }
        const photo = { data, mimeType: "image/jpeg", size: data.length, source: "HR", sourceHash: r.photoHash };
        await prisma.userPhoto.upsert({ where: { userId: u.id }, create: { userId: u.id, ...photo }, update: photo });
        counts.photos++;
      }
    }
    message = problems.length ? `${problems.length} row(s) need attention.` : null;
  } catch (e) {
    if (e instanceof SyncAbort) {
      status = e.status;
      message = e.message;
    } else {
      status = "ERROR";
      message = (e as Error).message.split("\n").filter(Boolean).pop() ?? "Unknown error";
      console.error("[teacher-sync] failed", e);
    }
  } finally {
    running = false;
    await src?.close();
  }

  const done = await prisma.syncRun.update({
    where: { id: run.id },
    data: { ...counts, status, message, problems: problems.slice(0, 500) as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
  });
  return toSyncDto(done);
}

class SyncAbort extends Error {
  constructor(
    public status: "ERROR" | "ABORTED",
    message: string,
  ) {
    super(message);
  }
}

export function toSyncDto(r: Prisma.SyncRunGetPayload<object>): SyncSummary {
  return {
    id: r.id,
    status: r.status as SyncSummary["status"],
    trigger: r.trigger,
    sourceRows: r.sourceRows,
    added: r.added,
    updated: r.updated,
    deactivated: r.deactivated,
    reactivated: r.reactivated,
    skipped: r.skipped,
    photos: r.photos,
    message: r.message,
    problems: (r.problems as SyncProblem[] | null) ?? [],
    startedAt: r.startedAt.toISOString(),
    finishedAt: (r.finishedAt ?? r.startedAt).toISOString(),
  };
}

/** Active accounts that have no password yet (typically just imported). */
export const withoutPassword = { active: true, passwordHash: "" } satisfies Prisma.UserWhereInput;

/**
 * Gives every active account without a password a one-time password (shown once, to hand out).
 * They must choose their own at first login.
 */
export async function issueMissingPasswords(actorId: string) {
  const users = await prisma.user.findMany({ where: withoutPassword, select: { id: true, name: true, nip: true, email: true, unit: true }, orderBy: { name: "asc" } });
  const out: { id: string; name: string; nip: string; email: string | null; unit: string; tempPassword: string }[] = [];
  for (const u of users) {
    const tempPassword = temporaryPassword();
    // Only if still without password (another admin may have done it meanwhile).
    const { count } = await prisma.user.updateMany({
      where: { id: u.id, passwordHash: "" },
      data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true, sessionVersion: { increment: 1 } },
    });
    if (count) {
      out.push({ ...u, tempPassword });
      await prisma.adminAction.create({ data: { actorId, targetUserId: u.id, action: "PASSWORD_ISSUED", reason: "Bulk one-time passwords" } });
    }
  }
  return out;
}
