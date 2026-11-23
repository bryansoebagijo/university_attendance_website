#!/usr/bin/env node
/**
 * Runs the Prisma CLI against the right schema for the configured database.
 *
 *   DATABASE_URL=postgresql://…  →  prisma/schema.prisma        (migrations in prisma/migrations)
 *   DATABASE_URL=mysql://…       →  prisma/mysql/schema.prisma  (migrations in prisma/mysql/migrations)
 *
 * prisma/schema.prisma is the single source of truth. The MySQL schema is generated from it here
 * (only the provider line differs), so the two can't drift apart. Never edit the MySQL copy by hand.
 *
 * Usage: node scripts/prisma.mjs <prisma args…>   e.g.  node scripts/prisma.mjs migrate deploy
 * Env file: .env by default; set DOTENV_CONFIG_PATH (e.g. .env.test) to use another.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(root, process.env.DOTENV_CONFIG_PATH ?? ".env") });

const url = process.env.DATABASE_URL ?? "";
const fromUrl = url.startsWith("mysql://") ? "mysql" : url.startsWith("postgres") ? "postgresql" : null;
// DB_PROVIDER (mysql | postgresql) lets a Docker image build pick the database type without a real URL.
const fromEnv = ["mysql", "postgresql"].includes(process.env.DB_PROVIDER) ? process.env.DB_PROVIDER : null;
const provider = fromUrl ?? fromEnv;
if (!provider) {
  console.error("DATABASE_URL must start with postgresql:// or mysql:// (or set DB_PROVIDER)");
  process.exit(1);
}
if (!url) {
  // Build time (no database yet): Prisma only needs a URL of the right type to generate the client.
  process.env.DATABASE_URL = provider === "mysql" ? "mysql://build:build@localhost:3306/build" : "postgresql://build:build@localhost:5432/build";
}

const baseSchema = join(root, "prisma", "schema.prisma");
let schema = baseSchema;

if (provider === "mysql") {
  schema = join(root, "prisma", "mysql", "schema.prisma");
  const source = readFileSync(baseSchema, "utf8");
  const swapped = source.replace(/provider\s*=\s*"postgresql"/, 'provider = "mysql"');
  if (swapped === source) {
    console.error('Could not find provider = "postgresql" in prisma/schema.prisma');
    process.exit(1);
  }
  const generated = "// GENERATED from ../schema.prisma by scripts/prisma.mjs — do not edit. Change ../schema.prisma instead.\n" + swapped;
  // Only write when it changed: in the container the app user can't write to /app/prisma.
  if (!existsSync(schema) || readFileSync(schema, "utf8") !== generated) {
    mkdirSync(dirname(schema), { recursive: true });
    writeFileSync(schema, generated);
  }
}

const args = process.argv.slice(2);
// Relative path: the project folder may contain spaces, which the shell would split.
const relSchema = provider === "mysql" ? "prisma/mysql/schema.prisma" : "prisma/schema.prisma";
const prisma = (a) => spawnSync("npx", ["prisma", ...a, "--schema", relSchema], { stdio: "inherit", shell: true, cwd: root, env: process.env });

// The generated client is specific to one database type. Commands that run the seed
// ("db seed", "migrate reset") need it to match the database they point at.
const runsSeed =
  (args[0] === "db" && args[1] === "seed") || (args[0] === "migrate" && args[1] === "reset" && !args.includes("--skip-seed"));
if (runsSeed) {
  const gen = prisma(["generate"]);
  if (gen.status !== 0) process.exit(gen.status ?? 1);
}

const result = prisma(args);
process.exit(result.status ?? 1);
