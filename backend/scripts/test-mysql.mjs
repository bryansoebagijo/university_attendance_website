#!/usr/bin/env node
/**
 * Runs the full test suite against MySQL (.env.test.mysql), then switches the generated
 * Prisma client back to whatever .env uses, so the dev server keeps working afterwards.
 */
import { spawnSync } from "node:child_process";

const run = (cmd, env = {}) => spawnSync(cmd, { stdio: "inherit", shell: true, env: { ...process.env, ...env } }).status ?? 1;

const MYSQL = { DOTENV_CONFIG_PATH: ".env.test.mysql", TEST_ENV_FILE: ".env.test.mysql" };
let status = run("node scripts/prisma.mjs generate", MYSQL);
if (status === 0) status = run("npx vitest run", MYSQL);
// Restore the client for the configured database (.env).
run("node scripts/prisma.mjs generate", { DOTENV_CONFIG_PATH: ".env" });
process.exit(status);
