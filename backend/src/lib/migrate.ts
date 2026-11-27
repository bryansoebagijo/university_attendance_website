import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";

/**
 * Applies this app's PostgreSQL migrations (prisma/migrations/<name>/migration.sql) to its OWN database
 * at startup — used by the offline release, which runs its own PostgreSQL and has no Prisma CLI.
 * Each file runs once, in its own transaction, in name (= date) order, and is recorded in _ista_migrations.
 * Development keeps using `prisma migrate`; this runner is switched on with AUTO_MIGRATE=true.
 */
export async function applyMigrations(dir = path.join(process.cwd(), "prisma", "migrations")): Promise<string[]> {
  if (!existsSync(dir)) throw new Error(`Migrations folder not found: ${dir}`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "_ista_migrations" ("name" TEXT PRIMARY KEY, "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );
  const done = new Set((await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT "name" FROM "_ista_migrations"`)).map((r) => r.name));
  const pending = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, "migration.sql")))
    .map((e) => e.name)
    .sort()
    .filter((n) => !done.has(n));

  for (const name of pending) {
    const statements = splitSql(readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
    await prisma.$transaction([
      ...statements.map((sql) => prisma.$executeRawUnsafe(sql)),
      prisma.$executeRawUnsafe(`INSERT INTO "_ista_migrations" ("name") VALUES ($1)`, name),
    ]);
    console.log(`[migrate] applied ${name} (${statements.length} statements)`);
  }
  return pending;
}

/**
 * Splits a Prisma-generated migration into single statements (Prisma sends one statement per call).
 * Prisma's SQL has no functions or $$ blocks, so a ";" at the end of a line ends a statement.
 */
export function splitSql(sql: string): string[] {
  return sql
    .replace(/\r\n/g, "\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) =>
      s
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}
