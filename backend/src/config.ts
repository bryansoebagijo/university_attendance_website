import "dotenv/config";
import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Secrets can come from files (Docker secrets): FOO_FILE=/run/secrets/foo sets FOO from the file's content.
 * Supported for JWT_SECRET, DB_PASSWORD, DATABASE_URL and HR_DB_PASSWORD.
 */
for (const key of ["JWT_SECRET", "DB_PASSWORD", "DATABASE_URL", "HR_DB_PASSWORD"]) {
  const file = process.env[`${key}_FILE`];
  if (file && !process.env[key]) {
    try {
      process.env[key] = readFileSync(file, "utf8").trim();
    } catch (e) {
      console.error(`Cannot read ${key}_FILE (${file}):`, (e as Error).message);
      process.exit(1);
    }
  }
}

/**
 * The connection can be given as one DATABASE_URL, or as separate DB_* fields (recommended in production:
 * passwords with @ : / # would otherwise have to be URL-encoded by hand). The URL is then built here.
 * When DB_HOST is set it wins over any DATABASE_URL (Prisma also auto-loads a stray .env file).
 */
if (process.env.DB_HOST) {
  const provider = process.env.DB_PROVIDER === "postgresql" ? "postgresql" : "mysql";
  const user = encodeURIComponent(process.env.DB_USER ?? "");
  const pass = encodeURIComponent(process.env.DB_PASSWORD ?? "");
  const port = process.env.DB_PORT || (provider === "mysql" ? "3306" : "5432");
  const params = process.env.DB_PARAMS ? `?${process.env.DB_PARAMS}` : "";
  process.env.DATABASE_URL = `${provider}://${user}:${pass}@${process.env.DB_HOST}:${port}/${encodeURIComponent(process.env.DB_NAME ?? "")}${params}`;
}

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("")
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url("set DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD"),
  /** Shared with the frontend middleware, which verifies the session token. */
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  SESSION_HOURS: z.coerce.number().positive().default(12),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /**
   * Number of proxies in front of the backend whose X-Forwarded-For can be trusted (for the real client IP in
   * rate limiting). Development: 1 (Next.js). Docker behind the client web server: 2 (web server + Next.js).
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

  // ---- Teacher sync from the client's existing database -------------------------------
  /**
   * A SELECT returning one row per teacher with these column names (use AS to rename):
   *   externalId (required), nip (required), name (required), email, unit, active (1/0; missing = active).
   * Example: SELECT id AS externalId, nip, nama AS name, email, unit_kerja AS unit, aktif AS active FROM sekolah.guru
   * Empty = sync switched off.
   */
  TEACHER_SOURCE_QUERY: z.string().trim().default(""),
  /**
   * The campus HR database (MariaDB/MySQL), read-only. When HR_DB_HOST is set, the sync reads from there
   * over its own connection (this app's data can then live in its own PostgreSQL). Empty = no HR source;
   * a TEACHER_SOURCE_QUERY without HR_DB_HOST reads from this app's own database server instead.
   * With HR_DB_HOST and no TEACHER_SOURCE_QUERY, the built-in query for hr_staff_info is used.
   */
  HR_DB_HOST: z.string().trim().default(""),
  HR_DB_PORT: z.coerce.number().int().default(3306),
  HR_DB_NAME: z.string().trim().default(""),
  HR_DB_USER: z.string().trim().default(""),
  HR_DB_PASSWORD: z.string().default(""),
  /** Import profile photos from HR (only for people who haven't uploaded their own). */
  HR_PHOTO_IMPORT: bool.default("true"),
  /** Fetches one person's photo; ? = the externalId. */
  HR_PHOTO_QUERY: z.string().trim().default("SELECT PHOTO AS photo FROM hr_staff_info WHERE CAST(FID AS UNSIGNED) = ?"),
  /** Run the sync every night at 00:05 WIB (when a query is set). */
  SYNC_NIGHTLY: bool.default("true"),
  /** Annual leave quota for newly imported teachers. */
  SYNC_DEFAULT_QUOTA: z.coerce.number().int().min(0).max(60).default(12),
  /** Safety stop: a run that would deactivate more than this share of synced staff is aborted (manual runs can override). */
  SYNC_MAX_DEACTIVATE_PERCENT: z.coerce.number().min(0).max(100).default(20),

  // ---- License ---------------------------------------------------------------------------
  /** The license text itself (e.g. on hosting where files are awkward), or… */
  LICENSE: z.string().default(""),
  /** …the path of the license file (Docker: /run/secrets/license = config/license.key). */
  LICENSE_FILE: z.string().default(""),
  /** Enforce the license outside production too (testing, staging). It can only switch the check ON. */
  LICENSE_ENFORCE: bool,

  /** Create/update this app's own PostgreSQL tables at startup (offline release with its own database). */
  AUTO_MIGRATE: bool,

  /** Skip the database script version check (only for tooling; never in production). */
  SKIP_SCHEMA_CHECK: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid backend environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";
