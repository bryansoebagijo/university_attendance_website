import { execSync } from "node:child_process";
import dotenv from "dotenv";

/** Rebuild the test database from migrations and re-seed it before the run. */
export default function setup() {
  const file = process.env.TEST_ENV_FILE ?? ".env.test";
  const env = dotenv.config({ path: file, override: true }).parsed ?? {};
  if (!env.DATABASE_URL?.includes("absen_test")) {
    throw new Error(`Refusing to reset: ${file} DATABASE_URL must point at the absen_test database.`);
  }
  // The wrapper picks the PostgreSQL or MySQL schema from DATABASE_URL.
  execSync("node scripts/prisma.mjs migrate reset --force --skip-generate", {
    stdio: "ignore",
    env: { ...process.env, ...env, DOTENV_CONFIG_PATH: file },
  });
}
